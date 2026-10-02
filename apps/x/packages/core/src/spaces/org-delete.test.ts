import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Deleting a managed org from the app (Baarali, 2026-10-02): the apex's
// DELETE with the account session and the name typed back; a foreign org is
// refused before any request. A fake apex stands in for the deployment.

const workDir = mkdtempSync(path.join(tmpdir(), 'spaces-delete-test-'));
process.env.ROWBOAT_WORKDIR = workDir;

vi.mock('../auth/tokens.js', () => ({
    getSessionAccessToken: async () => 'session-token',
    readSession: async () => ({ access: 'session-token' }),
}));

const MANAGED = 'https://app.baarali.example/auth/v1';
const CONFIG = path.join(workDir, 'config', 'spaces_orgs.json');

let apex: Server;
const seen: Array<{ method?: string; url?: string; auth?: string; body: string }> = [];
let reply: { status: number; body: unknown } = { status: 200, body: {} };

beforeAll(async () => {
    apex = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
            seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
            res.writeHead(reply.status, { 'content-type': 'application/json' }).end(JSON.stringify(reply.body));
        });
    });
    await new Promise<void>((resolve) => apex.listen(0, resolve));
    process.env.ROWBOAT_SPACES_APEX = `http://localhost:${(apex.address() as AddressInfo).port}`;
    mkdirSync(path.dirname(CONFIG), { recursive: true });
    writeFileSync(
        CONFIG,
        JSON.stringify({
            version: 1,
            orgs: [
                {
                    id: 'org-local-1',
                    name: 'Ma PME',
                    address: 'ma-pme-x1y2.spaces.example',
                    baseUrl: 'https://ma-pme-x1y2.spaces.example',
                    serverOrgId: 'org-01pme',
                    auth: { kind: 'session', issuer: MANAGED, memberId: 'm-1' },
                },
                {
                    id: 'org-local-2',
                    name: 'Acme',
                    address: 'spaces.acme.example',
                    baseUrl: 'https://spaces.acme.example',
                    serverOrgId: 'org-01acme',
                    auth: { kind: 'oauth', issuer: 'https://idp.acme.example', clientId: 'c', memberId: 'm-2', tokens: { access: 'a', refresh: 'r', expiresAt: 4102444800 } },
                },
            ],
        }),
    );
    (await import('./orgs.js')).setManagedIssuerForTests(MANAGED);
});

afterAll(async () => {
    delete process.env.ROWBOAT_SPACES_APEX;
    await new Promise<void>((resolve) => apex.close(() => resolve()));
});

describe('deleteOrgOnDeployment', () => {
    it('asks the apex with the account session and the name typed back', async () => {
        const { deleteOrgOnDeployment } = await import('./oauth.js');
        reply = { status: 200, body: { deleted: { id: 'org-01pme', name: 'Ma PME' } } };
        await deleteOrgOnDeployment({ orgId: 'org-local-1', confirmName: 'Ma PME' });
        expect(seen.at(-1)).toEqual({
            method: 'DELETE',
            url: '/v1/orgs/org-01pme',
            auth: 'Bearer session-token',
            body: JSON.stringify({ confirmName: 'Ma PME' }),
        });
    });

    it("surfaces the apex's refusal verbatim", async () => {
        const { deleteOrgOnDeployment } = await import('./oauth.js');
        reply = { status: 403, body: { code: 'forbidden', message: 'only an admin can delete this org' } };
        await expect(deleteOrgOnDeployment({ orgId: 'org-local-1', confirmName: 'Ma PME' })).rejects.toThrow(
            'only an admin can delete this org',
        );
        // The record stays: only the caller removes it, after a success.
        expect(JSON.parse(readFileSync(CONFIG, 'utf-8')).orgs).toHaveLength(2);
    });

    it('refuses a foreign org before any request', async () => {
        const { deleteOrgOnDeployment } = await import('./oauth.js');
        const before = seen.length;
        await expect(deleteOrgOnDeployment({ orgId: 'org-local-2', confirmName: 'Acme' })).rejects.toThrow(/hosted by Baarali/);
        expect(seen.length).toBe(before);
    });
});
