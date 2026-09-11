import z from 'zod';

export type OpenCodeAccessGroup = 'free' | 'zen' | 'go';
const Catalog = z.object({ all: z.array(z.object({
    id: z.string(), models: z.record(z.string(), z.object({
        id: z.string(), cost: z.object({ input: z.number(), output: z.number() }).optional(),
    })),
})) });

/** Saved connection IDs select the service, not an inferred subscription tier.
 * Public access fails closed unless native pricing metadata confirms zero cost. */
export function openCodeModelAccess(credentials: Set<string>, rawCatalog: unknown) {
    const groups: OpenCodeAccessGroup[] = [];
    if (credentials.has('opencode')) groups.push('zen');
    if (credentials.has('opencode-go')) groups.push('go');
    if (!groups.length) groups.push('free');
    const models = new Map<string, OpenCodeAccessGroup>();
    const parsed = Catalog.safeParse(rawCatalog);
    if (!parsed.success) throw new Error('OpenCode model access could not be read. Refresh models to retry.');
    for (const provider of parsed.data.all) {
        const group = provider.id === 'opencode-go' ? 'go' : provider.id === 'opencode' ? (groups.includes('free') ? 'free' : 'zen') : undefined;
        if (!group || !groups.includes(group)) continue;
        for (const model of Object.values(provider.models)) {
            if (group === 'free' && (model.cost?.input !== 0 || model.cost?.output !== 0)) continue;
            models.set(`${provider.id}/${model.id}`, group);
        }
    }
    return { groups, models };
}

export const OPEN_CODE_ACCESS_ERROR = 'This model is unavailable through your current OpenCode connection. Refresh models and choose a model from the available service.';
