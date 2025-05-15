import { z } from "zod";
import { sanitizeTextWithMentions, Workflow, WorkflowAgent, WorkflowPrompt, WorkflowTool } from "./workflow_types";
import { apiV1 } from "rowboat-shared";
import { ApiMessage } from "./types";
import { TestProfile } from "./testing_types";
import { MCPServer, MCPServerMinimal } from "./types";
import { mergeProjectTools } from "./project_types";

export const AgenticAPIChatMessage = z.object({
    role: z.union([z.literal('user'), z.literal('assistant'), z.literal('tool'), z.literal('system')]),
    content: z.string().nullable(),
    tool_calls: z.array(z.object({
        id: z.string(),
        function: z.object({
            name: z.string(),
            arguments: z.string(),
        }),
        type: z.literal('function'),
    })).nullable(),
    tool_call_id: z.string().nullable(),
    tool_name: z.string().nullable(),
    sender: z.string().nullable(),
    response_type: z.union([
        z.literal('internal'),
        z.literal('external'),
    ]).optional(),
});

export const AgenticAPIAgent = WorkflowAgent
    .omit({
        disabled: true,
        examples: true,
        locked: true,
        toggleAble: true,
        global: true,
    })
    .extend({
        tools: z.array(z.string()),
        prompts: z.array(z.string()),
        connectedAgents: z.array(z.string()),
    });

export const AgenticAPIPrompt = WorkflowPrompt;

export const AgenticAPITool = WorkflowTool
    .omit({
        autoSubmitMockedResponse: true,
    })

export const AgenticAPIChatRequest = z.object({
    projectId: z.string(),
    messages: z.array(AgenticAPIChatMessage),
    state: z.unknown(),
    agents: z.array(AgenticAPIAgent),
    tools: z.array(AgenticAPITool),
    prompts: z.array(WorkflowPrompt),
    startAgent: z.string(),
    testProfile: TestProfile.optional(),
    mcpServers: z.array(MCPServerMinimal),
    toolWebhookUrl: z.string(),
});

export const AgenticAPIChatResponse = z.object({
    messages: z.array(AgenticAPIChatMessage),
    state: z.unknown(),
});

export const AgenticAPIInitStreamResponse = z.object({
    streamId: z.string(),
});

export function convertWorkflowToAgenticAPI(workflow: z.infer<typeof Workflow>, projectTools: z.infer<typeof WorkflowTool>[]): {
    agents: z.infer<typeof AgenticAPIAgent>[];
    tools: z.infer<typeof AgenticAPITool>[];
    prompts: z.infer<typeof AgenticAPIPrompt>[];
    startAgent: string;
} {
    const mergedTools = mergeProjectTools(workflow.tools, projectTools);

    return {
        agents: workflow.agents
            .filter(agent => !agent.disabled)
            .map(agent => {
                const compiledInstructions = agent.instructions +
                    (agent.examples ? '\n\n# Examples\n' + agent.examples : '');
                const { sanitized, entities } = sanitizeTextWithMentions(compiledInstructions, workflow, mergedTools);

                const agenticAgent: z.infer<typeof AgenticAPIAgent> = {
                    name: agent.name,
                    type: agent.type,
                    description: agent.description,
                    instructions: sanitized,
                    model: agent.model,
                    controlType: agent.controlType,
                    ragDataSources: agent.ragDataSources,
                    ragK: agent.ragK,
                    ragReturnType: agent.ragReturnType,
                    outputVisibility: agent.outputVisibility,
                    tools: entities.filter(e => e.type == 'tool').map(e => e.name),
                    prompts: entities.filter(e => e.type == 'prompt').map(e => e.name),
                    connectedAgents: entities.filter(e => e.type === 'agent').map(e => e.name),
                    maxCallsPerParentAgent: agent.maxCallsPerParentAgent,
                };
                return agenticAgent;
            }),
        tools: mergedTools,
        prompts: workflow.prompts
            .map(p => {
                const { sanitized } = sanitizeTextWithMentions(p.prompt, workflow, mergedTools);
                return {
                    ...p,
                    prompt: sanitized,
                };
            }),
        startAgent: workflow.startAgent,
    };
}

export function convertToAgenticAPIChatMessages(messages: z.infer<typeof apiV1.ChatMessage>[]): z.infer<typeof AgenticAPIChatMessage>[] {
    const converted: z.infer<typeof AgenticAPIChatMessage>[] = [];

    for (const m of messages) {
        const baseMessage: z.infer<typeof AgenticAPIChatMessage> = {
            content: null,
            role: m.role,
            sender: null,
            tool_calls: null,
            tool_call_id: null,
            tool_name: null,
        };

        switch (m.role) {
            case 'system':
                converted.push({
                    ...baseMessage,
                    content: m.content,
                });
                break;
            case 'user':
                converted.push({
                    ...baseMessage,
                    content: m.content,
                });
                break;
            case 'assistant':
                if ('tool_calls' in m) {
                    converted.push({
                        ...baseMessage,
                        tool_calls: m.tool_calls,
                        sender: m.agenticSender ?? null,
                        response_type: m.agenticResponseType,
                    });
                } else {
                    converted.push({
                        ...baseMessage,
                        content: m.content,
                        sender: m.agenticSender ?? null,
                        response_type: m.agenticResponseType,
                    });
                }
                break;
            case 'tool':
                converted.push({
                    ...baseMessage,
                    content: m.content,
                    tool_call_id: m.tool_call_id,
                    tool_name: m.tool_name,
                });
                break;
            default:
                continue;
        }
    }

    return converted;
}

