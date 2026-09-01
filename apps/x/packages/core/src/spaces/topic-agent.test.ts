import { describe, expect, it } from 'vitest';
import { RECLAIMED_TURN_REASON } from '../runtime/sessions/api.js';
import { backstopBody, buildInvocationMessage, describeTurnError, finalAssistantText, isTopicReceiptCall } from './topic-agent.js';

const input = {
    orgId: 'org-1',
    spaceId: '01M07B68G1BQFP70TX5RPHJX89',
    threadRootId: '01M07ROOTAAAAAAAAAAAAAAAA1',
    threadLabel: 'should SSO jump the migration work?',
    spaceName: 'Roadboard',
    messageId: '01M07MSGAAAAAAAAAAAAAAAAA1',
    body: '@rowboat move SSO to P1',
};

describe('buildInvocationMessage', () => {
    it('carries space, thread root, provenance, server name, and the verbatim ask', () => {
        const msg = buildInvocationMessage(input, 'spaces-rowboat-labs-dev');
        expect(msg).toContain('rootMessageId: 01M07ROOTAAAAAAAAAAAAAAAA1');
        expect(msg).toContain('Space: "Roadboard"');
        expect(msg).toContain('Org MCP server: spaces-rowboat-labs-dev');
        expect(msg).toContain('Invoked by feed message: 01M07MSGAAAAAAAAAAAAAAAAA1');
        expect(msg).toContain('exactly ONE post_message receipt');
        expect(msg.endsWith('@rowboat move SSO to P1')).toBe(true);
    });

    it('carries NO thread content — the agent pulls the conversation via read_thread on demand', () => {
        const msg = buildInvocationMessage(input, 'spaces-rowboat-labs-dev');
        expect(msg).toContain('call read_thread on this rootMessageId FIRST');
        expect(msg).not.toContain('--- recent topic messages');
    });

    it('omits the server line when no org record resolves', () => {
        expect(buildInvocationMessage(input, null)).not.toContain('Org MCP server:');
    });

    it('requires the thread provenance suffix on any change the agent proposes', () => {
        const msg = buildInvocationMessage(input, null);
        expect(msg).toContain('end its reason with " · thread:01M07ROOTAAAAAAAAAAAAAAAA1"');
    });
});

describe('isTopicReceiptCall', () => {
    const receipt = {
        type: 'tool_invocation_requested',
        toolName: 'executeMcpTool',
        input: {
            serverName: 'spaces-rowboat-labs-dev',
            toolName: 'post_message',
            arguments: { spaceId: input.spaceId, threadRoot: input.threadRootId, body: 'Moved SSO to P1 in roadmap.md.' },
        },
    };

    it('matches the receipt call into this thread', () => {
        expect(isTopicReceiptCall(receipt, input.threadRootId)).toBe(true);
    });

    it('rejects other tools, other threads, and non-invocation events', () => {
        expect(isTopicReceiptCall({ ...receipt, input: { ...receipt.input, toolName: 'propose_change' } }, input.threadRootId)).toBe(false);
        expect(isTopicReceiptCall(receipt, 'someother-root')).toBe(false);
        expect(isTopicReceiptCall({ ...receipt, type: 'tool_result' }, input.threadRootId)).toBe(false);
        // post_message WITHOUT threadRoot posts a new stream root — that is not the receipt
        expect(
            isTopicReceiptCall(
                { ...receipt, input: { ...receipt.input, arguments: { spaceId: input.spaceId, body: 'hi' } } },
                input.threadRootId,
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

describe('describeTurnError', () => {
    it('turns auth failures into a sign-in hint and keeps other errors verbatim', () => {
        expect(describeTurnError('unexpected HTTP response status code')).toMatch(/isn't signed in/);
        expect(describeTurnError('401 Unauthorized')).toMatch(/isn't signed in/);
        expect(describeTurnError('429 Too Many Requests')).toMatch(/rate-limited/);
        expect(describeTurnError('tool foo exploded')).toBe('tool foo exploded');
        expect(describeTurnError(undefined)).toBe('unknown error');
    });
});

describe('backstopBody', () => {
    it('tells a reclaimed crash-orphaned turn apart from a person pressing Stop', () => {
        expect(backstopBody({ type: 'turn_cancelled', reason: RECLAIMED_TURN_REASON })).toBe(
            '⚠️ An earlier Rowboat run here was interrupted — picking up your latest message now.',
        );
        expect(backstopBody({ type: 'turn_cancelled' })).toBe(
            "⚠️ Rowboat's run was stopped before it finished.",
        );
        expect(backstopBody({ type: 'turn_cancelled', reason: 'user asked' })).toBe(
            "⚠️ Rowboat's run was stopped before it finished.",
        );
    });

    it('keeps the failed and no-receipt wordings', () => {
        expect(backstopBody({ type: 'turn_failed', error: '401' })).toMatch(/isn't signed in/);
        expect(backstopBody({ type: 'turn_completed' })).toBe(
            'Rowboat finished without posting a receipt or leaving a note.',
        );
    });
});
