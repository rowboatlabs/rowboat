import { describe, expect, it } from 'vitest';
import { buildInvocationMessage, finalAssistantText, isTopicReceiptCall } from './topic-agent.js';

const input = {
    orgId: 'org-1',
    spaceId: '01M07B68G1BQFP70TX5RPHJX89',
    topicId: '01M07TOPICAAAAAAAAAAAAAAA1',
    topicTitle: 'should SSO jump the migration work?',
    spaceName: 'Roadboard',
    messageId: '01M07MSGAAAAAAAAAAAAAAAAA1',
    body: '@rowboat move SSO to P1',
};

describe('buildInvocationMessage', () => {
    it('carries space, topic, provenance, server name, and the verbatim ask', () => {
        const msg = buildInvocationMessage(input, 'spaces-rowboat-labs-dev');
        expect(msg).toContain('topicId: 01M07TOPICAAAAAAAAAAAAAAA1');
        expect(msg).toContain('Space: "Roadboard"');
        expect(msg).toContain('Org MCP server: spaces-rowboat-labs-dev');
        expect(msg).toContain('Invoked by feed message: 01M07MSGAAAAAAAAAAAAAAAAA1');
        expect(msg).toContain('exactly ONE post_to_topic receipt');
        expect(msg.endsWith('@rowboat move SSO to P1')).toBe(true);
    });

    it('carries NO thread content — the agent pulls the discussion via read_topic on demand', () => {
        const msg = buildInvocationMessage(input, 'spaces-rowboat-labs-dev');
        expect(msg).toContain('call read_topic on this topicId FIRST');
        expect(msg).not.toContain('--- recent topic messages');
    });

    it('omits the server line when no org record resolves', () => {
        expect(buildInvocationMessage(input, null)).not.toContain('Org MCP server:');
    });
});

describe('isTopicReceiptCall', () => {
    const receipt = {
        type: 'tool_invocation_requested',
        toolName: 'executeMcpTool',
        input: {
            serverName: 'spaces-rowboat-labs-dev',
            toolName: 'post_to_topic',
            arguments: { spaceId: input.spaceId, topicId: input.topicId, body: 'Moved SSO to P1 in roadmap.md.' },
        },
    };

    it('matches the receipt call for this topic', () => {
        expect(isTopicReceiptCall(receipt, input.topicId)).toBe(true);
    });

    it('rejects other tools, other topics, and non-invocation events', () => {
        expect(isTopicReceiptCall({ ...receipt, input: { ...receipt.input, toolName: 'propose_change' } }, input.topicId)).toBe(false);
        expect(isTopicReceiptCall(receipt, 'someother-topic')).toBe(false);
        expect(isTopicReceiptCall({ ...receipt, type: 'tool_result' }, input.topicId)).toBe(false);
        // post_to_topic WITHOUT topicId starts a new topic — that is not the receipt
        expect(
            isTopicReceiptCall(
                { ...receipt, input: { ...receipt.input, arguments: { spaceId: input.spaceId, body: 'hi' } } },
                input.topicId,
            ),
        ).toBe(false);
    });
});

describe('finalAssistantText', () => {
    it('reads string output, message arrays, and part arrays', () => {
        expect(finalAssistantText('done')).toBe('done');
        expect(finalAssistantText([{ role: 'assistant', content: 'all set' }])).toBe('all set');
        expect(
            finalAssistantText([
                { role: 'assistant', content: 'draft' },
                { role: 'assistant', content: [{ type: 'text', text: 'final ' }, { type: 'text', text: 'answer' }] },
            ]),
        ).toBe('final answer');
    });

    it('returns null when nothing usable exists', () => {
        expect(finalAssistantText(undefined)).toBeNull();
        expect(finalAssistantText([])).toBeNull();
        expect(finalAssistantText([{ role: 'user', content: 'hi' }])).toBeNull();
    });
});
