import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Managed orgs ride the Rowboat account session (one session, two uses —
// 2026-09-14). Under test: the registry's handling of `session` records and
// of the pre-`session` `oauth` records whose issuer IS the Rowboat desk —
// their stored tokens are ignored (never migrated), and the apex listing
// rewrites them in place. Foreign and dev records are never touched.

const workDir = mkdtempSync(path.join(tmpdir(), 'spaces-session-test-'));
process.env.ROWBOAT_WORKDIR = workDir;

type Orgs = typeof import('./orgs.js');
type OrgRecord = import('./orgs.js').OrgRecord;
let orgs: Orgs;

const MANAGED = 'https://proj.supabase.co/auth/v1';
const FOREIGN = 'https://keycloak.example/realms/acme';
const CONFIG = path.join(workDir, 'config', 'spaces_orgs.json');

function seed(records: OrgRecord[]): void {
    mkdirSync(path.dirname(CONFIG), { recursive: true });
    writeFileSync(CONFIG, JSON.stringify({ version: 1, orgs: records }));
}

function stored(): OrgRecord[] {
    return JSON.parse(readFileSync(CONFIG, 'utf-8')).orgs;
}

const legacyManaged: OrgRecord = {
    id: 'org-legacy',
    name: 'Rowboat',
    address: 'rowboat.spaces.example',
    baseUrl: 'https://rowboat.spaces.example',
    auth: {
        kind: 'oauth',
        issuer: `${MANAGED}/`, // trailing slash: issuer comparison must not care
        clientId: 'old-client',
        memberId: 'm-old',
        tokens: { access: 'stale', refresh: 'stale', expiresAt: 0 },
    },
};
const foreign: OrgRecord = {
    id: 'org-foreign',
    name: 'Acme',
    address: 'spaces.acme.example',
    baseUrl: 'https://spaces.acme.example',
    auth: {
        kind: 'oauth',
        issuer: FOREIGN,
        clientId: 'acme-client',
        memberId: 'm-acme',
        tokens: { access: 'acme-access', refresh: 'r', expiresAt: 4102444800 },
    },
};
const dev: OrgRecord = {
    id: 'org-dev',
    name: 'Dev',
    address: 'localhost:4272',
    baseUrl: 'http://localhost:4272',
    auth: { kind: 'dev', memberId: 'ramnique' },
};
const staleSession: OrgRecord = {
    id: 'org-left',
    name: 'Left Behind',
    address: 'left.spaces.example',
    baseUrl: 'https://left.spaces.example',
    serverOrgId: 'org-01LEFT',
    auth: { kind: 'session', issuer: MANAGED, memberId: 'm-left' },
};

beforeAll(async () => {
    orgs = await import('./orgs.js');
});

beforeEach(() => {
    orgs.setManagedIssuerForTests(MANAGED);
    seed([legacyManaged, foreign, dev, staleSession]);
});

describe('isSessionBacked', () => {
    it('is true for session records and for oauth records on the managed issuer, false otherwise', async () => {
        expect(await orgs.isSessionBacked(staleSession.auth)).toBe(true);
        expect(await orgs.isSessionBacked(legacyManaged.auth)).toBe(true);
        expect(await orgs.isSessionBacked(foreign.auth)).toBe(false);
        expect(await orgs.isSessionBacked(dev.auth)).toBe(false);
    });

    it('treats nothing as managed while the managed issuer is unknown', async () => {
        orgs.setManagedIssuerForTests(null);
        expect(await orgs.isSessionBacked(legacyManaged.auth)).toBe(false);
    });
});

describe('applyManagedListing', () => {
    it('rewrites a legacy managed record in place, adds new ones, drops session records the apex no longer lists, and leaves foreign + dev alone', () => {
        orgs.applyManagedListing(
            [
                { id: 'org-01ROWBOAT', name: 'Rowboat Labs', address: 'rowboat.spaces.example', memberId: 'm-new' },
                { id: 'org-01NEW', name: 'New Org', address: 'new.spaces.example', memberId: 'm-new' },
            ],
            { apexOrigin: 'https://spaces.example', issuer: MANAGED },
        );
        const after = stored();
        const byId = Object.fromEntries(after.map((o) => [o.id, o]));

        // The legacy record kept its local id (links, MCP names) and lost its tokens.
        expect(byId['org-legacy']).toMatchObject({
            name: 'Rowboat Labs',
            serverOrgId: 'org-01ROWBOAT',
            auth: { kind: 'session', issuer: MANAGED, memberId: 'm-new' },
        });
        expect((byId['org-legacy']!.auth as { tokens?: unknown }).tokens).toBeUndefined();

        const added = after.find((o) => o.serverOrgId === 'org-01NEW');
        expect(added).toMatchObject({ baseUrl: 'https://new.spaces.example', auth: { kind: 'session', memberId: 'm-new' } });

        expect(byId['org-left']).toBeUndefined();
        expect(byId['org-foreign']).toEqual(foreign);
        expect(byId['org-dev']).toEqual(dev);
    });

    it('is idempotent: applying the same listing twice changes nothing', () => {
        const listing = [{ id: 'org-01ROWBOAT', name: 'Rowboat', address: 'rowboat.spaces.example', memberId: 'm-new' }];
        orgs.applyManagedListing(listing, { apexOrigin: 'https://spaces.example', issuer: MANAGED });
        const once = stored();
        orgs.applyManagedListing(listing, { apexOrigin: 'https://spaces.example', issuer: MANAGED });
        expect(stored()).toEqual(once);
    });
});

describe('dropSessionOrgs', () => {
    it('removes only session records (signed out: the orgs that borrowed the session go)', () => {
        orgs.dropSessionOrgs();
        expect(stored().map((o) => o.id).sort()).toEqual(['org-dev', 'org-foreign', 'org-legacy']);
    });
});

describe('deriveSpacesMcpServers with a session', () => {
    it('gives session-backed orgs the session bearer and foreign orgs their own token', () => {
        const entries = orgs.deriveSpacesMcpServers([legacyManaged, foreign, dev, staleSession], {
            bearer: 'session-access',
            issuer: MANAGED,
        });
        expect(entries['spaces-rowboat']!.headers.authorization).toBe('Bearer session-access');
        expect(entries['spaces-left-behind']!.headers.authorization).toBe('Bearer session-access');
        expect(entries['spaces-acme']!.headers.authorization).toBe('Bearer acme-access');
        expect(entries['spaces-dev']!.headers.authorization).toBe('Bearer dev-ramnique');
    });
});

// The listing sync runs on every org listing (at most every 30s) and upserts
// each managed org again. A socket carrying open subscriptions must survive
// that: only a record whose address or identity changed turns it over.
describe('upsertSessionOrg and the org\'s live client', () => {
    const live: OrgRecord = {
        id: 'org-live',
        name: 'Live',
        address: 'live.spaces.example',
        baseUrl: 'https://live.spaces.example',
        serverOrgId: 'org-01LIVE',
        auth: { kind: 'session', issuer: MANAGED, memberId: 'm-live' },
    };
    const same = { baseUrl: live.baseUrl, name: live.name, address: live.address, serverOrgId: 'org-01LIVE', issuer: MANAGED, memberId: 'm-live' };

    function install() {
        seed([live]);
        const close = vi.fn();
        orgs.setRuntimeForTests('org-live', { client: {} as never, live: { close } as never });
        const resets: string[] = [];
        const off = orgs.onRuntimeReset((id) => resets.push(id));
        return { close, resets, off };
    }

    it('an unchanged listing keeps the client — renamed or not', () => {
        const { close, resets, off } = install();
        orgs.upsertSessionOrg(same);
        orgs.upsertSessionOrg({ ...same, name: 'Live (renamed)' });
        orgs.applyManagedListing([{ id: 'org-01LIVE', name: 'Live', address: live.address, memberId: 'm-live' }], { apexOrigin: 'https://apex.example', issuer: MANAGED });
        expect(close).not.toHaveBeenCalled();
        expect(resets).toEqual([]);
        off();
    });

    it('a changed address or identity closes the client and tells the host', () => {
        const { close, resets, off } = install();
        orgs.upsertSessionOrg({ ...same, memberId: 'm-other' });
        expect(close).toHaveBeenCalledTimes(1);
        expect(resets).toEqual(['org-live']);
        orgs.setRuntimeForTests('org-live', { client: {} as never, live: { close } as never });
        orgs.upsertSessionOrg({ ...same, memberId: 'm-other', baseUrl: 'https://live2.spaces.example' });
        expect(close).toHaveBeenCalledTimes(2);
        expect(resets).toEqual(['org-live', 'org-live']);
        off();
    });

    it('a legacy oauth record rewritten to session turns the client over once', () => {
        seed([legacyManaged]);
        const close = vi.fn();
        orgs.setRuntimeForTests('org-legacy', { client: {} as never, live: { close } as never });
        orgs.upsertSessionOrg({ baseUrl: legacyManaged.baseUrl, name: 'Rowboat', address: legacyManaged.address, issuer: MANAGED, memberId: 'm-old' });
        expect(close).toHaveBeenCalledTimes(1);
        expect(stored().find((o) => o.id === 'org-legacy')?.auth.kind).toBe('session');
    });
});
