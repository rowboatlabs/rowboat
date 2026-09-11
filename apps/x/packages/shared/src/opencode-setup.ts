import { z } from 'zod';

export const OpenCodeProviderId = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_.-]+$/);
export const OpenCodeAuthPrompt = z.object({
    type: z.enum(['text', 'select']), key: z.string(), message: z.string(), placeholder: z.string().optional(),
    options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
    when: z.object({ key: z.string(), op: z.enum(['eq', 'neq']), value: z.string() }).optional(),
}).refine(prompt => prompt.type !== 'select' || (prompt.options?.length ?? 0) > 0, 'Select prompts require options');
export const OpenCodeAuthMethod = z.object({
    index: z.number().int(), type: z.enum(['api', 'oauth', 'unsupported']), label: z.string(),
    supported: z.boolean(), prompts: z.array(OpenCodeAuthPrompt),
});
export const OpenCodeProvider = z.object({
    id: OpenCodeProviderId, name: z.string(), connected: z.boolean(),
    methods: z.array(OpenCodeAuthMethod), models: z.array(z.object({ id: z.string(), name: z.string() })),
});
export const OpenCodeSelection = z.object({ providerId: OpenCodeProviderId, modelId: z.string().min(1).max(500) });
export const OpenCodeSetupState = z.object({
    setupId: z.string(), generation: z.number().int(), providers: z.array(OpenCodeProvider),
    selection: OpenCodeSelection.optional(),
    verified: OpenCodeSelection.extend({ at: z.number(), generation: z.number() }).optional(),
});
export const OpenCodeAuthorization = z.object({
    attemptId: z.string(), method: z.enum(['auto', 'code']), instructions: z.string(), expiresAt: z.number(),
});
export type OpenCodeSetupState = z.infer<typeof OpenCodeSetupState>;
export type OpenCodeProvider = z.infer<typeof OpenCodeProvider>;
export type OpenCodeAuthMethod = z.infer<typeof OpenCodeAuthMethod>;
export type OpenCodeAuthorization = z.infer<typeof OpenCodeAuthorization>;

export const OpenCodeSetupError = z.object({
    code: z.enum(['cancelled', 'expired', 'busy', 'unavailable', 'invalid-credentials', 'unavailable-model', 'rate-limit', 'unsupported', 'invalid-input', 'failed']),
    message: z.string(),
});
export function setupResult<T extends z.ZodType>(data: T) {
    return z.discriminatedUnion('success', [z.object({ success: z.literal(true), data }), z.object({ success: z.literal(false), error: OpenCodeSetupError })]);
}
