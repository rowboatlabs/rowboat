import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Rowboat's server rides the Rowboat account session (one session, two uses —
// 2026-09-14). Under test: the one-record registry (2026-11-09: one server,
// the record replaced in place) — `session` records, `oauth` records whose
// issuer IS the Rowboat desk (their stored tokens are ignored, never
// migrated), and when the live client turns over.

const workDir = mkdtempSync(path.join(tmpdir(), 'spaces-session-test-'));
process.env.ROWBOAT_WORKDIR = workDir;

type Orgs = typeof import('./orgs.js');
type OrgRecord = import('./orgs.js').OrgRecord;
let orgs: Orgs;

const MANAGED = 'https://proj.supabase.co/auth/v1';
const FOREIGN = 'https://keycloak.example/realms/acme';
const CONFIG = path.join(workDir, 'config', 'spaces_server.json');

function seed(record: OrgRecord | null): void {
    mkdirSync(path.dirname(CONFIG), { recursive: true });
    writeFileSync(CONFIG, JSON.stringify({ version: 2, server: record }));
}

function stored(): OrgRecord | null {
    return JSON.parse(readFileSync(CONFIG, 'utf-8')).server;
}

const legacyManaged: OrgRecord = {
    id: 'server',
    name: 'Rowboat',
    address: 'spaces.example',
    baseUrl: 'https://spaces.example',
    auth: {
        kind: 'oauth',
        issuer: `${MANAGED}/`, // trailing slash: issuer comparison must not care
        clientId: 'old-client',
        memberId: 'm-old',
        tokens: { access: 'stale', refresh: 'stale', expiresAt: 0 },
    },
};
const foreign: OrgRecord = {
    id: 'server',
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
    id: 'server',
    name: 'Dev',
    address: 'localhost:4272',
    baseUrl: 'http://localhost:4272',
    auth: { kind: 'dev', memberId: 'ramnique' },
};
const session: OrgRecord = {
    id: 'server',
    name: 'Rowboat',
    address: 'spaces.example',
    baseUrl: 'https://spaces.example',
    auth: { kind: 'session', issuer: MANAGED, memberId: 'm-live' },
};

beforeAll(async () => {
    orgs = await import('./orgs.js');
});

beforeEach(() => {
    orgs.setManagedIssuerForTests(MANAGED);
});

describe('isSessionBacked', () => {
    it('is true for session records and for oauth records on the managed issuer, false otherwise', async () => {
        expect(await orgs.isSessionBacked(session.auth)).toBe(true);
        expect(await orgs.isSessionBacked(legacyManaged.auth)).toBe(true);
        expect(await orgs.isSessionBacked(foreign.auth)).toBe(false);
        expect(await orgs.isSessionBacked(dev.auth)).toBe(false);
    });

    it('treats nothing as managed while the managed issuer is unknown', async () => {
        orgs.setManagedIssuerForTests(null);
        expect(await orgs.isSessionBacked(legacyManaged.auth)).toBe(false);
    });
});

describe('the one record', () => {
    it('lists one server or none, under SPACES_SERVER_ID', () => {
        seed(null);
        expect(orgs.listOrgs()).toEqual([]);
        expect(orgs.getOrg(orgs.SPACES_SERVER_ID)).toBeUndefined();
        seed(foreign);
        expect(orgs.listOrgs()).toEqual([foreign]);
        expect(orgs.getOrg(orgs.SPACES_SERVER_ID)).toEqual(foreign);
        expect(orgs.getOrg('org-1')).toBeUndefined();
    });

    it('a session record replaces what was there; a legacy oauth record on the Rowboat desk loses its tokens', () => {
        seed(legacyManaged);
        orgs.upsertSessionOrg({ baseUrl: legacyManaged.baseUrl, name: 'Rowboat Labs', address: legacyManaged.address, issuer: MANAGED, memberId: 'm-old' });
        expect(stored()).toMatchObject({ id: 'server', name: 'Rowboat Labs', auth: { kind: 'session', issuer: MANAGED, memberId: 'm-old' } });
        expect((stored()!.auth as { tokens?: unknown }).tokens).toBeUndefined();
        seed(foreign);
        orgs.upsertSessionOrg({ baseUrl: session.baseUrl, name: session.name, address: session.address, issuer: MANAGED, memberId: 'm-live' });
        expect(stored()).toEqual(session);
    });

    it('dropSessionOrgs removes only a session record (signed out: the server that borrowed the session goes)', () => {
        seed(foreign);
        orgs.dropSessionOrgs();
        expect(stored()).toEqual(foreign);
        seed(dev);
        orgs.dropSessionOrgs();
        expect(stored()).toEqual(dev);
        seed(session);
        orgs.dropSessionOrgs();
        expect(stored()).toBeNull();
    });

    it('removeOrg forgets the record', async () => {
        seed(session);
        await orgs.removeOrg(orgs.SPACES_SERVER_ID);
        expect(stored()).toBeNull();
        expect(orgs.listOrgs()).toEqual([]);
    });
});

