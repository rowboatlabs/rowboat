import type { EventConsumer, EventConsumerTarget } from '../events/consumer.js';
import { routeBatch } from '../events/routing.js';
import { createLanguageModel } from '../models/models.js';
import {
    getBackgroundTaskAgentModel,
    resolveProviderConfig,
} from '../models/defaults.js';
import { listTasks } from './fileops.js';
import { runBackgroundTask } from './runner.js';

async function resolveRoutingModel() {
    const { model: modelId, provider } = await getBackgroundTaskAgentModel();
    const config = await resolveProviderConfig(provider);
    return {
        model: createLanguageModel(config, modelId, { priority: 'classifier' }),
        modelId,
        providerName: provider,
    };
}

async function listEligibleTargets(): Promise<EventConsumerTarget[]> {
    // Walk all tasks once; pagination doesn't apply to the routing pass — the
    // classifier needs to see all event-eligible tasks together.
    const result = await listTasks({ limit: 10_000 });
    const out: EventConsumerTarget[] = [];
    for (const summary of result.items) {
        if (!summary.active) continue;
        const eventMatchCriteria = summary.triggers?.eventMatchCriteria;
        if (!eventMatchCriteria) continue;
        out.push({
            id: summary.slug,
            instructions: summary.instructions,
            eventMatchCriteria,
        });
    }
    return out;
}

export const backgroundTaskEventConsumer: EventConsumer = {
    name: 'bg-task',

    listEligibleTargets,

    findCandidates: async (event, targets) => {
        // Targeted re-run from the UI — skip Pass-1.
        if (event.target?.consumer === 'bg-task') {
            return targets.some(t => t.id === event.target!.id) ? [event.target.id] : [];
        }
        return routeBatch(event, targets, {
            entitySingular: 'background task',
            entityPlural: 'background tasks',
            useCase: 'background_task_agent',
            resolveModel: resolveRoutingModel,
        });
    },

    fireCandidate: async (event, slug) => {
        const result = await runBackgroundTask(slug, 'event', event.payload);
        return { runId: result.runId, error: result.error };
    },
};
