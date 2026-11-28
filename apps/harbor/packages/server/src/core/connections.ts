import {
  COMPOSIO_CONNECTION,
  CONNECTION_KIND,
  ConnectionDelivery,
  type ConnectionApp,
  type ConnectionEvent,
  type ConnectionEventOutcome,
  type ConnectionTriggerInput,
  type ConnectionTriggerType,
  type Space,
  type SpaceConnection,
} from '@rowboat/spaces-protocol';
import type { z } from 'zod';
import type { routes } from '@rowboat/spaces-protocol';
import type { BillingAccounts } from '../billing.js';
import { ConnectionsBackendError, type BackendApp, type ConnectionsBackend } from '../connections/backend.js';
import { digest, subjectOf, titleOf, urlOf } from '../connections/payload.js';
import { WORTH_MIN, worthAnswer, worthRequest } from '../connections/questions.js';
import { clean, fallbackUpdate, writePrompt } from '../connections/write.js';
import type { UpdateWriter } from '../connections/writer.js';
import { HarborError } from '../errors.js';
import { TOPIC_MIN } from '../graph/questions.js';
import type { JevApi } from '../jev.js';
import { canManageConnections, enforce } from '../policy.js';
import type { StoredConnection, StoredConnectionEvent, StoredConnectionTrigger } from '../store.js';
import type { Feed } from './feed.js';
import type { ActorCtx, Kernel } from './kernel.js';
import type { Spaces } from './spaces.js';

// Space connections (spec §8 Space connections, 2026-11-28, "channel has
// direct connections" in the rowboat space): an admin connects an app to a
// shared space, and what happens in the app is posted there by the connection
// itself. Three parties do the work. The control plane (connections/backend.ts)
// holds the app's authorisation and its triggers and forwards each event here,
// signed. Jev answers one question per event, whether it is worth a post
// (connections/questions.ts), when the connection's filter is on. A small
// model writes the post from the payload (connections/write.ts), since Jev
// returns no text and no table of wordings could cover every app's events.
//
// An event is taken durably and answered at once, then decided by a worker:
// Jev and the model can each take longer than a webhook waits, and an event
// taken must survive a restart. Nothing here is in the space's log but the
// posts themselves and the connection member's joining and leaving.

type CreateInput = z.infer<Routes['createSpaceConnection']['request']>;
type AuthorizeInput = z.infer<Routes['authorizeSpaceConnection']['request']>;
type UpdateInput = z.infer<Routes['updateSpaceConnection']['request']>;
type Routes = typeof routes;

export interface ConnectionsDeps {
  backend: ConnectionsBackend;
  /** Who a member's use bills to, and the gateway key the connection's model calls run on. */
  billing: Pick<BillingAccounts, 'accountFor' | 'mintGatewayKey' | 'revokeGatewayKey'>;
  writer: UpdateWriter;
  /** Seals the connection's gateway key under the deployment's key, bound to the connection; throws when the deployment cannot seal. */
  seal(secret: string, connectionId: string): string;
  unseal(sealed: string, connectionId: string): string;
  /** Where the control plane delivers this org's events. */
  deliverUrl(): string;
  /** The apps a space may connect: slugs, or `*` for every app that has triggers. */
  apps: readonly string[] | '*';
}

export interface ConnectionsOptions {
  /** How often the worker looks for undecided events (default 30s); a delivery also wakes it. */
  tickMs?: number;
  /** How often each active connection's authorisation is checked (default hourly). */
  accountCheckMs?: number;
}

/**
 * The apps a space may connect when the operator names none (2026-11-28, the
 * rollout in "channel has direct connections"): the two the rowboat space
 * tries first. HARBOR_CONNECTION_APPS widens it, `*` to every app.
 */
export const DEFAULT_CONNECTION_APPS: readonly string[] = ['linear', 'github'];

const DEFAULT_TICK_MS = 30_000;
const DEFAULT_ACCOUNT_CHECK_MS = 60 * 60_000;
/** How many events one pass decides: a burst is worked off over several passes. */
const EVENTS_PER_PASS = 25;
/** Tries before an event is given up on. The last one skips Jev: a filter that is down must not lose events. */
const MAX_ATTEMPTS = 3;
/** Events kept per connection, to review what the filter did. */
export const EVENTS_KEPT = 300;
const COUNT_WINDOW_MS = 7 * 24 * 3_600_000;
const CATALOGUE_TTL_MS = 10 * 60_000;
/** Largest event body taken: a trigger payload, not a file. */
export const MAX_DELIVERY_BYTES = 512 * 1024;

