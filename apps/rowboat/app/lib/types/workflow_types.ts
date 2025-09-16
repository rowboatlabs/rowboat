import { z } from "zod";
import { getDefaultTools } from "@/app/lib/default_tools";
export const WorkflowAgent = z.object({
    name: z.string(),
    order: z.number().int().optional(),
    type: z.enum([
        'conversation',
        'post_process',
        'escalation',
        'pipeline',
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
    outputVisibility: z.enum(['user_facing', 'internal']).default('user_facing').optional(),
    controlType: z.enum([
        'retain',
        'relinquish_to_parent',
        'relinquish_to_start',
    ]).optional().describe('Whether this agent retains control after a turn, relinquishes to the parent agent, or relinquishes to the start agent'),
    maxCallsPerParentAgent: z.number().default(3).describe('Maximum number of times this agent can be called by a parent agent in a single turn').optional(),
});
export const StrictWorkflowAgent = WorkflowAgent.refine((data) => {
    // Pipeline agents should have internal output visibility and relinquish_to_parent control type
    if (data.type === 'pipeline' && data.outputVisibility !== 'internal') {
        return false;
    }
    if (data.type === 'pipeline' && data.controlType !== 'relinquish_to_parent') {
        return false;
    }
    // Internal agents should have relinquish_to_parent control type
    if (data.outputVisibility === 'internal' && data.controlType !== 'relinquish_to_parent') {
        return false;
    }
    // User-facing agents should not have relinquish_to_parent control type
    if (data.outputVisibility === 'user_facing' && data.controlType === 'relinquish_to_parent') {
        return false;
    }
    // All agents should have a control type
    if (data.controlType === undefined) {
        return false;
    }
    return true;
}, {
    message: "Pipeline agents must have 'internal' output visibility and 'relinquish_to_parent' control type, while other agents must have appropriate control types",
    path: ["controlType", "outputVisibility"]
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
    isWebhook: z.boolean().optional(), // whether this is a webhook tool
    isGeminiImage: z.boolean().optional(), // whether this tool generates images via Gemini
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
    currentAgent?: z.infer<typeof WorkflowAgent>,
): {
    sanitized: string;
    entities: z.infer<typeof ConnectedEntity>[];
} {
    // Regex to match [@type:name](#type:something) pattern where type is tool/prompt/agent/pipeline/variable
    const mentionRegex = /\[@(tool|prompt|agent|pipeline|variable):([^\]]+)\]\(#mention\)/g;
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
            // Treat @variable: as @prompt: internally
            const type = match[1] === 'variable' ? 'prompt' : match[1];
            return {
                type: type as 'tool' | 'prompt' | 'agent' | 'pipeline',
                name: match[2],
            };
        })
        .filter(entity => {
            seen.add(entity.name);
            
            // For pipeline agents, only allow tool and prompt mentions
            if (currentAgent?.type === 'pipeline') {
                return entity.type === 'tool' || entity.type === 'prompt';
            }
            
            if (entity.type === 'agent') {
                // Filter out pipeline agents - they should not be @ referenceable
                const agent = workflow.agents.find(a => a.name === entity.name);
                return agent && agent.type !== 'pipeline';
            } else if (entity.type === 'tool') {
                // Allow referencing workflow tools or default library tools
                const inWorkflow = workflow.tools.some(t => t.name === entity.name);
                const inDefaults = getDefaultTools().some(t => t.name === entity.name);
                return inWorkflow || inDefaults;
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
        
        // Also handle @variable: mentions for prompts
        if (entity.type === 'prompt') {
            const variableTextToReplace = `[@variable:${entity.name}](#mention)`;
            text = text.replace(variableTextToReplace, `[@variable:${entity.name}]`);
        }
    }

    return {
        sanitized: text,
        entities,
    };
}
