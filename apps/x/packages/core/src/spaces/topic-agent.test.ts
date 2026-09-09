import { describe, expect, it } from 'vitest';
import { buildInvocationMessage, mentionOrigin, threadOrigin } from './topic-agent.js';

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

describe('mentionOrigin', () => {
    it('is the typed space_mention origin the activity feed keys on', () => {
        expect(mentionOrigin(input)).toEqual({
            kind: 'space_mention',
            orgId: 'org-1',
            spaceId: '01M07B68G1BQFP70TX5RPHJX89',
            threadRootId: '01M07ROOTAAAAAAAAAAAAAAAA1',
            messageId: '01M07MSGAAAAAAAAAAAAAAAAA1',
        });
    });
});

describe('threadOrigin', () => {
    it('identifies the thread and carries the space name as a display fallback — no message id', () => {
        expect(threadOrigin(input)).toEqual({
            kind: 'space_thread',
            orgId: 'org-1',
            spaceId: '01M07B68G1BQFP70TX5RPHJX89',
            threadRootId: '01M07ROOTAAAAAAAAAAAAAAAA1',
            spaceName: 'Roadboard',
        });
    });
});
