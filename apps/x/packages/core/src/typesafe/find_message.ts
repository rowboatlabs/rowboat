import type { FindRequest, FindResult } from '@x/shared/dist/find.js';
import { isConfigured, systemOne } from './client.js';
import { buildFindRequest, decideFind, selectFindCandidates } from './find_questions.js';

/**
 * The `spaces:findMessage` handler, both hosts: ask Jev which of the
 * gathered messages the person is looking for. Short-circuits without a key
 * or without candidates; network and API errors propagate so the composer
 * can hand the query to the search bar instead.
 */
export async function findSpaceMessage(input: FindRequest): Promise<FindResult> {
    if (!isConfigured()) return { reason: 'no-key', ranked: [], found: false };
    const candidates = selectFindCandidates(input.candidates);
    if (candidates.length === 0 || !input.query.trim()) return { reason: 'no-candidates', ranked: [], found: false };
    const { state, questions } = buildFindRequest(input, candidates);
    const response = await systemOne({ state, questions });
    const result = decideFind(response.answers, candidates);
    const top = result.ranked[0];
    console.log(
        `[TypeSafe] find: ${result.found ? 'found' : 'not found'} top=${top ? top.probability.toFixed(2) : '-'} presence=${result.presence?.toFixed(2) ?? '-'} c=${result.confidence?.toFixed(2) ?? '-'} over ${candidates.length} candidates, ${response.usage?.input_tokens ?? '?'} in / ${response.usage?.output_tokens ?? '?'} out tokens`,
    );
    return result;
}
