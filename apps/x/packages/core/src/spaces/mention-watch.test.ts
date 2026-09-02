import { describe, expect, it } from 'vitest';
import { resolveMentions } from '@x/shared/dist/spaces.js';
import { buildMentionNotify, buildMissedSummaryNotify, cooldownKeyFor, isMissedArrival, mentionExcerpt, mentionLink } from './mention-watch.js';

describe('isMissedArrival', () => {
    const now = new Date('2026-08-20T12:00:00Z').getTime();
    it('treats old messages as missed and fresh ones as live', () => {
        expect(isMissedArrival('2026-08-20T11:00:00Z', now)).toBe(true);
        expect(isMissedArrival('2026-08-20T11:59:30Z', now)).toBe(false);
        expect(isMissedArrival('not a date', now)).toBe(false);
    });
});

describe('mentionLink', () => {
    it('deep-links to the space, and to the thread when given', () => {
        expect(mentionLink('o1', 's1')).toBe('rowboat://open?type=spaces&orgId=o1&spaceId=s1');
        expect(mentionLink('o1', 's1', 'm/1')).toBe('rowboat://open?type=spaces&orgId=o1&spaceId=s1&threadRootId=m%2F1');
    });
});

describe('mentionExcerpt', () => {
    it('drops markdown scaffolding and truncates', () => {
        expect(mentionExcerpt('@arjun can you look?\n```js\nsecret()\n```\n> old quote\n**soon**')).toBe('@arjun can you look? soon');
        expect(mentionExcerpt('x'.repeat(200))).toHaveLength(140);
    });
    it('resolved wire bodies show people, not member ids', () => {
        const names = new Map([['01M0KTADMQSQ35V1M2WH15XNTY', 'Arjun']]);
        expect(mentionExcerpt(resolveMentions('@here ping @01M0KTADMQSQ35V1M2WH15XNTY', names)))
            .toBe('@here ping @Arjun');
    });
});

describe('notification payloads', () => {
    it('builds a background-only mention notification with a thread deep link', () => {
        const n = buildMentionNotify({ orgId: 'o1', spaceId: 's1', spaceName: 'Roadboard', threadRootId: 'm1', authorName: 'Harsh', body: '@arjun ping', kind: 'you' });
        expect(n.title).toBe('Harsh mentioned you · Roadboard');
        expect(n.message).toBe('@arjun ping');
        expect(n.link).toContain('threadRootId=m1');
        expect(n.onlyWhenBackground).toBe(true);
    });
    it('titles an @here hit as mentioning everyone', () => {
        const n = buildMentionNotify({ orgId: 'o1', spaceId: 's1', spaceName: 'Roadboard', threadRootId: 'm1', authorName: 'Harsh', body: '@here standup', kind: 'here' });
        expect(n.title).toBe('Harsh mentioned everyone · Roadboard');
    });
    it('summarises missed mentions, landing on the sole thread when there is one', () => {
        const one = buildMissedSummaryNotify({ orgId: 'o1', spaceId: 's1', spaceName: 'Roadboard', youCount: 1, hereCount: 0, soleThreadRootId: 'm1' });
        expect(one.message).toBe('1 mention of you');
        expect(one.link).toContain('threadRootId=m1');
        const many = buildMissedSummaryNotify({ orgId: 'o1', spaceId: 's1', spaceName: 'Roadboard', youCount: 3, hereCount: 0 });
        expect(many.message).toBe('3 mentions of you');
        expect(many.link).not.toContain('threadRootId');
    });
    it('counts @here separately in the missed summary', () => {
        expect(buildMissedSummaryNotify({ orgId: 'o1', spaceId: 's1', spaceName: 'Roadboard', youCount: 0, hereCount: 2 }).message).toBe('2 @here');
        expect(buildMissedSummaryNotify({ orgId: 'o1', spaceId: 's1', spaceName: 'Roadboard', youCount: 2, hereCount: 1 }).message).toBe('2 mentions of you · 1 @here');
    });
});

describe('cooldownKeyFor', () => {
    it('buckets per space, per thread, and per kind class', () => {
        const k = 'org-1/space-1';
        // A level-'all' plain message must never mask a direct mention that
        // lands in the same thread right after: separate buckets.
        expect(cooldownKeyFor(k, 'root-1', 'message')).not.toBe(cooldownKeyFor(k, 'root-1', 'you'));
        // @you and @here are both "someone wants you here" — one per window.
        expect(cooldownKeyFor(k, 'root-1', 'you')).toBe(cooldownKeyFor(k, 'root-1', 'here'));
        // Threads and spaces never share a window.
        expect(cooldownKeyFor(k, 'root-1', 'you')).not.toBe(cooldownKeyFor(k, 'root-2', 'you'));
        expect(cooldownKeyFor(k, 'root-1', 'you')).not.toBe(cooldownKeyFor('org-1/space-2', 'root-1', 'you'));
    });
});
