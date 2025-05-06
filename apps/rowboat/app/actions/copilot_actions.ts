'use server';
import { 
    convertToCopilotWorkflow, convertToCopilotMessage, convertToCopilotApiMessage,
    convertToCopilotApiChatContext, CopilotAPIResponse, CopilotAPIRequest,
    CopilotChatContext, CopilotMessage, CopilotAssistantMessage, CopilotWorkflow 
} from "../lib/types/copilot_types";
import { 
    Workflow} from "../lib/types/workflow_types";
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { assert } from "node:console";
import { check_query_limit } from "../lib/rate_limiting";
import { QueryLimitError, validateConfigChanges } from "../lib/client_utils";
import { projectAuthCheck } from "./project_actions";
import { getRedisClient } from "../lib/redis";

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
        const content = JSON.parse(msg.content);
        for (const part of content.response) {
            if (part.type === 'action') {
                const result = validateConfigChanges(
                    part.content.config_type,
                    part.content.config_changes,
                    part.content.name
                );
                
                if ('error' in result) {
                    part.content.error = result.error;
                } else {
                    part.content.config_changes = result.changes;
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

export async function getCopilotResponseStream(
    projectId: string,
    messages: z.infer<typeof CopilotMessage>[],
    current_workflow_config: z.infer<typeof Workflow>,
    context: z.infer<typeof CopilotChatContext> | null
): Promise<{
    streamId: string;
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

    // serialize the request
    const payload = JSON.stringify(request);

    // create a uuid for the stream
    const streamId = crypto.randomUUID();

    // store payload in redis
    try {
      const client = await getRedisClient();
      await client.set(`copilot-stream-${streamId}`, payload, {
          EX: 60 * 10, // expire in 10 minutes
      });
    } catch (error) {
      console.error("Redis operation failed in getCopilotResponseStream:", error);
      // Decide how to handle the error. Maybe throw it or return an error indicator.
      throw new Error("Failed to store stream data in Redis.");
    }

    return {
        streamId,
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