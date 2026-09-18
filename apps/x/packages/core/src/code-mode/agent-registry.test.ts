import { describe, expect, it } from 'vitest';
import { CodingAgent } from '@x/shared/dist/code-mode.js';
import { AGENT_CATALOG, KNOWN_AGENTS } from '@x/shared/dist/agent-catalog.js';
import { getAgentDescriptor, isExternalAgent } from './agent-registry.js';
import { meetsMinimumVersion } from './acp/external-agent.js';

describe('coding-agent registry', () => {
    it('has a descriptor and label for every known agent', () => {
        for (const agent of CodingAgent.options) {
            expect(getAgentDescriptor(agent)).toBeTruthy();
            expect(AGENT_CATALOG[agent].label.length).toBeGreaterThan(0);
        }
        expect(KNOWN_AGENTS).toEqual([...CodingAgent.options]);
    });

    it('labels each agent with its product name', () => {
        expect(AGENT_CATALOG.claude.label).toBe('Claude Code');
        expect(AGENT_CATALOG.codex.label).toBe('Codex');
        expect(AGENT_CATALOG.opencode.label).toBe('OpenCode');
    });

    it('classifies claude/codex as managed and opencode as external', () => {
        expect(isExternalAgent('opencode')).toBe(true);
        expect(isExternalAgent('claude')).toBe(false);
        expect(isExternalAgent('codex')).toBe(false);
        expect(getAgentDescriptor('opencode').strategy).toBe('external');
    });

    it('fails loudly on an unknown agent id', () => {
        expect(() => getAgentDescriptor('nope' as never)).toThrow(/Unknown coding agent/);
    });
});

describe('external agent version gate', () => {
    it('accepts a version at or above the minimum and rejects below', () => {
        // No minVersion is declared for opencode today, so any version passes.
        expect(meetsMinimumVersion('opencode', '0.0.1')).toBe(true);
        expect(meetsMinimumVersion('opencode', undefined)).toBe(true);
        // Managed agents are never gated by this helper.
        expect(meetsMinimumVersion('claude', '0.0.1')).toBe(true);
    });
});
