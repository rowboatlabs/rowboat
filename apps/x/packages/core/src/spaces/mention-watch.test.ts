import { describe, expect, it } from 'vitest';
import { buildMentionNotify, buildMissedSummaryNotify, isMissedArrival, mentionExcerpt, mentionLink } from './mention-watch.js';

describe('isMissedArrival', () => {
    const now = new Date('2026-08-20T12:00:00Z').getTime();
    it('treats old messages as missed and fresh ones as live', () => {
        expect(isMissedArrival('2026-08-20T11:00:00Z', now)).toBe(true);
        expect(isMissedArrival('2026-08-20T11:59:30Z', now)).toBe(false);
        expect(isMissedArrival('not a date', now)).toBe(false);
    });
});

describe('mentionLink', () => {
    it('deep-links to the space, and to the topic when given', () => {
        expect(mentionLink('o1', 's1')).toBe('rowboat://open?type=spaces&orgId=o1&spaceId=s1');
        expect(mentionLink('o1', 's1', 't/1')).toBe('rowboat://open?type=spaces&orgId=o1&spaceId=s1&topicId=t%2F1');
    });
});

describe('mentionExcerpt', () => {
    it('drops markdown scaffolding and truncates', () => {
        expect(mentionExcerpt('@arjun can you look?\n```js\nsecret()\n```\n> old quote\n**soon**')).toBe('@arjun can you look? soon');
        expect(mentionExcerpt('x'.repeat(200))).toHaveLength(140);
    });
});

describe('notification payloads', () => {
    it('builds a background-only mention notification with a topic deep link', () => {
        const n = buildMentionNotify({ orgId: 'o1', spaceId: 's1', spaceName: 'Roadboard', topicId: 't1', authorName: 'Harsh', body: '@arjun ping' });
        expect(n.title).toBe('Harsh mentioned you · Roadboard');
        expect(n.message).toBe('@arjun ping');
        expect(n.link).toContain('topicId=t1');
        expect(n.onlyWhenBackground).toBe(true);
    });
    it('summarises missed mentions, landing on the sole topic when there is one', () => {
        const one = buildMissedSummaryNotify({ orgId: 'o1', spaceId: 's1', spaceName: 'Roadboard', count: 1, soleTopicId: 't1' });
        expect(one.message).toBe('1 mention of you');
        expect(one.link).toContain('topicId=t1');
        const many = buildMissedSummaryNotify({ orgId: 'o1', spaceId: 's1', spaceName: 'Roadboard', count: 3 });
        expect(many.message).toBe('3 mentions of you');
        expect(many.link).not.toContain('topicId');
    });
});