export class Connections {
  private deps: ConnectionsDeps | undefined;
  private jev: JevApi | undefined;
  private options: ConnectionsOptions = {};
  private timer: NodeJS.Timeout | undefined;
  private ticking: Promise<void> | undefined;
  private again = false;
  private lastAccountCheck = 0;
  private readonly refreshing = new Map<string, Promise<StoredConnection>>();
  private readonly appCache = new Map<string, { at: number; app: BackendApp | undefined }>();
  private readonly triggerCache = new Map<string, { at: number; types: ConnectionTriggerType[] }>();

  constructor(
    private readonly k: Kernel,
    private readonly spaces: Spaces,
    private readonly feed: Feed,
  ) {}

  attach(deps: ConnectionsDeps, options: ConnectionsOptions = {}): void {
    this.deps = deps;
    this.options = options;
  }

  /** The Jev the filter asks: the deployment's, shared with the space graph. Without it every event is posted. */
  attachJev(jev: JevApi): void {
    this.jev = jev;
  }

  start(): void {
    if (this.timer || !this.deps || this.k.readOnly) return;
    this.timer = setInterval(() => void this.tick(), this.options.tickMs ?? DEFAULT_TICK_MS);
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.again = false;
    await this.ticking;
  }

  // --- the catalogue ----------------------------------------------------------------

  async apps(ctx: ActorCtx, search?: string): Promise<{ apps: ConnectionApp[]; available: boolean }> {
    await this.k.requireOrgMember(ctx);
    const deps = this.deps;
    if (!deps) return { apps: [], available: false };
    const needle = search?.trim().toLowerCase() ?? '';
    let found: BackendApp[];
    if (deps.apps === '*') {
      found = (await this.platform(() => deps.backend.apps(needle ? { search: needle } : {}))).items;
    } else {
      const named = await Promise.all(deps.apps.map((slug) => this.app(slug)));
      found = named.filter((app): app is BackendApp => !!app && (!needle || app.slug.includes(needle) || app.name.toLowerCase().includes(needle)));
    }
    return { apps: found.filter(connectable).map(appOf), available: true };
  }

  async triggerTypes(ctx: ActorCtx, app: string): Promise<ConnectionTriggerType[]> {
    await this.k.requireOrgMember(ctx);
    await this.connectableApp(app);
    return this.typesOf(app);
  }

  /** One app from the control plane, remembered for a few minutes: the catalogue changes rarely and is asked for on every open of the panel. */
  private async app(slug: string): Promise<BackendApp | undefined> {
    const deps = this.requireDeps();
    const cached = this.appCache.get(slug);
    if (cached && Date.now() - cached.at < CATALOGUE_TTL_MS) return cached.app;
    const page = await this.platform(() => deps.backend.apps({ search: slug }));
    const app = page.items.find((a) => a.slug.toLowerCase() === slug);
    this.appCache.set(slug, { at: Date.now(), app });
    return app;
  }

  private async typesOf(app: string): Promise<ConnectionTriggerType[]> {
    const deps = this.requireDeps();
    const cached = this.triggerCache.get(app);
    if (cached && Date.now() - cached.at < CATALOGUE_TTL_MS) return cached.types;
    const types = await this.platform(() => deps.backend.triggerTypes(app));
    this.triggerCache.set(app, { at: Date.now(), types });
    return types;
  }

  /** The app, if a space here may connect it: on the operator's list, with triggers, and authorisable from a link. */
  private async connectableApp(slug: string): Promise<BackendApp> {
    const deps = this.requireDeps();
    if (deps.apps !== '*' && !deps.apps.includes(slug)) throw new HarborError('invalid_request', `${slug} is not an app this server connects to spaces`);
    const app = await this.app(slug);
    if (!app) throw new HarborError('not_found', `no such app: ${slug}`);
    if (!connectable(app)) {
      throw new HarborError('invalid_request', app.triggersCount === 0 ? `${app.name} sends no events a space could receive` : `${app.name} cannot be authorised from a link yet`);
    }
    return app;
  }

  // --- a space's connections --------------------------------------------------------

