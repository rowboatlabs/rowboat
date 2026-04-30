import z from 'zod';

export const PromptBlockSchema = z.object({
    label: z.string().min(1).describe('Short title shown on the card'),
    instruction: z.string().min(1).describe('Full prompt sent to Copilot when Run is clicked'),
});

export type PromptBlock = z.infer<typeof PromptBlockSchema>;
