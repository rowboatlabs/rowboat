import { z } from "zod";
export const WorkflowAgent = z.object({
    name: z.string(),
    order: z.number().int().optional(),
    type: z.enum([
        'conversation',
        'post_process',
        'escalation',
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
    ragReturnType: z.enum(['chunks', 'content']).default('chunks'),
    ragK: z.number().default(3),
    outputVisibility: z.enum(['user_facing', 'internal', 'pipeline']).default('user_facing').optional(),
    controlType: z.enum([
        'retain',
        'relinquish_to_parent',
        'relinquish_to_start',
    ]).default('retain').describe('Whether this agent retains control after a turn, relinquishes to the parent agent, or relinquishes to the start agent'),
    maxCallsPerParentAgent: z.number().default(3).describe('Maximum number of times this agent can be called by a parent agent in a single turn').optional(),
});
export const WorkflowPrompt = z.object({
    name: z.string(),
    type: z.enum([
        'base_prompt',
        'style_prompt',
        'greeting',
    ]),
    prompt: z.string(),
});
export const WorkflowTool = z.object({
    name: z.string(),
    description: z.string(),
    mockTool: z.boolean().default(false).optional(),
    mockInstructions: z.string().optional(),
    parameters: z.object({
        type: z.literal('object'),
        properties: z.record(z.string(), z.any()),
        required: z.array(z.string()).optional(),
        additionalProperties: z.boolean().optional(),
    }),
    isMcp: z.boolean().default(false).optional(),
    mcpServerName: z.string().optional(),
    isComposio: z.boolean().optional(), // whether this is a Composio tool
    isLibrary: z.boolean().default(false).optional(), // whether this is a library tool
    composioData: z.object({
        slug: z.string(), // the slug for the Composio tool e.g. "GITHUB_CREATE_AN_ISSUE"
        noAuth: z.boolean(), // whether the tool requires no authentication
        toolkitName: z.string(), // the name for the Composio toolkit e.g. "GITHUB"
        toolkitSlug: z.string(), // the slug for the Composio toolkit e.g. "GITHUB"
        logo: z.string(), // the logo for the Composio tool
    }).optional(), // the data for the Composio tool, if it is a Composio tool
});

export const WorkflowPipeline = z.object({
    name: z.string(),
    description: z.string().optional(),
    agents: z.array(z.string()), // ordered list of agent names in the pipeline
    order: z.number().int().optional(),
});

export const Workflow = z.object({
    agents: z.array(WorkflowAgent),
    prompts: z.array(WorkflowPrompt),
    tools: z.array(WorkflowTool),
    pipelines: z.array(WorkflowPipeline).optional(),
    startAgent: z.string(),
    lastUpdatedAt: z.string().datetime(),
    mockTools: z.record(z.string(), z.string()).optional(), // a dict of toolName => mockInstructions
});
export const WorkflowTemplate = Workflow
    .omit({
        lastUpdatedAt: true,
    })
    .extend({
        name: z.string(),
        description: z.string(),
    });

export const ConnectedEntity = z.object({
    type: z.enum(['tool', 'prompt', 'agent', 'pipeline']),
    name: z.string(),
});

export function sanitizeTextWithMentions(
    text: string,
    workflow: {
        agents: z.infer<typeof WorkflowAgent>[],
        tools: z.infer<typeof WorkflowTool>[],
        prompts: z.infer<typeof WorkflowPrompt>[],
        pipelines?: z.infer<typeof WorkflowPipeline>[],
    },
): {
    sanitized: string;
    entities: z.infer<typeof ConnectedEntity>[];
} {
    // Regex to match [@type:name](#type:something) pattern where type is tool/prompt/agent/pipeline
    const mentionRegex = /\[@(tool|prompt|agent|pipeline):([^\]]+)\]\(#mention\)/g;
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
                type: match[1] as 'tool' | 'prompt' | 'agent' | 'pipeline',
                name: match[2],
            };
        })
        .filter(entity => {
            seen.add(entity.name);
            if (entity.type === 'agent') {
                return workflow.agents.some(a => a.name === entity.name);
            } else if (entity.type === 'tool') {
                return workflow.tools.some(t => t.name === entity.name);
            } else if (entity.type === 'prompt') {
                return workflow.prompts.some(p => p.name === entity.name);
            } else if (entity.type === 'pipeline') {
                return workflow.pipelines?.some(p => p.name === entity.name);
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