  async list(ctx: ActorCtx, spaceId: string): Promise<{ connections: SpaceConnection[]; available: boolean; filterAvailable: boolean }> {
    await this.k.requireMember(ctx, spaceId);
    const stored = await this.k.store.listConnections(spaceId);
    // A pending one is asked about on the way, so the panel that is waiting on a person's authorisation sees it land.
    const current = this.deps && !this.k.readOnly ? await Promise.all(stored.map((c) => (c.status === 'pending' ? this.refresh(c).catch(() => c) : c))) : stored;
    return { connections: await this.wire(current), available: this.deps !== undefined, filterAvailable: this.jev !== undefined };
  }

  async create(ctx: ActorCtx, spaceId: string, input: CreateInput): Promise<{ connection: SpaceConnection; authorizeUrl: string }> {
    const space = await this.k.requireMember(ctx, spaceId);
    enforce(canManageConnections(await this.k.store.getMember(ctx.memberId), space));
    const deps = this.requireDeps();
    this.k.guardWrite();
    const app = await this.connectableApp(input.app);
    const customer = deps.billing.accountFor(await this.k.store.listIdentitiesOf(ctx.memberId));
    if (!customer) throw new HarborError('invalid_request', 'A connection bills to the Rowboat account of whoever connects it, and you have none here');
    const name = input.name?.trim() || app.name;
    const id = this.k.ulid();
    // Checked before anything is made on the control plane: a deployment that cannot seal holds no key.
    deps.seal('', id);
    // The control plane first: a refused link (no credits) makes nothing here.
    const link = await this.platform(() => deps.backend.link(id, { customer, app: app.slug }));
    let memberId: string | undefined;
    try {
      const key = await this.platform(() => deps.billing.mintGatewayKey(customer, { ref: id, name }));
      const member = await this.spaces.createAgent({ displayName: name, ownerId: ctx.memberId, agentKind: CONNECTION_KIND, agentConnection: COMPOSIO_CONNECTION });
      memberId = member.id;
      await this.spaces.addConnectionMember(spaceId, member.id, this.k.attributionOf(ctx, input));
      const connection: StoredConnection = {
        id,
        spaceId,
        memberId: member.id,
        app: { slug: app.slug, name: app.name, ...(app.logo ? { logo: app.logo } : {}) },
        name,
        status: 'pending',
        accountId: link.accountId,
        triggers: [],
        filter: true,
        paused: false,
        customer,
        sealedKey: deps.seal(key.key, id),
        createdBy: ctx.memberId,
        createdAt: this.k.now(),
      };
      await this.k.store.putConnection(connection);
      return { connection: (await this.wire([connection]))[0]!, authorizeUrl: link.redirectUrl };
    } catch (err) {
      // Nothing half-made is left behind: the app's pending account, the key, the member.
      await deps.backend.deleteConnection(id).catch(() => undefined);
      await deps.billing.revokeGatewayKey(customer, id).catch(() => undefined);
      if (memberId) await this.spaces.deactivateAgent(memberId).catch(() => undefined);
      throw err;
    }
  }

  async authorize(ctx: ActorCtx, spaceId: string, connectionId: string, _input: AuthorizeInput): Promise<{ connection: SpaceConnection; authorizeUrl: string }> {
    const { connection, deps } = await this.managed(ctx, spaceId, connectionId);
    this.k.guardWrite();
    const link = await this.platform(() => deps.backend.link(connection.id, { customer: connection.customer, app: connection.app.slug }));
    // A new account on the control plane. The old one's trigger instances go with it, and each is owed again once this one is authorised (rearm).
    for (const old of connection.triggers) {
      if (old.triggerId) await deps.backend.deleteTrigger(connection.id, old.triggerId).catch(() => undefined);
    }
    const { problem: _problem, ...rest } = connection;
    const next: StoredConnection = { ...rest, status: 'pending', accountId: link.accountId, triggers: connection.triggers.map((t) => ({ ...t, triggerId: '' })) };
    await this.k.store.putConnection(next);
    return { connection: (await this.wire([next]))[0]!, authorizeUrl: link.redirectUrl };
  }

