import { describe, expect, it } from 'vitest';
import {
    filterSlackHomeCandidatesForRelevance,
    rankSlackHomeMessages,
    SlackHomeRankCandidate,
} from './rank_slack_home.js';

function slackTs(dateMs: number): string {
    return `${Math.floor(dateMs / 1000)}.000000`;
}

const NOW = Date.parse('2026-06-04T18:00:00Z');
const recent = (text: string, id = text): SlackHomeRankCandidate => ({
    id,
    channelName: 'general',
    text,
    ts: slackTs(NOW - 5 * 60 * 1000),
});

function keptIds(candidates: SlackHomeRankCandidate[]): string[] {
    return filterSlackHomeCandidatesForRelevance(candidates, NOW).map(c => c.id);
}

describe('filterSlackHomeCandidatesForRelevance', () => {
    describe('routine standup logistics', () => {
        it('drops stale standup logistics but keeps recent ones and durable updates', () => {
            const nineHoursAgo = NOW - 9 * 60 * 60 * 1000;
            const twelveHoursAgo = NOW - 12 * 60 * 60 * 1000;
            const thirtyMinutesAgo = NOW - 30 * 60 * 1000;

            const candidates: SlackHomeRankCandidate[] = [
                { id: 'stale-standup-schedule', channelName: 'general', text: 'standup at 4pm possible?', ts: slackTs(nineHoursAgo) },
                { id: 'stale-standup-sick', channelName: 'general', text: 'ill skip todays standup I am having stomach ache and not feeling well', ts: slackTs(twelveHoursAgo) },
                { id: 'durable-issue-update', channelName: 'general', text: 'is the icon issue fixed for windows?', ts: slackTs(twelveHoursAgo) },
                { id: 'recent-standup-schedule', channelName: 'general', text: 'standup at 4pm possible?', ts: slackTs(thirtyMinutesAgo) },
            ];

            expect(keptIds(candidates)).toEqual(['durable-issue-update', 'recent-standup-schedule']);
        });
    });

    describe('system / automated messages', () => {
        it('drops channel join/leave, topic, rename and call notices', () => {
            const candidates = [
                recent('Alex has joined the channel', 'join'),
                recent('Sam has left the channel', 'leave'),
                recent('Alex set the channel topic: Q3 planning', 'topic'),
                recent('Sam renamed the channel to design-team', 'rename'),
                recent('Alex started a huddle', 'huddle'),
                recent('Real question: can someone review my PR?', 'real'),
            ];
            expect(keptIds(candidates)).toEqual(['real']);
        });

        it('keeps a system-shaped message that carries a durable signal', () => {
            const candidates = [recent('Priya set the channel topic: incident response war room', 'topic-incident')];
            expect(keptIds(candidates)).toEqual(['topic-incident']);
        });
    });

    describe('emoji / reaction-only', () => {
        it('drops emoji-only, shortcode-only and punctuation-only posts', () => {
            const candidates = [
                recent('👍', 'thumbs'),
                recent('🎉🎉🎉', 'party'),
                recent(':tada: :rocket:', 'shortcodes'),
                recent('!!!', 'punct'),
                recent('🚀 shipping the new pricing page today', 'real'),
            ];
            expect(keptIds(candidates)).toEqual(['real']);
        });
    });

    describe('greetings / acknowledgements', () => {
        it('drops bare greetings and acks but keeps anything with content', () => {
            const candidates = [
                recent('thanks!', 'thanks'),
                recent('gm', 'gm'),
                recent('lgtm', 'lgtm'),
                recent('+1', 'plus1'),
                recent('sounds good', 'sg'),
                recent('ok', 'ok'),
                recent('ok, the deploy is blocked on the migration', 'ok-with-content'),
                recent('thanks for fixing the outage', 'thanks-durable'),
            ];
            // 'ok-with-content' kept (has content); 'thanks-durable' kept (durable signal).
            expect(keptIds(candidates)).toEqual(['ok-with-content', 'thanks-durable']);
        });
    });

    it('drops empty-text candidates', () => {
        expect(keptIds([recent('   ', 'blank'), recent('a real message here', 'real')])).toEqual(['real']);
    });
});

describe('rankSlackHomeMessages (deterministic)', () => {
    it('orders surviving candidates newest-first and caps at the limit', async () => {
        const mk = (id: string, minutesAgo: number): SlackHomeRankCandidate => ({
            id, channelName: 'general', text: `update ${id}`, ts: slackTs(NOW - minutesAgo * 60 * 1000),
        });
        const candidates = [mk('old', 50), mk('newest', 1), mk('mid', 20)];
        expect(await rankSlackHomeMessages(candidates, 5)).toEqual(['newest', 'mid', 'old']);
        expect(await rankSlackHomeMessages(candidates, 2)).toEqual(['newest', 'mid']);
    });

    it('filters noise before ranking', async () => {
        const candidates = [
            recent('👍', 'emoji'),
            recent('Alex has joined the channel', 'join'),
            recent('can you review the pricing proposal?', 'real'),
        ];
        expect(await rankSlackHomeMessages(candidates, 5)).toEqual(['real']);
    });

    it('handles a high-volume batch: caps output and preserves recency order', async () => {
        const candidates: SlackHomeRankCandidate[] = Array.from({ length: 150 }, (_, i) => ({
            id: `m${i}`,
            channelName: 'general',
            // i=0 is newest; larger i is older.
            text: `status update number ${i}`,
            ts: slackTs(NOW - i * 60 * 1000),
        }));
        const ranked = await rankSlackHomeMessages(candidates, 5);
        expect(ranked).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
    });
});
