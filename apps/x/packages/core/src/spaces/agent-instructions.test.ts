import { beforeEach, describe, expect, it, vi } from 'vitest';

// Describe → Write (2026-10-29): the light model is stubbed; what is checked
// is what it is asked and what comes back to the owner.

const h = vi.hoisted(() => ({ calls: [] as Array<{ system: string; prompt: string }>, reply: '' }));
vi.mock('ai', () => ({
  generateText: async (args: { system: string; prompt: string }) => {
    h.calls.push({ system: args.system, prompt: args.prompt });
    return { text: h.reply, usage: {} };
  },
}));
vi.mock('../models/models.js', () => ({ createLanguageModel: () => ({}) }));
vi.mock('../models/defaults.js', () => ({
  getChatTitleModel: async () => ({ model: 'gemini-3.5-flash', provider: 'rowboat' }),
  resolveProviderConfig: async () => ({ flavor: 'rowboat' }),
}));
vi.mock('../models/reasoning.js', () => ({ directCallReasoningOptions: async () => ({}) }));
vi.mock('../analytics/usage.js', () => ({ captureLlmUsage: () => {} }));
vi.mock('../analytics/use_case.js', () => ({ withUseCase: (_: unknown, fn: () => unknown) => fn() }));

import { writeAgentInstructions } from './agent-instructions.js';

beforeEach(() => {
  h.calls.length = 0;
});

describe('writeAgentInstructions', () => {
  it('asks with the name, what it is and the owner’s words, and returns the instructions', async () => {
    h.reply = 'You are Scout, the team’s reviewer.\n- Be brief.';
    const out = await writeAgentInstructions({ name: 'Scout', kind: 'Claude Code', brief: '  a terse reviewer that runs tests ' });
    expect(out).toBe('You are Scout, the team’s reviewer.\n- Be brief.');
    expect(h.calls[0]!.prompt).toBe('Name: Scout\nWhat it is: Claude Code\nOwner\'s description: a terse reviewer that runs tests');
    expect(h.calls[0]!.system).toMatch(/Second person/);
  });

  it('drops a code fence the model wraps it in', async () => {
    h.reply = '```\nYou are Scout.\n```';
    expect(await writeAgentInstructions({ name: 'Scout', brief: 'reviewer' })).toBe('You are Scout.');
  });

  it('needs a description, and says so when the model gives nothing', async () => {
    await expect(writeAgentInstructions({ name: 'Scout', brief: '   ' })).rejects.toThrow(/Describe the agent first/);
    h.reply = '   ';
    await expect(writeAgentInstructions({ name: 'Scout', brief: 'reviewer' })).rejects.toThrow(/Couldn’t write instructions/);
  });
});
