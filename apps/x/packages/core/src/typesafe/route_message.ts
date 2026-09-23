import type { AutoRouteDecision, AutoRouteRequest } from '@x/shared/dist/auto-route.js';
import { isConfigured, systemOne } from './client.js';
import { buildRouteRequest, decideRoute, selectCandidates } from './route_questions.js';

/**
 * The `spaces:autoRoute` handler, both hosts: ask Jev where a stream draft
 * belongs. Short-circuits without a key or without threads; network and API
 * errors propagate so the composer can say why it fell back to the stream.
 */
export async function routeSpaceMessage(input: AutoRouteRequest): Promise<AutoRouteDecision> {
    if (!isConfigured()) return { destination: 'stream', reason: 'no-key' };
    const candidates = selectCandidates(input.candidates);
    if (candidates.length === 0 || !input.draft.trim()) return { destination: 'stream', reason: 'no-candidates' };
    const { state, questions } = buildRouteRequest(input, candidates);
    const response = await systemOne({ state, questions });
    return decideRoute(response.answers, candidates);
}
