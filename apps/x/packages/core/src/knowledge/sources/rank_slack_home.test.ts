import { describe, expect, it } from 'vitest';
import { filterSlackHomeCandidatesForRelevance, SlackHomeRankCandidate } from './rank_slack_home.js';

function slackTs(dateMs: number): string {
    return `${Math.floor(dateMs / 1000)}.000000`;
}

describe('Slack Home ranking filters', () => {
    it('drops stale routine standup logistics but keeps durable updates', () => {
        const now = Date.parse('2026-06-04T18:00:00Z');
        const nineHoursAgo = now - 9 * 60 * 60 * 1000;
        const twelveHoursAgo = now - 12 * 60 * 60 * 1000;
        const thirtyMinutesAgo = now - 30 * 60 * 1000;

        const candidates: SlackHomeRankCandidate[] = [
            {
                id: 'stale-standup-schedule',
                channelName: 'general',
                text: 'standup at 4pm possible?',
                ts: slackTs(nineHoursAgo),
            },
            {
                id: 'stale-standup-sick',
                channelName: 'general',
                text: 'ill skip todays standup I am having stomach ache and not feeling well',
                ts: slackTs(twelveHoursAgo),
            },
            {
                id: 'durable-issue-update',
                channelName: 'general',
                text: 'is the icon issue fixed for windows?',
                ts: slackTs(twelveHoursAgo),
            },
            {
                id: 'recent-standup-schedule',
                channelName: 'general',
                text: 'standup at 4pm possible?',
                ts: slackTs(thirtyMinutesAgo),
            },
        ];

        expect(filterSlackHomeCandidatesForRelevance(candidates, now).map(candidate => candidate.id)).toEqual([
            'durable-issue-update',
            'recent-standup-schedule',
        ]);
    });
});