  async update(ctx: ActorCtx, spaceId: string, connectionId: string, input: UpdateInput): Promise<SpaceConnection> {
    const managed = await this.managed(ctx, spaceId, connectionId);
    const { deps } = managed;
    this.k.guardWrite();
    let connection = managed.connection;
    // Everything that can refuse is checked before anything changes, so a refused request leaves the connection as it was.
    const name = input.name?.trim();
    if (input.name !== undefined && !name) throw new HarborError('invalid_request', 'a connection needs a name');
    if (input.triggers !== undefined) {
      if (connection.status === 'pending') connection = await this.refresh(connection);
      if (connection.status !== 'active' || !connection.accountId) {
        throw new HarborError('invalid_request', `${connection.app.name} is not authorised yet: authorise it, then choose what it posts`);
      }
      await this.checkTriggers(connection, input.triggers);
    }
    if (name !== undefined && name !== connection.name) {
      connection = { ...connection, name };
      await this.k.store.putConnection(connection);
      await this.spaces.renameConnectionMember(connection.memberId, name);
    }
    if (input.filter !== undefined || input.paused !== undefined) {
      connection = { ...connection, ...(input.filter !== undefined ? { filter: input.filter } : {}), ...(input.paused !== undefined ? { paused: input.paused } : {}) };
      await this.k.store.putConnection(connection);
    }
    if (input.triggers !== undefined) {
      const first = connection.triggers.length === 0;
      connection = await this.setTriggers(deps, connection, input.triggers);
      if (first && connection.triggers.length > 0) await this.announce(connection, ctx.memberId);
    }
    return (await this.wire([connection]))[0]!;
  }

  /** Each wanted trigger is one the app has, with what its config requires, listed once. */
  private async checkTriggers(connection: StoredConnection, wanted: ConnectionTriggerInput[]): Promise<{ types: Map<string, ConnectionTriggerType>; seen: Set<string> }> {
    const types = new Map((await this.typesOf(connection.app.slug)).map((t) => [t.slug, t]));
    const seen = new Set<string>();
    for (const t of wanted) {
      const type = types.get(t.slug);
      if (!type) throw new HarborError('invalid_request', `${connection.app.name} has no trigger ${t.slug}`);
      const missing = requiredOf(type.config).filter((field) => t.config[field] === undefined || t.config[field] === '');
      if (missing.length > 0) throw new HarborError('invalid_request', `${type.name} needs ${missing.join(', ')}`);
      if (seen.has(identity(t))) throw new HarborError('invalid_request', `${type.name} is listed twice with the same settings`);
      seen.add(identity(t));
    }
    return { types, seen };
  }

  /**
   * Make the connection listen for exactly `wanted`. A trigger is one slug
   * with one config, so the same event for two teams is two triggers. Kept
   * ones are left alone, dropped ones are removed on the control plane, new
   * ones are made there; the row is written after each step, so a failure
   * part-way leaves Harbor knowing exactly which instances exist.
   */
  private async setTriggers(deps: ConnectionsDeps, connection: StoredConnection, wanted: ConnectionTriggerInput[]): Promise<StoredConnection> {
    const { types, seen } = await this.checkTriggers(connection, wanted);
    let current = connection;
    for (const old of connection.triggers) {
      if (seen.has(identity(old)) && old.triggerId) continue;
      if (old.triggerId) await this.platform(() => deps.backend.deleteTrigger(connection.id, old.triggerId));
      current = { ...current, triggers: current.triggers.filter((t) => t !== old) };
      await this.k.store.putConnection(current);
    }
    const kept = new Set(current.triggers.map(identity));
    for (const t of wanted) {
      if (kept.has(identity(t))) continue;
      const made = await this.platform(() =>
        deps.backend.createTrigger(connection.id, { customer: connection.customer, accountId: connection.accountId!, slug: t.slug, config: t.config, deliverUrl: deps.deliverUrl() }),
      );
      const added: StoredConnectionTrigger = { slug: t.slug, name: types.get(t.slug)!.name, config: t.config, triggerId: made.triggerId };
      current = { ...current, triggers: [...current.triggers, added] };
      await this.k.store.putConnection(current);
    }
    return current;
  }

  async remove(ctx: ActorCtx, spaceId: string, connectionId: string): Promise<void> {
    const space = await this.k.requireMember(ctx, spaceId);
    enforce(canManageConnections(await this.k.store.getMember(ctx.memberId), space));
    const connection = await this.k.store.getConnection(connectionId);
    if (!connection || connection.spaceId !== spaceId) return; // idempotent
    const deps = this.requireDeps();
    // The app's authorisation goes first, and its failure stops here: a connection gone from Harbor with its account still authorised could never be cleaned up from the app.
    await this.platform(() => deps.backend.deleteConnection(connection.id));
    await this.retire(connection);
    await this.k.store.deleteConnection(connection.id);
  }

