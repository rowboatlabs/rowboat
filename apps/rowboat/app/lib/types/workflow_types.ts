import { z } from "zod";
export const WorkflowAgent = z.object({
    name: z.string(),
    order: z.number().int().optional(),
    type: z.union([
        z.literal('conversation'),
        z.literal('post_process'),
        z.literal('escalation'),
    ]),
    description: z.string(),
    disabled: z.boolean().default(false).optional(),
    instructions: z.string(),
    examples: z.string().optional(),
    model: z.string(),
    locked: z.boolean().default(false).describe('Whether this agent is locked and cannot be deleted').optional(),
    toggleAble: z.boolean().default(true).describe('Whether this agent can be enabled or disabled').optional(),
    global: z.boolean().default(false).describe('Whether this agent is a global agent, in which case it cannot be connected to other agents').optional(),
    ragDataSources: z.array(z.string()).optional(),
    ragReturnType: z.union([z.literal('chunks'), z.literal('content')]).default('chunks'),
    ragK: z.number().default(3),
    outputVisibility: z.union([z.literal('user_facing'), z.literal('internal')]).default('user_facing').optional(),
    controlType: z.union([z.literal('retain'), z.literal('relinquish_to_parent'), z.literal('relinquish_to_start')]).default('retain').describe('Whether this agent retains control after a turn, relinquishes to the parent agent, or relinquishes to the start agent'),
    maxCallsPerParentAgent: z.number().default(3).describe('Maximum number of times this agent can be called by a parent agent in a single turn').optional(),
});
export const WorkflowPrompt = z.object({
    name: z.string(),
    type: z.union([
        z.literal('base_prompt'),
        z.literal('style_prompt'),
        z.literal('greeting'),
    ]),
    prompt: z.string(),
});
export const WorkflowTool = z.object({
    name: z.string(),
    description: z.string(),
    mockTool: z.boolean().default(false).optional(),
    autoSubmitMockedResponse: z.boolean().default(false).optional(),
    mockInstructions: z.string().optional(),
    parameters: z.object({
        type: z.literal('object'),
        properties: z.record(z.object({
            type: z.string(),
            description: z.string(),
            enum: z.array(z.any()).optional(),
            default: z.any().optional(),
            minimum: z.number().optional(),
            maximum: z.number().optional(),
            items: z.any().optional(),  // For array types
            format: z.string().optional(),
            pattern: z.string().optional(),
            minLength: z.number().optional(),
            maxLength: z.number().optional(),
            minItems: z.number().optional(),
            maxItems: z.number().optional(),
            uniqueItems: z.boolean().optional(),
            multipleOf: z.number().optional(),
            examples: z.array(z.any()).optional(),
        })),
        required: z.array(z.string()).default([]),
    }).default({
        type: 'object',
        properties: {},
        required: [],
    }),
    isMcp: z.boolean().default(false).optional(),
    isLibrary: z.boolean().default(false).optional(),
    mcpServerName: z.string().optional(),
    mcpServerURL: z.string().optional(),
});
export const Workflow = z.object({
    name: z.string().optional(),
    agents: z.array(WorkflowAgent),
    prompts: z.array(WorkflowPrompt),
    tools: z.array(WorkflowTool),
    startAgent: z.string(),
    createdAt: z.string().datetime(),
    lastUpdatedAt: z.string().datetime(),
    projectId: z.string(),
});
export const WorkflowTemplate = Workflow
    .omit({
        projectId: true,
        lastUpdatedAt: true,
        createdAt: true,
    })
    .extend({
        name: z.string(),
        description: z.string(),
    });

export const ConnectedEntity = z.object({
    type: z.union([z.literal('tool'), z.literal('prompt'), z.literal('agent')]),
    name: z.string(),
});

export function sanitizeTextWithMentions(
    text: string,
    workflow: {
        agents: z.infer<typeof WorkflowAgent>[],
        tools: z.infer<typeof WorkflowTool>[],
        prompts: z.infer<typeof WorkflowPrompt>[],
    },
    projectTools: z.infer<typeof WorkflowTool>[] = []
): {
    sanitized: string;
    entities: z.infer<typeof ConnectedEntity>[];
} {
    // Regex to match [@type:name](#type:something) pattern where type is tool/prompt/agent
    const mentionRegex = /\[@(tool|prompt|agent):([^\]]+)\]\(#mention\)/g;
    const seen = new Set<string>();

    // collect entities
    const entities = Array
        .from(text.matchAll(mentionRegex))
        .filter(match => {
            if (seen.has(match[0])) {
                return false;
            }
            seen.add(match[0]);
            return true;
        })
        .map(match => {
            return {
                type: match[1] as 'tool' | 'prompt' | 'agent',
                name: match[2],
            };
        })
        .filter(entity => {
            seen.add(entity.name);
            if (entity.type === 'agent') {
                return workflow.agents.some(a => a.name === entity.name);
            } else if (entity.type === 'tool') {
                return workflow.tools.some(t => t.name === entity.name) || 
                       projectTools.some(t => t.name === entity.name);
            } else if (entity.type === 'prompt') {
                return workflow.prompts.some(p => p.name === entity.name);
            }
            return false;
        })

    // sanitize text
    for (const entity of entities) {
        const id = `${entity.type}:${entity.name}`;
        const textToReplace = `[@${id}](#mention)`;
        text = text.replace(textToReplace, `[@${id}]`);
    }

    return {
        sanitized: text,
        entities,
    };
}