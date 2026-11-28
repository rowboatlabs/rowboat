import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgStore, pgliteDb, startHarbor, type HarborOptions, type RunningHarbor } from '@rowboat/harbor';
import { harborChannelHandlers, type HarborChannelHandlers } from './channels.js';
import { SpacesClient, SpacesRequestError } from './client.js';
import { SpacesLive } from './live.js';
import { SpaceSubscriptions } from './subscriptions.js';

// The space-connection channels (spec §8 Space connections, 2026-11-28)
// against the REAL Harbor, with stand-ins only for what sits outside it: the
// control plane that holds an app's authorisation, billing, and the model
// that words a post. This is what the desktop and the web app both serve, so
// it is where a wrong path or a dropped field would show.

const ISSUE = 'LINEAR_ISSUE_CREATED_TRIGGER';
type Connections = NonNullable<HarborOptions['connections']>;

/** The control plane as Harbor sees it: one app, one trigger that needs a team, accounts a test can authorise. */
const accounts = new Map<string, string>();
let made = 0;
const backend: Connections['backend'] = {
  apps: async () => ({ items: [{ slug: 'linear', name: 'Linear', logo: 'https://logos.test/linear.svg', description: 'Issue tracking', triggersCount: 1, managedAuth: true }] }),
  triggerTypes: async () => [{ slug: ISSUE, name: 'Issue created', description: 'A new issue in a team', config: { type: 'object', properties: { team_id: { type: 'string' } }, required: ['team_id'] } }],
  link: async (_ref, input) => {
    const accountId = `ca_${++made}`;
    accounts.set(accountId, 'INITIATED');
    return { accountId, redirectUrl: `https://connect.test/link/${accountId}?app=${input.app}` };
  },
  account: async (_ref, accountId) => (accounts.has(accountId) ? { status: accounts.get(accountId)! } : undefined),
  createTrigger: async () => ({ triggerId: `ti_${++made}` }),
  deleteTrigger: async () => undefined,
  deleteConnection: async () => undefined,
  verify: () => false,
};
const billing: Connections['billing'] = {
  accountFor: () => 'customer-1',
  mintGatewayKey: async (_customer, input) => ({ key: `rbg_${input.ref}`, hint: 'test' }),
  revokeGatewayKey: async () => undefined,
};

let harbor: RunningHarbor;
let live: SpacesLive;
let table: HarborChannelHandlers;
let spaceId: string;
const orgId = 'org-1';

beforeAll(async () => {
  // Harbor seals each connection's gateway key, which needs the deployment's key.
  process.env.HARBOR_INTEGRATION_KEY = 'c'.repeat(64);
  const db = await pgliteDb();
  const store = new PgStore(db);
  await store.init();
  const started = await startHarbor({
    orgName: 'Connections Test Org',
    store,
    seedMembers: [{ id: 'ramnique', displayName: 'Ramnique' }],
    seedSpaces: [{ name: 'Lobby', creator: 'ramnique' }],
    connections: { backend, billing, writer: { write: async () => 'An update.' }, apps: ['linear'], tickMs: 60_000 },
  });
  harbor = { ...started, close: async () => { await started.close(); await db.close(); } };
  const client = new SpacesClient({ baseUrl: harbor.url, token: 'dev-ramnique' });
  live = new SpacesLive({ baseUrl: harbor.url, token: 'dev-ramnique' });
  table = harborChannelHandlers({
    getClient: () => client,
    getLive: () => live,
    subscriptions: new SpaceSubscriptions({ getLive: () => live, onRuntimeReset: () => () => {} }),
    emit: () => {},
  });
  spaceId = (await table['spaces:createSpace']({ orgId, name: 'Engineering' })).space.id;
  // In-process Postgres applies every migration before the first request: seconds, and past the default ten on a loaded machine.
}, 30_000);

afterAll(async () => {
  live.close();
  await harbor.close();
  delete process.env.HARBOR_INTEGRATION_KEY;
});