  /** What a space's deletion leaves outside Harbor (spaces.ts deleteSpace): asked before the rows cascade, cleaned up after. */
  async forSpace(spaceId: string): Promise<StoredConnection[]> {
    return this.k.store.listConnections(spaceId);
  }
  async cleanUp(connections: readonly StoredConnection[]): Promise<void> {
    for (const connection of connections) {
      // Best effort: an event for a connection that is gone answers not_found, which tells the control plane to stop.
      await this.deps?.backend.deleteConnection(connection.id).catch((e) => console.log('[harbor] connections: could not remove a deleted space\'s connection', { id: connection.id, error: (e as Error).message }));
      await this.retire(connection);
    }
  }

  /** What outlives the connection's row: its gateway key is revoked and its member deactivated, out of its space with its posts kept. */
  private async retire(connection: StoredConnection): Promise<void> {
    await this.deps?.billing.revokeGatewayKey(connection.customer, connection.id).catch((e) => console.log('[harbor] connections: could not revoke a gateway key', { id: connection.id, error: (e as Error).message }));
    await this.spaces.deactivateAgent(connection.memberId);
  }

  async events(ctx: ActorCtx, spaceId: string, connectionId: string, opts: { outcome?: ConnectionEventOutcome; limit?: number }): Promise<ConnectionEvent[]> {
    const space = await this.k.requireMember(ctx, spaceId);
    enforce(canManageConnections(await this.k.store.getMember(ctx.memberId), space));
    const connection = await this.k.store.getConnection(connectionId);
    if (!connection || connection.spaceId !== spaceId) throw new HarborError('not_found', 'no such connection in this space');
    const rows = await this.k.store.listConnectionEvents(connectionId, { ...(opts.outcome ? { outcome: opts.outcome } : {}), limit: opts.limit ?? 50 });
    return rows.map((e) => ({
      id: e.eventId,
      trigger: e.triggerSlug,
      ...(e.title ? { title: e.title } : {}),
      ...(e.url ? { url: e.url } : {}),
      outcome: e.outcome,
      ...(e.score !== undefined ? { score: e.score } : {}),
      ...(e.messageId ? { messageId: e.messageId } : {}),
      receivedAt: e.receivedAt,
    }));
  }

  /** The gate every change shares: a member of the space, an org admin, on a server that connects apps. */
  private async managed(ctx: ActorCtx, spaceId: string, connectionId: string): Promise<{ space: Space; connection: StoredConnection; deps: ConnectionsDeps }> {
    const space = await this.k.requireMember(ctx, spaceId);
    enforce(canManageConnections(await this.k.store.getMember(ctx.memberId), space));
    const connection = await this.k.store.getConnection(connectionId);
    if (!connection || connection.spaceId !== spaceId) throw new HarborError('not_found', 'no such connection in this space');
    return { space, connection, deps: this.requireDeps() };
  }

  private requireDeps(): ConnectionsDeps {
    if (!this.deps) throw new HarborError('invalid_request', 'this server connects no apps to spaces');
    return this.deps;
  }

