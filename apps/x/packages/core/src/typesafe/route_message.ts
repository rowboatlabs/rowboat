import type { AutoRouteDecision, AutoRouteRequest } from '@x/shared/dist/auto-route.js';
import { isConfigured, systemOne } from './client.js';
import { buildRouteRequest, decideRoute, selectCandidates } from './route_questions.js';

/**
 * The `spaces:autoRoute` handler, both hosts: ask Jev where a stream draft
 * belongs, and (on a stream verdict) who it might need. Short-circuits
 * without a key or without threads; network and API errors propagate so the
 * composer can say why it fell back to the stream.
 */
export async function routeSpaceMessage(input: AutoRouteRequest): Promise<AutoRouteDecision> {
    if (!isConfigured()) return { destination: 'stream', reason: 'no-key' };
    const candidates = selectCandidates(input.candidates);
    if (candidates.length === 0 || !input.draft.trim()) return { destination: 'stream', reason: 'no-candidates' };
    const { state, questions, people } = buildRouteRequest(input, candidates);
    const response = await systemOne({ state, questions });
    const decision = decideRoute(response.answers, candidates, people);
    // One line per decision in the host log: the composer only shows the
    // verdict, and "why the stream?" is the question people ask first.
    console.log(
        `[TypeSafe] route: ${decision.destination} (${decision.reason}) p=${decision.probability?.toFixed(2) ?? '-'} c=${decision.confidence?.toFixed(2) ?? '-'} over ${candidates.length} candidates, ${people.length} people, tags=${decision.tags?.map((t) => `${t.name}:${t.probability.toFixed(2)}`).join(',') || '-'} here=${decision.here?.toFixed(2) ?? '-'}, ${response.usage?.input_tokens ?? '?'} in / ${response.usage?.output_tokens ?? '?'} out tokens`,
    );
    return decision;
}
