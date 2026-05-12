import * as workspace from '../../workspace/workspace.js';
import { fetchLiveNote } from './fileops.js';
import { runLiveNoteAgent } from './runner.js';
import type { EventConsumer, EventConsumerTarget } from '../../events/consumer.js';
import { routeBatch } from '../../events/routing.js';
import { createProvider } from '../../models/models.js';
import { getDefaultModelAndProvider, getLiveNoteAgentModel, resolveProviderConfig } from '../../models/defaults.js';

async function resolveRoutingModel() {
    const modelId = await getLiveNoteAgentModel();
    const { provider } = await getDefaultModelAndProvider();
    const config = await resolveProviderConfig(provider);
    return {
        model: createProvider(config).languageModel(modelId),
        modelId,
        providerName: provider,
    };
}

async function listKnowledgeMarkdownFiles(): Promise<string[]> {
    try {
        const entries = await workspace.readdir('knowledge', { recursive: true });
        return entries
            .filter(e => e.kind === 'file' && e.name.endsWith('.md'))
            .map(e => e.path.replace(/^knowledge\//, ''));
    } catch {
        return [];
    }
}

async function listEligibleTargets(): Promise<EventConsumerTarget[]> {
    const out: EventConsumerTarget[] = [];
    const filePaths = await listKnowledgeMarkdownFiles();

    for (const filePath of filePaths) {
        let live;
        try {
            live = await fetchLiveNote(filePath);
        } catch {
            continue;
        }
        if (!live) continue;
        if (live.active === false) continue;

        const eventMatchCriteria = live.triggers?.eventMatchCriteria;
        if (!eventMatchCriteria) continue;

        out.push({
            id: filePath,
            instructions: live.objective,
            eventMatchCriteria,
        });
    }
    return out;
}

export const liveNoteEventConsumer: EventConsumer = {
    name: 'live-note',

    listEligibleTargets,

    findCandidates: async (event, targets) => {
        // Targeted re-run from the UI — skip Pass-1.
        if (event.target?.consumer === 'live-note') {
            return targets.some(t => t.id === event.target!.id) ? [event.target.id] : [];
        }
        return routeBatch(event, targets, {
            entitySingular: 'live note',
            entityPlural: 'live notes',
            useCase: 'live_note_agent',
            resolveModel: resolveRoutingModel,
        });
    },

    fireCandidate: async (event, filePath) => {
        const result = await runLiveNoteAgent(filePath, 'event', event.payload);
        return { runId: result.runId, error: result.error };
    },
};
