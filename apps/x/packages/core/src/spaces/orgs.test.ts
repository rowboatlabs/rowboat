import { describe, expect, it } from 'vitest';
import { deriveSpacesMcpServers, type OrgRecord } from './orgs.js';

// The derived-MCP-server view (single source of truth = the org registry;
// nothing is ever materialized into mcp.json — see the incident that led
// here: a registry↔mcp.json drift let an agent write as the wrong member).

function org(overrides: Partial<OrgRecord> & { memberId?: string } = {}): OrgRecord {
    const { memberId, ...rest } = overrides;
    return {
        id: 'org-abc123-xyz789',
        name: 'Rowboat Labs (dev)',
        address: 'localhost:4272',
        baseUrl: 'http://localhost:4272',
        auth: { kind: 'dev', memberId: memberId ?? 'ramnique' },
        ...rest,
    };
}

describe('deriveSpacesMcpServers', () => {
    it('derives one entry per org: slugged name, /mcp url, bearer token from the registry', () => {
        const entries = deriveSpacesMcpServers([org()]);
        expect(entries).toEqual({
            'spaces-rowboat-labs-dev': {
                url: 'http://localhost:4272/mcp',
                headers: {
                    authorization: 'Bearer dev-ramnique',
                    'x-agent-name': 'Rowboat',
                },
            },
        });
    });

    it('same org under two identities yields two correctly-credentialed entries (never an overwrite)', () => {
        const entries = deriveSpacesMcpServers([
            org({ id: 'org-1' }),
            org({ id: 'org-2', memberId: 'gagan' }),
        ]);
        expect(Object.keys(entries).sort()).toEqual([
            'spaces-rowboat-labs-dev',
            'spaces-rowboat-labs-dev-gagan',
        ]);
        expect(entries['spaces-rowboat-labs-dev']!.headers.authorization).toBe('Bearer dev-ramnique');
        expect(entries['spaces-rowboat-labs-dev-gagan']!.headers.authorization).toBe('Bearer dev-gagan');
    });

    it('falls back to the org id when the name slugs to nothing, and on a full name+member collision', () => {
        const unnamed = deriveSpacesMcpServers([org({ id: 'org-1', name: '***' })]);
        expect(Object.keys(unnamed)).toEqual(['spaces-org-1']);

        const collided = deriveSpacesMcpServers([
            org({ id: 'org-1' }),
            org({ id: 'org-2' }), // same name, same member — degenerate but must not vanish
            org({ id: 'org-3' }), // three-way: slug and slug-member both taken → id fallback
        ]);
        expect(Object.keys(collided).sort()).toEqual([
            'spaces-org-3',
            'spaces-rowboat-labs-dev',
            'spaces-rowboat-labs-dev-ramnique',
        ]);
    });

    it('no orgs → no derived entries', () => {
        expect(deriveSpacesMcpServers([])).toEqual({});
    });
});
