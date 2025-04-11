'use server';
import { 
    convertToCopilotWorkflow, convertToCopilotMessage, convertToCopilotApiMessage,
    convertToCopilotApiChatContext, CopilotAPIResponse, CopilotAPIRequest,
    CopilotChatContext, CopilotMessage, CopilotAssistantMessage, CopilotWorkflow 
} from "../lib/types/copilot_types";
import { 
    Workflow, WorkflowTool, WorkflowPrompt, WorkflowAgent 
} from "../lib/types/workflow_types";
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { assert } from "node:console";
import { check_query_limit } from "../lib/rate_limiting";
import { QueryLimitError } from "../lib/client_utils";
import { projectAuthCheck } from "./project_actions";

export async function getCopilotResponse(
    projectId: string,
    messages: z.infer<typeof CopilotMessage>[],
    current_workflow_config: z.infer<typeof Workflow>,
    context: z.infer<typeof CopilotChatContext> | null
): Promise<{
    message: z.infer<typeof CopilotAssistantMessage>;
    rawRequest: unknown;
    rawResponse: unknown;
}> {
    await projectAuthCheck(projectId);
    if (!await check_query_limit(projectId)) {
        throw new QueryLimitError();
    }

    // prepare request
    const request: z.infer<typeof CopilotAPIRequest> = {
        messages: messages.map(convertToCopilotApiMessage),
        workflow_schema: JSON.stringify(zodToJsonSchema(CopilotWorkflow)),
        current_workflow_config: JSON.stringify(convertToCopilotWorkflow(current_workflow_config)),
        context: context ? convertToCopilotApiChatContext(context) : null,
    };
    console.log(`sending copilot request`, JSON.stringify(request));

    // call copilot api
    const response = await fetch(process.env.COPILOT_API_URL + '/chat', {
        method: 'POST',
        body: JSON.stringify(request),
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.COPILOT_API_KEY || 'test'}`,
        },
    });
    if (!response.ok) {
        console.error('Failed to call copilot api', response);
        throw new Error(`Failed to call copilot api: ${response.statusText}`);
    }

    // parse and return response
    const json: z.infer<typeof CopilotAPIResponse> = await response.json();
    console.log(`received copilot response`, JSON.stringify(json));
    if ('error' in json) {
        throw new Error(`Failed to call copilot api: ${json.error}`);
    }
    // remove leading ```json and trailing ```
    const msg = convertToCopilotMessage({
        role: 'assistant',
        content: json.response.replace(/^```json\n/, '').replace(/\n```$/, ''),
    });

    // validate response schema
    assert(msg.role === 'assistant');
    if (msg.role === 'assistant') {
        for (const part of msg.content.response) {
            if (part.type === 'action') {
                switch (part.content.config_type) {
                    case 'tool': {
                        const test = {
                            name: 'test',
                            description: 'test',
                            type: 'custom' as const,
                            implementation: 'mock' as const,
                            parameters: {
                                type: 'object',
                                properties: {},
                                required: [],
                            },
                        } as z.infer<typeof WorkflowTool>;
                        // iterate over each field in part.content.config_changes
                        // and test if the final object schema is valid
                        // if not, discard that field
                        for (const [key, value] of Object.entries(part.content.config_changes)) {
                            const result = WorkflowTool.safeParse({
                                ...test,
                                [key]: value,
                            });
                            if (!result.success) {
                                console.log(`discarding field ${key} from ${part.content.config_type}: ${part.content.name}`, result.error.message);
                                delete part.content.config_changes[key];
                            }
                        }
                        break;
                    }
                    case 'agent': {
                        const test = {
                            name: 'test',
                            description: 'test',
                            type: 'conversation',
                            instructions: 'test',
                            prompts: [],
                            tools: [],
                            model: 'gpt-4o',
                            ragReturnType: 'chunks',
                            ragK: 10,
                            connectedAgents: [],
                            controlType: 'retain',
                        } as z.infer<typeof WorkflowAgent>;
                        // iterate over each field in part.content.config_changes
                        // and test if the final object schema is valid
                        // if not, discard that field
                        for (const [key, value] of Object.entries(part.content.config_changes)) {
                            const result = WorkflowAgent.safeParse({
                                ...test,
                                [key]: value,
                            });
                            if (!result.success) {
                                console.log(`discarding field ${key} from ${part.content.config_type}: ${part.content.name}`, result.error.message);
                                delete part.content.config_changes[key];
                            }
                        }
                        break;
                    }
                    case 'prompt': {
                        const test = {
                            name: 'test',
                            type: 'base_prompt',
                            prompt: "test",
                        } as z.infer<typeof WorkflowPrompt>;
                        // iterate over each field in part.content.config_changes
                        // and test if the final object schema is valid
                        // if not, discard that field
                        for (const [key, value] of Object.entries(part.content.config_changes)) {
                            const result = WorkflowPrompt.safeParse({
                                ...test,
                                [key]: value,
                            });
                            if (!result.success) {
                                console.log(`discarding field ${key} from ${part.content.config_type}: ${part.content.name}`, result.error.message);
                                delete part.content.config_changes[key];
                            }
                        }
                        break;
                    }
                    default: {
                        part.content.error = `Unknown config type: ${part.content.config_type}`;
                        break;
                    }
                }
            }
        }
    }

    return {
        message: msg as z.infer<typeof CopilotAssistantMessage>,
        rawRequest: request,
        rawResponse: json,
    };
}

export async function getCopilotAgentInstructions(
    projectId: string,
    messages: z.infer<typeof CopilotMessage>[],
    current_workflow_config: z.infer<typeof Workflow>,
    agentName: string,
): Promise<string> {
    await projectAuthCheck(projectId);
    if (!await check_query_limit(projectId)) {
        throw new QueryLimitError();
    }

    // prepare request
    const request: z.infer<typeof CopilotAPIRequest> = {
        messages: messages.map(convertToCopilotApiMessage),
        workflow_schema: JSON.stringify(zodToJsonSchema(CopilotWorkflow)),
        current_workflow_config: JSON.stringify(convertToCopilotWorkflow(current_workflow_config)),
        context: {
            type: 'agent',
            agentName: agentName,
        }
    };
    console.log(`sending copilot agent instructions request`, JSON.stringify(request));

    // call copilot api
    const response = await fetch(process.env.COPILOT_API_URL + '/edit_agent_instructions', {
        method: 'POST',
        body: JSON.stringify(request),
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.COPILOT_API_KEY || 'test'}`,
        },
    });
    if (!response.ok) {
        console.error('Failed to call copilot api', response);
        throw new Error(`Failed to call copilot api: ${response.statusText}`);
    }

    // parse and return response
    const json = await response.json();

    console.log(`received copilot agent instructions response`, JSON.stringify(json));
    let copilotResponse: z.infer<typeof CopilotAPIResponse>;
    let agent_instructions: string;
    try {
        copilotResponse = CopilotAPIResponse.parse(json);
        const content = json.response.replace(/^```json\n/, '').replace(/\n```$/, '');
        agent_instructions = JSON.parse(content).agent_instructions;

    } catch (e) {
        console.error('Failed to parse copilot response', e);
        throw new Error(`Failed to parse copilot response: ${e}`);
    }
    if ('error' in copilotResponse) {
        throw new Error(`Failed to call copilot api: ${copilotResponse.error}`);
    }

    // return response
    return agent_instructions;
}