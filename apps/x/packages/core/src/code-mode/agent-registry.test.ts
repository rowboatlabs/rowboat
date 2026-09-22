import { describe, expect, it } from 'vitest';
import { CodingAgent } from '@x/shared/dist/code-mode.js';
import { AGENT_CATALOG, KNOWN_AGENTS } from '@x/shared/dist/agent-catalog.js';
import { getAgentDescriptor, isExternalAgent } from './agent-registry.js';

describe('coding-agent registry', () => {
    it('has a descriptor and label for every known agent', () => {
        for (const agent of CodingAgent.options) {
            expect(getAgentDescriptor(agent)).toBeTruthy();
            expect(AGENT_CATALOG[agent].label.length).toBeGreaterThan(0);
        }
        expect(KNOWN_AGENTS).toEqual([...CodingAgent.options]);
    });

    it('is exactly opencode, cursor, hermes in that order', () => {
        expect([...CodingAgent.options]).toEqual(['opencode', 'cursor', 'hermes']);
        expect(AGENT_CATALOG.opencode.label).toBe('OpenCode');
        expect(AGENT_CATALOG.cursor.label).toBe('Cursor');
        expect(AGENT_CATALOG.hermes.label).toBe('Hermes');
    });

    it('launches each agent through its ACP server', () => {
        expect(AGENT_CATALOG.opencode.acpArgs).toEqual(['acp']);
        expect(AGENT_CATALOG.cursor.binNames).toEqual(['cursor-agent']);
        expect(AGENT_CATALOG.cursor.acpArgs).toEqual(['acp']);
        expect(AGENT_CATALOG.hermes.acpArgs).toEqual(['acp', '--accept-hooks']);
    });

    it('treats every agent as externally installed (PATH-detected)', () => {
        for (const agent of CodingAgent.options) {
            expect(isExternalAgent(agent)).toBe(true);
            expect(getAgentDescriptor(agent).strategy).toBe('external');
        }
    });

    it('fails loudly on an unknown agent id', () => {
        expect(() => getAgentDescriptor('nope' as never)).toThrow(/Unknown coding agent/);
    });
});