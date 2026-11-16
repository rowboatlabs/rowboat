import { generateText } from 'ai';
import { createLanguageModel } from '../models/models.js';
import { getChatTitleModel, resolveProviderConfig } from '../models/defaults.js';
import { directCallReasoningOptions } from '../models/reasoning.js';
import { captureLlmUsage } from '../analytics/usage.js';
import { withUseCase } from '../analytics/use_case.js';

// Describe → Write (agent personalities, 2026-10-29): the owner says in a few
// words what their agent should be like, and a light model writes its
// instructions, which the owner then edits. The same light model as chat
// titles (Rowboat's gateway by default), since this is a short rewrite, not
// reasoning.

const SYSTEM_PROMPT = `You write the instructions for an AI agent that works in a team's chat. People mention it in threads to ask for things, and it answers there.

Given the agent's name, what it is, and a short description from its owner, write the instructions the agent will follow.

Rules:
- Second person ("You are…", "You…"), addressed to the agent
- Start with one line saying who it is and what it is for
- Then a few short lines or "- " bullets on how it behaves: tone, what it focuses on, what it always or never does
- Under 120 words. Plain text: no headings, no bold, no emoji
- Keep to what the owner described. Never invent tools, access or facts about the team
- Same language as the owner's description
- Output the instructions and nothing else`;

const MAX_BRIEF_CHARS = 1000;
const MAX_OUTPUT_CHARS = 4000;

export async function writeAgentInstructions(input: { name: string; kind?: string; brief: string }): Promise<string> {
    const brief = input.brief.trim().slice(0, MAX_BRIEF_CHARS);
    if (!brief) throw new Error('Describe the agent first.');

    const { model: modelId, provider: providerName, effort } = await getChatTitleModel();
    const providerConfig = await resolveProviderConfig(providerName);
    const model = createLanguageModel(providerConfig, modelId);
    const reasoning = await directCallReasoningOptions(providerConfig.flavor, modelId, effort ?? 'low');
    const prompt = [`Name: ${input.name.trim() || 'the agent'}`, ...(input.kind ? [`What it is: ${input.kind}`] : []), `Owner's description: ${brief}`].join('\n');

    const result = await withUseCase({ useCase: 'copilot_chat', subUseCase: 'agent_instructions' }, () =>
        generateText({ model, system: SYSTEM_PROMPT, prompt, maxOutputTokens: 2000, ...reasoning }),
    );
    captureLlmUsage({ useCase: 'copilot_chat', subUseCase: 'agent_instructions', model: modelId, provider: providerName, usage: result.usage });

    const text = result.text.trim().replace(/^```\w*\n?|\n?```$/g, '').trim();
    if (!text) throw new Error('Couldn’t write instructions this time. Try again, or write them yourself.');
    return text.slice(0, MAX_OUTPUT_CHARS);
}