export function convertFromAgenticAPIChatMessages(messages: z.infer<typeof AgenticAPIChatMessage>[]): z.infer<typeof apiV1.ChatMessage>[] {
    const converted: z.infer<typeof apiV1.ChatMessage>[] = [];

    for (const m of messages) {
        const baseMessage = {
            version: 'v1' as const,
            chatId: '',
            createdAt: new Date().toISOString(),
        };
        switch (m.role) {
            case 'user':
                converted.push({
                    ...baseMessage,
                    role: 'user',
                    content: m.content ?? '',
                });
                break;
            case 'assistant':
                if (m.tool_calls) {
                    // TODO: handle tool calls
                    converted.push({
                        ...baseMessage,
                        role: 'assistant',
                        tool_calls: m.tool_calls,
                        agenticSender: m.sender ?? undefined,
                        agenticResponseType: m.response_type ?? 'internal',
                    });
                } else {
                    converted.push({
                        ...baseMessage,
                        role: 'assistant',
                        content: m.content ?? '',
                        agenticSender: m.sender ?? undefined,
                        agenticResponseType: m.response_type ?? 'internal',
                    });
                }
                break;
            case 'tool':
                converted.push({
                    ...baseMessage,
                    role: 'tool',
                    content: m.content ?? '',
                    tool_call_id: m.tool_call_id ?? '',
                    tool_name: m.tool_name ?? '',
                });
                break;
        }
    }
    return converted;
}

export function convertFromApiToAgenticApiMessages(messages: z.infer<typeof ApiMessage>[]): z.infer<typeof AgenticAPIChatMessage>[] {
    return messages.map(m => {
        switch (m.role) {
            case 'system':
                return {
                    role: 'system',
                    content: m.content,
                    tool_calls: null,
                    tool_call_id: null,
                    tool_name: null,
                    sender: null,
                };
            case 'user':
                return {
                    role: 'user',
                    content: m.content,
                    tool_calls: null,
                    tool_call_id: null,
                    tool_name: null,
                    sender: null,
                };

            case 'assistant':
                if ('tool_calls' in m) {
                    return {
                        role: 'assistant',
                        content: m.content ?? null,
                        tool_calls: m.tool_calls,
                        tool_call_id: null,
                        tool_name: null,
                        sender: m.agenticSender ?? null,
                        response_type: m.agenticResponseType ?? 'external',
                    };
                } else {
                    return {
                        role: 'assistant',
                        content: m.content ?? null,
                        sender: m.agenticSender ?? null,
                        response_type: m.agenticResponseType ?? 'external',
                        tool_call_id: null,
                        tool_calls: null,
                        tool_name: null,
                    };
                }
            case 'tool':
                return {
                    role: 'tool',
                    content: m.content ?? null,
                    tool_calls: null,
                    tool_call_id: m.tool_call_id ?? null,
                    tool_name: m.tool_name ?? null,
                    sender: null,
                };
            default:
                return {
                    role: "user",
                    content: "foo",
                    tool_calls: null,
                    tool_call_id: null,
                    tool_name: null,
                    sender: null,
                };
        }
    });
}

export function convertFromAgenticApiToApiMessages(messages: z.infer<typeof AgenticAPIChatMessage>[]): z.infer<typeof ApiMessage>[] {
    const converted: z.infer<typeof ApiMessage>[] = [];

    for (const m of messages) {
        switch (m.role) {
            case 'user':
                converted.push({
                    role: 'user',
                    content: m.content ?? '',
                });
                break;
            case 'assistant':
                if (m.tool_calls) {
                    converted.push({
                        role: 'assistant',
                        tool_calls: m.tool_calls,
                        agenticSender: m.sender ?? undefined,
                        agenticResponseType: m.response_type ?? 'internal',
                    });
                } else {
                    converted.push({
                        role: 'assistant',
                        content: m.content ?? '',
                        agenticSender: m.sender ?? undefined,
                        agenticResponseType: m.response_type ?? 'internal',
                    });
                }
                break;
            case 'tool':
                converted.push({
                    role: 'tool',
                    content: m.content ?? '',
                    tool_call_id: m.tool_call_id ?? '',
                    tool_name: m.tool_name ?? '',
                });
                break;
        }
    }
    return converted;
}
