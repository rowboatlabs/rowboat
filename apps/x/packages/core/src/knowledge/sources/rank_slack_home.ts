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

function timeRank(candidates: SlackHomeRankCandidate[], limit: number): string[] {
    return [...candidates]
        .sort((a, b) => Number(b.ts) - Number(a.ts))
        .slice(0, limit)
        .map(candidate => candidate.id);
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

Return only ids from the candidate list. Prefer relevance over recency, but use recency as a tiebreaker.

# Candidates

${messages}`;
}

export async function rankSlackHomeMessages(
    candidates: SlackHomeRankCandidate[],
    limit: number,
): Promise<string[]> {
    if (candidates.length <= limit) {
        return timeRank(candidates, limit);
    }

    try {
        const modelId = await getKgModel();
        const { provider } = await getDefaultModelAndProvider();
        const config = await resolveProviderConfig(provider);
        const model = createProvider(config).languageModel(modelId);

        const result = await withUseCase({ useCase: 'knowledge_sync', subUseCase: 'slack_home_rank' }, () => generateObject({
            model,
            system: 'You rank Slack messages for a personal productivity Home screen. Be selective and return valid ids only.',
            prompt: buildPrompt(candidates, limit),
            schema: RankedSlackMessagesSchema,
        }));

        captureLlmUsage({
            useCase: 'knowledge_sync',
            subUseCase: 'slack_home_rank',
            model: modelId,
            provider,
            usage: result.usage,
        });

        const validIds = new Set(candidates.map(candidate => candidate.id));
        const ranked = result.object.rankedIds.filter(id => validIds.has(id));
        const seen = new Set<string>();
        const deduped = ranked.filter(id => {
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        });

        if (deduped.length === 0) {
            return timeRank(candidates, limit);
        }

        const fallback = timeRank(candidates, limit);
        for (const id of fallback) {
            if (deduped.length >= limit) break;
            if (!seen.has(id)) {
                deduped.push(id);
                seen.add(id);
            }
        }

        return deduped.slice(0, limit);
    } catch (error) {
        console.warn('[SlackHomeRank] LLM ranking failed, falling back to recency:', error);
        return timeRank(candidates, limit);
    }
}
