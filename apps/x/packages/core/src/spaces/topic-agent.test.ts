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
    it('is a one-line header (space, ids) plus the verbatim ask — nothing else', () => {
        const msg = buildInvocationMessage(input, 'spaces-rowboat-labs-dev');
        const lines = msg.split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[0]).toBe(
            '[@rowboat in "Roadboard" · spaceId 01M07B68G1BQFP70TX5RPHJX89 · thread 01M07ROOTAAAAAAAAAAAAAAAA1 · message 01M07MSGAAAAAAAAAAAAAAAAA1]',
        );
        expect(lines[1]).toBe('@rowboat move SSO to P1');
    });

    it('carries NO thread content and NO procedure — the session pin (spaceThread) owns the procedure', () => {
        const msg = buildInvocationMessage(input, 'spaces-rowboat-labs-dev');
        expect(msg).not.toContain('--- recent topic messages');
        expect(msg).not.toContain('read_thread');
        expect(msg).not.toContain('post_message');
        expect(msg).not.toContain('Load the');
    });

    it('does not depend on the server name (the org rides the session pin)', () => {
        expect(buildInvocationMessage(input, null)).toBe(buildInvocationMessage(input, 'spaces-rowboat-labs-dev'));
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