describe('the space-connection channels', () => {
  it('list the apps a space can connect and what one can post', async () => {
    expect(await table['spaces:listConnectionApps']({ orgId })).toEqual({
      apps: [{ slug: 'linear', name: 'Linear', logo: 'https://logos.test/linear.svg', description: 'Issue tracking', triggersCount: 1 }],
      available: true,
    });
    expect((await table['spaces:listConnectionApps']({ orgId, search: 'nothing like it' })).apps).toEqual([]);
    const { triggers } = await table['spaces:listConnectionTriggers']({ orgId, app: 'linear' });
    expect(triggers.map((t) => t.slug)).toEqual([ISSUE]);
    expect(triggers[0]!.config).toMatchObject({ required: ['team_id'] });
  });

  it('connect an app, see it authorised, choose what it posts, pause it, read its events and disconnect it', async () => {
    expect(await table['spaces:listSpaceConnections']({ orgId, spaceId })).toEqual({ connections: [], available: true, filterAvailable: false });

    const created = await table['spaces:createSpaceConnection']({ orgId, spaceId, app: 'linear', name: 'Linear – Eng' });
    expect(created.connection).toMatchObject({ name: 'Linear – Eng', status: 'pending', app: { slug: 'linear', name: 'Linear' }, createdBy: 'ramnique', filter: true, paused: false });
    expect(created.authorizeUrl).toMatch(/^https:\/\/connect\.test\/link\/ca_/);
    const connectionId = created.connection.id;
    // Its member is in the space, an agent of the connection kind.
    const members = (await table['spaces:listMembers']({ orgId, spaceId })).members;
    expect(members.find((m) => m.id === created.connection.memberId)).toMatchObject({ kind: 'agent', agentKind: 'connection', displayName: 'Linear – Eng' });

    // Nothing to choose before the app is authorised: Harbor says so, in words the panel shows as they are.
    const early = await table['spaces:updateSpaceConnection']({ orgId, spaceId, connectionId, triggers: [{ slug: ISSUE, config: { team_id: 'ENG' } }] }).catch((e: unknown) => e);
    expect(early).toBeInstanceOf(SpacesRequestError);
    expect(early).toMatchObject({ code: 'invalid_request', message: expect.stringMatching(/not authorised yet/) });

    // A fresh address, and the read that follows the person's authorising moves it to active.
    const again = await table['spaces:authorizeSpaceConnection']({ orgId, spaceId, connectionId });
    expect(again.authorizeUrl).not.toBe(created.authorizeUrl);
    for (const id of accounts.keys()) accounts.set(id, 'ACTIVE');
    expect((await table['spaces:listSpaceConnections']({ orgId, spaceId })).connections).toMatchObject([{ id: connectionId, status: 'active', triggers: [] }]);

    await expect(table['spaces:updateSpaceConnection']({ orgId, spaceId, connectionId, triggers: [{ slug: ISSUE, config: {} }] }))
      .rejects.toMatchObject({ code: 'invalid_request', message: 'Issue created needs team_id' });
    const { connection } = await table['spaces:updateSpaceConnection']({ orgId, spaceId, connectionId, name: 'Linear issues', triggers: [{ slug: ISSUE, config: { team_id: 'ENG' } }], filter: false, paused: true });
    expect(connection).toMatchObject({ name: 'Linear issues', filter: false, paused: true, triggers: [{ slug: ISSUE, name: 'Issue created', config: { team_id: 'ENG' } }] });
    // A field left out is left alone.
    expect((await table['spaces:updateSpaceConnection']({ orgId, spaceId, connectionId, paused: false })).connection).toMatchObject({ name: 'Linear issues', filter: false, paused: false });

    expect(await table['spaces:listConnectionEvents']({ orgId, spaceId, connectionId, outcome: 'skipped', limit: 10 })).toEqual({ events: [] });

    expect(await table['spaces:deleteSpaceConnection']({ orgId, spaceId, connectionId })).toEqual({});
    expect((await table['spaces:listSpaceConnections']({ orgId, spaceId })).connections).toEqual([]);
    // Idempotent, as the route is.
    expect(await table['spaces:deleteSpaceConnection']({ orgId, spaceId, connectionId })).toEqual({});
  });
});
