import { describe, expect, it } from 'vitest';
import { readNote, sessionFrom, signedOut, startCloudLink, staysOnDevice, type CloudLinkDeps, type HostMode, type LinkProblem } from '../src/cloud-link.js';

const NOW = Date.UTC(2026, 9, 1, 9, 0, 0);
const oauth = (token: string | null, expiresAt = NOW / 1000 + 3600) =>
  JSON.stringify({ version: 2, providers: { rowboat: { mode: 'rowboat', tokens: token ? { access_token: token, expires_at: expiresAt } : null } } });

// Whose session a token is, as the control plane's /v1/me says: Moussa's
// tokens name him, every other one is Awa's (a refresh keeps the account).
const accountOf = (token: string) => (token.includes('moussa') ? 'acct_moussa' : 'acct_awa');
const me = (token: string) => new Response(JSON.stringify({ user: { id: accountOf(token), email: null } }), { status: 200 });

function setup(
  answer: (token: string) => Response,
  connects: Array<{ success: boolean; error?: string }> = [{ success: true }],
  disconnects: Array<{ success: boolean; error?: string }> = [{ success: true }],
  options: { me?: (token: string) => Response; note?: string } = {},
) {
  let file = oauth(null);
  let note = options.note ?? '';
  let mode: HostMode = 'child';
  let onChange = () => {};
  const calls = { devices: [] as Array<{ token: string; name: string }>, revoked: [] as string[], me: 0, connect: [] as string[], disconnects: 0, reloads: 0, problems: [] as LinkProblem[], sleeps: 0 };
  const deps: CloudLinkDeps = {
    apiUrl: 'https://app.baarali.test',
    oauthFile: '/w/config/oauth.json',
    linkFile: '/w/config/baarali-link.json',
    mode: () => mode,
    connect: async (url, key) => {
      calls.connect.push(`${url} ${key}`);
      const result = connects.shift() ?? { success: false, error: 'down' };
      if (result.success) mode = 'remote';
      return result;
    },
    disconnect: async () => {
      calls.disconnects++;
      const result = disconnects.shift() ?? { success: false, error: 'set by the environment' };
      if (result.success) mode = 'child';
      return result;
    },
    reload: () => void calls.reloads++,
    notify: (p) => void calls.problems.push(p),
    deviceName: () => 'MacBook de Awa',
    readFile: async (f) => (f === '/w/config/baarali-link.json' ? note : file),
    writeFile: async (_f, data) => void (note = data),
    watch: (_f, cb) => {
      onChange = cb;
      return () => {
        onChange = () => {};
      };
    },
    fetch: (async (url: string, init: RequestInit) => {
      const token = String((init.headers as Record<string, string>).authorization).replace('Bearer ', '');
      if (init.method === 'DELETE') {
        calls.revoked.push(`${token} ${url.split('/').pop()}`);
        return new Response(null, { status: 204 });
      }
      if (url.endsWith('/v1/me')) {
        calls.me++;
        return (options.me ?? me)(token);
      }
      calls.devices.push({ token, name: JSON.parse(String(init.body)).name });
      return answer(token);
    }) as typeof fetch,
    now: () => NOW,
    sleep: async () => void calls.sleeps++,
    log: () => {},
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return {
    calls,
    start: () => startCloudLink(deps),
    signIn: async (token: string, expiresAt?: number) => {
      file = oauth(token, expiresAt);
      onChange();
      for (let i = 0; i < 5; i++) await settle();
    },
    /** What core leaves in oauth.json on sign-out: the provider removed. */
    signOut: async () => {
      file = JSON.stringify({ version: 2, providers: {} });
      onChange();
      for (let i = 0; i < 5; i++) await settle();
    },
    /** The file as a reader may catch it while core rewrites it. */
    write: async (raw: string) => {
      file = raw;
      onChange();
      for (let i = 0; i < 5; i++) await settle();
    },
    settle,
    setMode: (m: HostMode) => (mode = m),
    /** Whose instance the app noted it joined. */
    noted: () => readNote(note).accountId,
    devicesNoted: () => readNote(note).devices,
  };
}

const granted = () =>
  new Response(JSON.stringify({ device: { id: 'dev_1' }, server: { url: 'https://app.baarali.test/instance', key: 'bdk_k' } }), { status: 201 });

describe('readNote', () => {
  it('reads the account noted and its devices, leniently', () => {
    expect(readNote('{"accountId":"acct_awa","devices":{"acct_awa":"dev_1","x":3}}')).toEqual({ accountId: 'acct_awa', devices: { acct_awa: 'dev_1' } });
    expect(readNote('{"accountId":"acct_awa"}')).toEqual({ accountId: 'acct_awa', devices: {} });
    expect(readNote('')).toEqual({ accountId: null, devices: {} });
    expect(readNote('{"accountId":"","devices":[]}')).toEqual({ accountId: null, devices: {} });
    expect(readNote('null')).toEqual({ accountId: null, devices: {} });
  });
});

describe('sessionFrom', () => {
  it('reads the rowboat session, and nothing else', () => {
    expect(sessionFrom(oauth('at-1', 42))).toEqual({ accessToken: 'at-1', expiresAt: 42 });
    expect(sessionFrom(oauth(null))).toBeNull();
    expect(sessionFrom('not json')).toBeNull();
    expect(sessionFrom(JSON.stringify({ providers: { google: { tokens: { access_token: 'g' } } } }))).toBeNull();
  });
});

describe('signedOut', () => {
  it('is a whole file without a Baarali session, never a file being written', () => {
    expect(signedOut(JSON.stringify({ version: 2, providers: {} }))).toBe(true);
    expect(signedOut(oauth(null))).toBe(true);
    expect(signedOut(oauth('at-1'))).toBe(false);
    expect(signedOut('')).toBe(false);
    expect(signedOut('{"version":2,"provi')).toBe(false);
    expect(signedOut('[]')).toBe(false);
  });
});

// Seen 03/10/2026: joined to an instance, signing in again went to the
// instance, which then acted for another account than the app's.
describe('staysOnDevice', () => {
  it('keeps Baarali sign-in and sign-out here once joined to an instance', () => {
    expect(staysOnDevice('oauth:connect', { provider: 'rowboat' }, 'remote')).toBe(true);
    expect(staysOnDevice('oauth:disconnect', { provider: 'rowboat' }, 'remote')).toBe(true);
  });

  it('leaves the other providers, the other calls and the app\'s own server as they were', () => {
    expect(staysOnDevice('oauth:connect', { provider: 'google' }, 'remote')).toBe(false);
    expect(staysOnDevice('oauth:getState', { provider: 'rowboat' }, 'remote')).toBe(false);
    expect(staysOnDevice('models:list', null, 'remote')).toBe(false);
    expect(staysOnDevice('oauth:disconnect', { provider: 'rowboat' }, 'child')).toBe(false);
    expect(staysOnDevice('oauth:disconnect', null, 'remote')).toBe(false);
  });
});

describe('startCloudLink', () => {
  it('gets a device key once signed in, connects to the gateway and reloads', async () => {
    const t = setup(granted);
    t.start();
    await t.settle();
    expect(t.calls.devices).toEqual([]);
    await t.signIn('at-1');
    expect(t.calls.devices).toEqual([{ token: 'at-1', name: 'MacBook de Awa' }]);
    expect(t.calls.connect).toEqual(['https://app.baarali.test/instance bdk_k']);
    expect(t.calls.reloads).toBe(1);
    expect(t.noted()).toBe('acct_awa');
  });

  it('waits for a new instance to boot', async () => {
    const t = setup(granted, [{ success: false, error: 'no server' }, { success: false, error: 'no server' }, { success: true }]);
    t.start();
    await t.signIn('at-1');
    expect(t.calls.connect).toHaveLength(3);
    expect(t.calls.sleeps).toBe(2);
    expect(t.calls.reloads).toBe(1);
  });

  it('does nothing once connected to the account\'s instance, nor with an expired session', async () => {
    const t = setup(granted, [{ success: true }], [{ success: true }], { note: '{"accountId":"acct_awa"}' });
    t.setMode('remote');
    await t.signIn('at-1');
    t.start();
    await t.signIn('at-1b');
    expect(t.calls.disconnects).toBe(0);
    t.setMode('child');
    await t.signIn('at-2', NOW / 1000 - 1);
    expect(t.calls.devices).toEqual([]);
  });

  it('says early access is full, and does not ask again for the same session', async () => {
    const t = setup(() => new Response(JSON.stringify({ error: { code: 'instances_full' } }), { status: 503 }));
    t.start();
    await t.signIn('at-1');
    await t.signIn('at-1');
    expect(t.calls.devices).toHaveLength(1);
    expect(t.calls.problems).toEqual(['instances_full']);
    expect(t.calls.connect).toEqual([]);
  });

  it('stays silent on a session that is not ours', async () => {
    const unauthorized = () => new Response(JSON.stringify({ error: { code: 'unauthorized' } }), { status: 401 });
    const t = setup(unauthorized, [{ success: true }], [{ success: true }], { me: unauthorized });
    t.start();
    await t.signIn('at-1');
    expect(t.calls.problems).toEqual([]);
  });

  it('gives up after its attempts and says the instance is unavailable', async () => {
    const t = setup(granted, []);
    t.start();
    await t.signIn('at-1');
    for (let i = 0; i < 20; i++) await t.settle();
    expect(t.calls.connect).toHaveLength(8);
    expect(t.calls.problems).toEqual(['unavailable']);
    expect(t.calls.reloads).toBe(0);
  });

  it('leaves the instance on sign-out, then joins the instance of the next account signed in', async () => {
    const t = setup((token) =>
      new Response(JSON.stringify({ device: { id: `dev_${token}` }, server: { url: 'https://app.baarali.test/instance', key: `bdk_${token}` } }), { status: 201 }),
      [{ success: true }, { success: true }],
    );
    t.start();
    await t.signIn('at-awa');
    await t.signOut();
    expect(t.calls.disconnects).toBe(1);
    expect(t.calls.reloads).toBe(2);
    await t.signIn('at-moussa');
    expect(t.calls.connect).toEqual(['https://app.baarali.test/instance bdk_at-awa', 'https://app.baarali.test/instance bdk_at-moussa']);
    expect(t.calls.reloads).toBe(3);
  });

  it('leaves an instance it was joined to without any session on this computer', async () => {
    const t = setup(granted);
    t.setMode('remote');
    t.start();
    for (let i = 0; i < 5; i++) await t.settle();
    expect(t.calls.disconnects).toBe(1);
    expect(t.calls.reloads).toBe(1);
  });

  it('stays joined while the file is being rewritten, and on a refreshed session', async () => {
    const t = setup(granted);
    t.start();
    await t.signIn('at-1');
    await t.write('{"version":2,"provi');
    await t.write('');
    await t.signIn('at-2');
    expect(t.calls.disconnects).toBe(0);
    expect(t.calls.devices).toHaveLength(1);
  });

  it('stays joined, and says nothing, when it cannot leave', async () => {
    const t = setup(granted, [{ success: true }], [{ success: false, error: 'set by the environment' }]);
    t.start();
    await t.signIn('at-1');
    await t.signOut();
    expect(t.calls.disconnects).toBe(1);
    expect(t.calls.reloads).toBe(1);
    expect(t.calls.problems).toEqual([]);
  });

  // Seen 04/10/2026: signed in with another account without signing out
  // first, the app stayed on the first account's instance.
  it('moves to the instance of another account signed in, without a sign-out first', async () => {
    const t = setup((token) =>
      new Response(JSON.stringify({ device: { id: `dev_${token}` }, server: { url: 'https://app.baarali.test/instance', key: `bdk_${token}` } }), { status: 201 }),
      [{ success: true }, { success: true }],
    );
    t.start();
    await t.signIn('at-awa');
    await t.signIn('at-moussa');
    expect(t.calls.disconnects).toBe(1);
    expect(t.calls.connect).toEqual(['https://app.baarali.test/instance bdk_at-awa', 'https://app.baarali.test/instance bdk_at-moussa']);
    expect(t.noted()).toBe('acct_moussa');
    expect(t.calls.reloads).toBe(2);
  });

  it('joins again, once, an instance joined before the app noted whose it is', async () => {
    const t = setup(granted);
    t.setMode('remote');
    await t.signIn('at-1');
    t.start();
    for (let i = 0; i < 5; i++) await t.settle();
    expect(t.calls.disconnects).toBe(1);
    expect(t.calls.devices).toHaveLength(1);
    expect(t.noted()).toBe('acct_awa');
    await t.signIn('at-2');
    expect(t.calls.disconnects).toBe(1);
  });

  it('stays where it is while the control plane cannot say whose the session is, and looks again later', async () => {
    let up = false;
    const t = setup(granted, [{ success: true }], [{ success: true }], {
      note: '{"accountId":"acct_awa"}',
      me: (token) => (up ? me(token) : new Response('', { status: 503 })),
    });
    t.setMode('remote');
    await t.signIn('at-moussa');
    t.start();
    for (let i = 0; i < 5; i++) await t.settle();
    expect(t.calls.disconnects).toBe(0);
    expect(t.calls.problems).toEqual([]);
    up = true;
    await t.signIn('at-moussa');
    expect(t.calls.disconnects).toBe(1);
    expect(t.noted()).toBe('acct_moussa');
  });

  it('shows the app\'s own server again when the other account\'s instance cannot be joined', async () => {
    const t = setup(() => new Response(JSON.stringify({ error: { code: 'instances_full' } }), { status: 503 }), [], [{ success: true }], { note: '{"accountId":"acct_awa"}' });
    t.setMode('remote');
    await t.signIn('at-moussa');
    t.start();
    for (let i = 0; i < 5; i++) await t.settle();
    expect(t.calls.disconnects).toBe(1);
    expect(t.calls.problems).toEqual(['instances_full']);
    expect(t.calls.reloads).toBe(1);
    expect(t.noted()).toBe('acct_awa');
  });

  it('revokes this computer\'s previous device before joining the same account again', async () => {
    let n = 0;
    const t = setup(
      () => new Response(JSON.stringify({ device: { id: `dev_${++n}` }, server: { url: 'https://app.baarali.test/instance', key: `bdk_${n}` } }), { status: 201 }),
      [{ success: true }, { success: true }, { success: true }],
      [{ success: true }, { success: true }],
    );
    t.start();
    await t.signIn('at-awa');
    await t.signOut();
    await t.signIn('at-awa-2');
    expect(t.calls.revoked).toEqual(['at-awa-2 dev_1']);
    await t.signIn('at-moussa');
    // Moussa never joined from here: nothing of his to revoke.
    expect(t.calls.revoked).toEqual(['at-awa-2 dev_1']);
    expect(t.devicesNoted()).toEqual({ acct_awa: 'dev_2', acct_moussa: 'dev_3' });
  });
});