  /** A control-plane call, with its refusal as the caller's: what it says (no credits, a config the app rejects) is for the person. */
  private async platform<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      if (err instanceof HarborError) throw err;
      const status = err instanceof ConnectionsBackendError ? err.status : 0;
      const message = (err as Error).message;
      if (status >= 400 && status < 500) throw new HarborError(status === 404 ? 'not_found' : status === 403 ? 'forbidden' : 'invalid_request', message);
      throw new HarborError('internal', `connections are unavailable right now: ${message}`);
    }
  }

  /**
   * Ask the control plane where the app's authorisation stands, and store
   * what changed. One at a time per connection: a panel polls while its
   * person authorises, and two reads that both saw the authorisation land
   * would each make the owed triggers.
   */
  private refresh(connection: StoredConnection): Promise<StoredConnection> {
    const running = this.refreshing.get(connection.id);
    if (running) return running;
    const next = this.refreshOnce(connection).finally(() => this.refreshing.delete(connection.id));
    this.refreshing.set(connection.id, next);
    return next;
  }

  private async refreshOnce(connection: StoredConnection): Promise<StoredConnection> {
    const deps = this.requireDeps();
    if (!connection.accountId) return connection;
    const account = await deps.backend.account(connection.id, connection.accountId);
    const status = account?.status.toUpperCase();
    let next: StoredConnection;
    if (status === 'ACTIVE') {
      const { problem: _problem, ...rest } = connection;
      next = { ...rest, status: 'active' };
    } else if (status === 'INITIATED' || status === 'INITIALIZING') {
      return connection; // the person has not finished authorising
    } else {
      const why = status ? status.toLowerCase() : 'removed';
      next = { ...connection, status: 'failed', problem: `${connection.app.name} is not authorised (${why}). Authorise it again to resume its updates.` };
    }
    if (next.status === connection.status && next.problem === connection.problem) return connection;
    await this.k.store.putConnection(next);
    return next.status === 'active' ? this.rearm(deps, next) : next;
  }

  /**
   * Make the triggers a connection is owed. Authorising again gives the app a
   * new account on the control plane, and a trigger instance belongs to the
   * account it was made on, so `authorize` clears each trigger's instance and
   * this makes them again once the new account is active. One that fails
   * stays owed and is tried at the next refresh.
   */
  private async rearm(deps: ConnectionsDeps, connection: StoredConnection): Promise<StoredConnection> {
    let current = connection;
    for (const owed of connection.triggers.filter((t) => !t.triggerId)) {
      try {
        const made = await deps.backend.createTrigger(connection.id, { customer: connection.customer, accountId: connection.accountId!, slug: owed.slug, config: owed.config, deliverUrl: deps.deliverUrl() });
        current = { ...current, triggers: current.triggers.map((t) => (t === owed ? { ...t, triggerId: made.triggerId } : t)) };
        await this.k.store.putConnection(current);
      } catch (err) {
        console.log('[harbor] connections: could not make a trigger again', { id: connection.id, slug: owed.slug, error: (err as Error).message });
      }
    }
    return current;
  }

  private async wire(connections: readonly StoredConnection[]): Promise<SpaceConnection[]> {
    const since = new Date(Date.now() - COUNT_WINDOW_MS).toISOString();
    const counts = await this.k.store.connectionCounts(connections.map((c) => c.id), since);
    return connections.map((c) => {
      const count = counts.get(c.id);
      return {
        id: c.id,
        spaceId: c.spaceId,
        memberId: c.memberId,
        app: c.app,
        name: c.name,
        status: c.status,
        ...(c.problem ? { problem: c.problem } : {}),
        triggers: c.triggers.map(({ triggerId: _id, ...t }) => t),
        filter: c.filter,
        paused: c.paused,
        createdBy: c.createdBy,
        createdAt: c.createdAt,
        posted: count?.posted ?? 0,
        skipped: count?.skipped ?? 0,
        ...(count?.lastEventAt ? { lastEventAt: count.lastEventAt } : {}),
      };
    });
  }

  /** The connection's first words, once it listens for something: what it will post and who set it up, so the space knows why updates start arriving. */
  private async announce(connection: StoredConnection, byMemberId: string): Promise<void> {
    const by = (await this.k.store.getMember(byMemberId))?.displayName;
    const names = [...new Set(connection.triggers.map((t) => t.name))];
    const filter = connection.filter && this.jev ? ' Only what matters to this space is posted.' : '';
    const body = clean(`Connected to ${connection.app.name}${by ? ` by ${by}` : ''}. Updates will be posted here for: ${names.join(', ')}.${filter}`);
    await this.post(connection, body).catch((e) => console.log('[harbor] connections: could not announce', { id: connection.id, error: (e as Error).message }));
  }

  private async post(connection: StoredConnection, body: string, threadRoot?: string): Promise<{ id: string; rootId: string }> {
    const { message } = await this.feed.postMessage({ memberId: connection.memberId, agent: true }, connection.spaceId, { body, actingMode: 'direct', ...(threadRoot ? { threadRoot } : {}) });
    return { id: message.id, rootId: message.threadRoot ?? message.id };
  }

  // --- receiving --------------------------------------------------------------------

  /**
   * One event from the control plane. Its signature is the credential, then
   * its `ref` names the connection, which must be this org's. Taken once per
   * id and answered before it is decided. A paused connection, an archived
   * space, or a trigger the connection no longer listens for drops the event
   * quietly: the delivery was right, there is just nothing to do with it.
   * Answers whether the event was newly taken, which is what the control
   * plane bills: a redelivery and a dropped event cost their person nothing.
   */
  async receive(delivery: { timestamp: string | undefined; signature: string | undefined; body: string }): Promise<boolean> {
    const deps = this.deps;
    // The same answer for a server without connections and a bad signature: nothing here to probe.
    if (!deps || !deps.backend.verify(delivery)) throw new HarborError('unauthorized', 'the delivery is not signed by the control plane');
    let json: unknown;
    try {
      json = JSON.parse(delivery.body);
    } catch {
      throw new HarborError('invalid_request', 'a delivery is a JSON body');
    }
    const parsed = ConnectionDelivery.safeParse(json);
    if (!parsed.success) throw new HarborError('invalid_request', 'the delivery is not an event');
    const event = parsed.data;
    const connection = await this.k.store.getConnection(event.ref);
    if (!connection) throw new HarborError('not_found', 'no such connection');
    if (connection.paused || this.k.readOnly) return false;
    if (!connection.triggers.some((t) => t.triggerId !== '' && t.triggerId === event.triggerId)) return false;
    if ((await this.k.store.getSpace(connection.spaceId))?.archived) return false;
    const url = urlOf(event.data);
    const title = titleOf(event.data);
    const subject = subjectOf(event.data);
    const taken = await this.k.store.insertConnectionEvent(
      {
        connectionId: connection.id,
        spaceId: connection.spaceId,
        eventId: event.id,
        triggerSlug: event.triggerSlug,
        receivedAt: this.k.now(),
        outcome: 'pending',
        ...(title ? { title } : {}),
        ...(url ? { url } : {}),
        ...(subject ? { subject } : {}),
        payload: event.data ?? null,
        attempts: 0,
      },
      EVENTS_KEPT,
    );
    if (taken) void this.tick();
    return taken;
  }

  // --- the worker -------------------------------------------------------------------

  /** One pass at a time; a delivery that lands during a pass asks for another, so it is not left for the next tick. */
  private tick(): Promise<void> {
    if (this.ticking) {
      this.again = true;
      return this.ticking;
    }
    this.ticking = this.drive()
      .catch((err) => console.log('[harbor] connections: pass failed', (err as Error).message))
      .finally(() => {
        this.ticking = undefined;
        if (this.again && this.timer) {
          this.again = false;
          void this.tick();
        }
      });
    return this.ticking;
  }

  private async drive(): Promise<void> {
    if (!this.deps || this.k.readOnly) return;
    for (const event of await this.k.store.listPendingConnectionEvents(EVENTS_PER_PASS)) await this.decide(event);
    const every = this.options.accountCheckMs ?? DEFAULT_ACCOUNT_CHECK_MS;
    if (Date.now() - this.lastAccountCheck >= every) {
      this.lastAccountCheck = Date.now();
      await this.checkAccounts();
    }
  }

  /** Decide one event: ask Jev when the filter is on, word it, post it, record what happened. A failure is one more try, three at most. */
  private async decide(event: StoredConnectionEvent): Promise<void> {
    const key = { connectionId: event.connectionId, eventId: event.eventId };
    try {
      const connection = await this.k.store.getConnection(event.connectionId);
      const space = connection ? await this.k.store.getSpace(connection.spaceId) : undefined;
      if (!connection || !space || space.archived) {
        await this.k.store.settleConnectionEvent({ ...key, outcome: 'failed', attempts: event.attempts });
        return;
      }
      const trigger = await this.triggerOf(connection, event.triggerSlug);
      const payload = digest(event.payload);
      const existing = event.subject ? await this.k.store.findConnectionThread(connection.id, event.subject) : undefined;
      const threadRoot = existing && (await this.threadIsLive(connection.spaceId, existing)) ? existing : undefined;
      let score: number | undefined;
      // The last try posts without asking: Jev being down must not cost the space its updates.
      if (connection.filter && this.jev && event.attempts < MAX_ATTEMPTS - 1) {
        const topics = space.graph ? await this.topicsOf(space.id) : [];
        const { state, questions } = worthRequest({
          spaceName: space.name,
          topics,
          app: connection.app.name,
          trigger,
          ...(event.title ? { title: event.title } : {}),
          payload,
          followsUp: threadRoot !== undefined,
        });
        score = worthAnswer(await this.jev.ask(state, questions));
        if (score < WORTH_MIN) {
          await this.k.store.settleConnectionEvent({ ...key, outcome: 'skipped', attempts: event.attempts, score });
          return;
        }
      }
      const body = await this.word(connection, { trigger, payload, ...(event.url ? { url: event.url } : {}), ...(event.title ? { title: event.title } : {}), followsUp: threadRoot !== undefined });
      const posted = await this.post(connection, body, threadRoot);
      await this.k.store.settleConnectionEvent({ ...key, outcome: 'posted', attempts: event.attempts, ...(score !== undefined ? { score } : {}), messageId: posted.id, rootMessageId: posted.rootId });
    } catch (err) {
      const attempts = event.attempts + 1;
      console.log('[harbor] connections: event failed', { connectionId: event.connectionId, attempts, error: (err as Error).message });
      await this.k.store.settleConnectionEvent({ ...key, outcome: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', attempts }).catch(() => undefined);
    }
  }

  /** The post's words: the model's, cleaned, or a plain line when the model is out of reach or out of credit. */
  private async word(connection: StoredConnection, input: { trigger: { name: string; description: string }; payload: ReturnType<typeof digest>; url?: string; title?: string; followsUp: boolean }): Promise<string> {
    const deps = this.requireDeps();
    try {
      if (!connection.sealedKey) throw new Error('the connection has no gateway key');
      const text = await deps.writer.write(deps.unseal(connection.sealedKey, connection.id), writePrompt({ app: connection.app.name, trigger: input.trigger, payload: input.payload, ...(input.url ? { url: input.url } : {}), followsUp: input.followsUp }));
      const body = clean(text);
      if (body) return body;
    } catch (err) {
      console.log('[harbor] connections: writing fell back to a plain line', { connectionId: connection.id, error: (err as Error).message });
    }
    return fallbackUpdate({ app: connection.app.name, trigger: input.trigger.name, ...(input.title ? { title: input.title } : {}), ...(input.url ? { url: input.url } : {}) });
  }

  private async triggerOf(connection: StoredConnection, slug: string): Promise<{ name: string; description: string }> {
    const name = connection.triggers.find((t) => t.slug === slug)?.name ?? slug;
    // What the trigger fires on, in the app's words, when the catalogue answers; the name alone otherwise.
    const type = (await this.typesOf(connection.app.slug).catch(() => [])).find((t) => t.slug === slug);
    return { name, description: type?.description ?? '' };
  }

  private async topicsOf(spaceId: string): Promise<string[]> {
    return (await this.k.store.listGraphTopics(spaceId))
      .filter((t) => !t.aliasOf && t.real >= TOPIC_MIN)
      .sort((a, b) => b.threads - a.threads)
      .map((t) => t.label);
  }

  /** A thread to reply in is one whose root is still there: a deleted root sends the update to the top level, as a new thread. */
  private async threadIsLive(spaceId: string, rootMessageId: string): Promise<boolean> {
    const root = await this.k.store.getMessage(spaceId, rootMessageId);
    return !!root && !root.deletedAt;
  }

  /**
   * An authorisation can lapse while a connection sits quiet, and then no
   * event arrives to say so. Each active one is asked about now and then; one
   * that lapsed is marked failed and says so in its space once, since the
   * silence that follows would otherwise look like nothing happening.
   */
  private async checkAccounts(): Promise<void> {
    for (const connection of await this.k.store.listAllConnections()) {
      if (connection.status !== 'active') continue;
      try {
        const next = await this.refresh(connection);
        if (next.status === 'failed') {
          await this.post(next, clean(`${next.app.name} stopped sending updates here: its authorisation ended. An admin can authorise it again in this space's settings, under Connections.`));
        }
      } catch (err) {
        console.log('[harbor] connections: could not check an authorisation', { id: connection.id, error: (err as Error).message });
      }
    }
  }
}

const connectable = (app: BackendApp): boolean => app.triggersCount > 0 && app.managedAuth;

function appOf(app: BackendApp): ConnectionApp {
  return {
    slug: app.slug.toLowerCase(),
    name: app.name,
    ...(app.logo ? { logo: app.logo } : {}),
    ...(app.description ? { description: app.description.slice(0, 2000) } : {}),
    triggersCount: app.triggersCount,
  };
}

/** What makes two triggers the same one: the slug and the settings. */
const identity = (t: { slug: string; config: Record<string, unknown> }): string => `${t.slug}\n${canonical(t.config)}`;

/** The fields a trigger's config schema requires. */
function requiredOf(schema: Record<string, unknown>): string[] {
  const required = schema.required;
  return Array.isArray(required) ? required.filter((field): field is string => typeof field === 'string') : [];
}

/** A config's identity: its JSON with keys in order, so the same settings sent in another order are the same trigger. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