describe('deriveSpacesMcpServers with a session', () => {
    it('gives a session-backed record the session bearer and a self-hosted one its own token', () => {
        const withSession = { bearer: 'sess', issuer: MANAGED };
        expect(orgs.deriveSpacesMcpServers([legacyManaged], withSession)['spaces-rowboat']!.headers.authorization).toBe('Bearer sess');
        expect(orgs.deriveSpacesMcpServers([session], withSession)['spaces-rowboat']!.headers.authorization).toBe('Bearer sess');
        expect(orgs.deriveSpacesMcpServers([foreign], withSession)['spaces-acme']!.headers.authorization).toBe('Bearer acme-access');
        expect(orgs.deriveSpacesMcpServers([dev], withSession)['spaces-dev']!.headers.authorization).toBe('Bearer dev-ramnique');
        // No session yet: an empty bearer, never a stale token.
        expect(orgs.deriveSpacesMcpServers([legacyManaged], { bearer: null, issuer: MANAGED })['spaces-rowboat']!.headers.authorization).toBe('Bearer ');
    });
});

describe('the live client when the record changes', () => {
    const same = { baseUrl: session.baseUrl, name: session.name, address: session.address, issuer: MANAGED, memberId: 'm-live' };

    function install(record: OrgRecord = session) {
        seed(record);
        const close = vi.fn();
        orgs.setRuntimeForTests('server', { client: {} as never, live: { close } as never });
        const resets: string[] = [];
        const off = orgs.onRuntimeReset((id) => resets.push(id));
        return { close, resets, off };
    }

    it('an unchanged record keeps the client — renamed or not', () => {
        const { close, resets, off } = install();
        orgs.upsertSessionOrg(same);
        orgs.upsertSessionOrg({ ...same, name: 'Rowboat (renamed)' });
        expect(close).not.toHaveBeenCalled();
        expect(resets).toEqual([]);
        expect(stored()?.name).toBe('Rowboat (renamed)');
        off();
    });

    it('a changed address or identity closes the client and tells the host', () => {
        const { close, resets, off } = install();
        orgs.upsertSessionOrg({ ...same, memberId: 'm-other' });
        expect(close).toHaveBeenCalledTimes(1);
        expect(resets).toEqual(['server']);
        orgs.setRuntimeForTests('server', { client: {} as never, live: { close } as never });
        orgs.upsertSessionOrg({ ...same, memberId: 'm-other', baseUrl: 'https://spaces2.example' });
        expect(close).toHaveBeenCalledTimes(2);
        expect(resets).toEqual(['server', 'server']);
        off();
    });

    it('a legacy oauth record rewritten to session turns the client over once', () => {
        const { close, off } = install(legacyManaged);
        orgs.upsertSessionOrg({ baseUrl: legacyManaged.baseUrl, name: 'Rowboat', address: legacyManaged.address, issuer: MANAGED, memberId: 'm-old' });
        expect(close).toHaveBeenCalledTimes(1);
        expect(stored()?.auth.kind).toBe('session');
        off();
    });

    it('a completed dance replaces the record and always turns the client over, for the new tokens', () => {
        const { close, off } = install(foreign);
        orgs.upsertOAuthOrg({ baseUrl: foreign.baseUrl, name: 'Acme', address: foreign.address, issuer: FOREIGN, clientId: 'acme-client', memberId: 'm-acme', tokens: { access: 'fresh', refresh: 'r2', expiresAt: 4102444800 } });
        expect(close).toHaveBeenCalledTimes(1);
        expect(stored()).toMatchObject({ auth: { kind: 'oauth', tokens: { access: 'fresh' } } });
        off();
    });

    it('forgetting the server closes the client and tells the host', async () => {
        const { close, resets, off } = install(dev);
        orgs.dropSessionOrgs(); // not a session record: stays
        expect(stored()).toEqual(dev);
        expect(close).not.toHaveBeenCalled();
        await orgs.removeOrg('server');
        expect(close).toHaveBeenCalledTimes(1);
        expect(resets).toEqual(['server']);
        off();
    });
});
