import { z } from 'zod';
import { generateObject } from 'ai';
import { createProvider } from '../../models/models.js';
import {
    getDefaultModelAndProvider,
    getKgModel,
    resolveProviderConfig,
} from '../../models/defaults.js';
import { captureLlmUsage } from '../../analytics/usage.js';
import { withUseCase } from '../../analytics/use_case.js';

export type SlackHomeRankCandidate = {
    id: string;
    workspaceName?: string;
    channelName?: string;
    author?: string;
    text: string;
    ts: string;
};

const RankedSlackMessagesSchema = z.object({
    rankedIds: z.array(z.string()).describe('Message ids in the order they should appear on Home.'),
});

const EXPIRED_ROUTINE_AGE_MS = 2 * 60 * 60 * 1000;
const ROUTINE_EVENT_RE = /\b(stand[-\s]?up|daily\s+(sync|scrum|standup)|scrum|check[-\s]?in)\b/i;
const ROUTINE_LOGISTICS_RE = /\b(skip|skipping|miss|missing|can't|cannot|cant|won't|wont|join|attend|possible|move|reschedule|shift|late|running\s+late|stomach|sick|not\s+feeling|headache|doctor|appointment|today|todays|today's|tomorrow|at\s+\d{1,2}(:\d{2})?\s*(am|pm)?)\b/i;
const DURABLE_SIGNAL_RE = /\b(blocker|blocked|decision|decided|owner|deadline|shipped|fixed|done|launched|deployed|merged|bug|issue|incident|outage|customer|contract|pricing|proposal|launch|release|handoff|review|approval|approved)\b/i;

function timeRank(candidates: SlackHomeRankCandidate[], limit: number): string[] {
    return [...candidates]
        .sort((a, b) => Number(b.ts) - Number(a.ts))
        .slice(0, limit)
        .map(candidate => candidate.id);
}

function slackTsToMs(ts: string): number | null {
    const seconds = Number(ts.split('.')[0]);
    if (!Number.isFinite(seconds)) return null;
    return seconds * 1000;
}

function isExpiredRoutineLogistics(candidate: SlackHomeRankCandidate, nowMs: number): boolean {
    const sentAtMs = slackTsToMs(candidate.ts);
    if (sentAtMs === null) return false;
    if (nowMs - sentAtMs < EXPIRED_ROUTINE_AGE_MS) return false;

    const text = candidate.text.replace(/\s+/g, ' ').trim();
    if (!ROUTINE_EVENT_RE.test(text)) return false;
    if (DURABLE_SIGNAL_RE.test(text)) return false;

    return ROUTINE_LOGISTICS_RE.test(text);
}

export function filterSlackHomeCandidatesForRelevance(
    candidates: SlackHomeRankCandidate[],
    nowMs = Date.now(),
): SlackHomeRankCandidate[] {
    return candidates.filter(candidate => !isExpiredRoutineLogistics(candidate, nowMs));
}

function truncate(value: string, max: number): string {
    return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function buildPrompt(candidates: SlackHomeRankCandidate[], limit: number): string {
    const messages = candidates.map((candidate, index) => {
        const date = Number.isFinite(Number(candidate.ts))
            ? new Date(Number(candidate.ts.split('.')[0]) * 1000).toISOString()
            : candidate.ts;
        return [
            `## ${index + 1}. ${candidate.id}`,
            `Workspace: ${candidate.workspaceName ?? 'unknown'}`,
            `Channel: ${candidate.channelName ?? 'unknown'}`,
            `Author: ${candidate.author ?? 'unknown'}`,
            `Time: ${date}`,
            `Text: ${truncate(candidate.text.replace(/\s+/g, ' ').trim(), 700)}`,
        ].join('\n');
    }).join('\n\n');

    return `Choose up to ${limit} Slack messages to show on the user's Home screen.

Prioritize messages that are likely useful at a glance:
- direct questions or requests to the user
- decisions, blockers, owners, deadlines, status changes, or shipped/fixed/done updates
- project/customer/product updates
- messages with clear actionability or durable knowledge

Deprioritize:
- greetings, thanks, jokes, reactions, short acknowledgements, bot noise
- vague chatter without clear project/action relevance
- near-duplicates of the same point
- routine logistics whose value expires quickly, such as standup scheduling, standup attendance, sick notes, lunch/commute coordination, and "can we move this?" chatter once the event is likely past

Return only ids from the candidate list. You may return fewer than ${limit} ids if fewer messages are useful. Prefer relevance over recency, but use recency as a tiebreaker.

# Candidates

${messages}`;
}

export async function rankSlackHomeMessages(
    candidates: SlackHomeRankCandidate[],
    limit: number,
): Promise<string[]> {
    const relevantCandidates = filterSlackHomeCandidatesForRelevance(candidates);

    if (relevantCandidates.length <= limit) {
        return timeRank(relevantCandidates, limit);
    }

    try {
        const modelId = await getKgModel();
        const { provider } = await getDefaultModelAndProvider();
        const config = await resolveProviderConfig(provider);
        const model = createProvider(config).languageModel(modelId);

        const result = await withUseCase({ useCase: 'knowledge_sync', subUseCase: 'slack_home_rank' }, () => generateObject({
            model,
            system: 'You rank Slack messages for a personal productivity Home screen. Be selective and return valid ids only.',
            prompt: buildPrompt(relevantCandidates, limit),
            schema: RankedSlackMessagesSchema,
        }));

        captureLlmUsage({
            useCase: 'knowledge_sync',
            subUseCase: 'slack_home_rank',
            model: modelId,
            provider,
            usage: result.usage,
        });

        const validIds = new Set(relevantCandidates.map(candidate => candidate.id));
        const ranked = result.object.rankedIds.filter(id => validIds.has(id));
        const seen = new Set<string>();
        const deduped = ranked.filter(id => {
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        });

        return deduped.slice(0, limit);
    } catch (error) {
        console.warn('[SlackHomeRank] LLM ranking failed, falling back to recency:', error);
        return timeRank(relevantCandidates, limit);
    }
}
