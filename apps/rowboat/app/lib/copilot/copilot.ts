import z from "zod";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, streamText, tool } from "ai";
import { WithStringId } from "../types/types";
import { Workflow, WorkflowTool } from "../types/workflow_types";
import { CopilotChatContext, CopilotMessage } from "../types/copilot_types";
import { DataSource } from "../types/datasource_types";
import { PrefixLogger } from "../utils";
import zodToJsonSchema from "zod-to-json-schema";
import { COPILOT_INSTRUCTIONS_EDIT_AGENT } from "./copilot_edit_agent";
import { COPILOT_INSTRUCTIONS_MULTI_AGENT } from "./copilot_multi_agent";
import { COPILOT_MULTI_AGENT_EXAMPLE_1 } from "./example_multi_agent_1";
import { CURRENT_WORKFLOW_PROMPT } from "./current_workflow";
import { Composio } from '@composio/core';
import { USE_COMPOSIO_TOOLS } from "../feature_flags";
import { getTool } from "../composio/composio";

const PROVIDER_API_KEY = process.env.PROVIDER_API_KEY || process.env.OPENAI_API_KEY || '';
const PROVIDER_BASE_URL = process.env.PROVIDER_BASE_URL || undefined;
const COPILOT_MODEL = process.env.PROVIDER_COPILOT_MODEL || 'gpt-4.1';
const AGENT_MODEL = process.env.PROVIDER_DEFAULT_MODEL || 'gpt-4.1';

const WORKFLOW_SCHEMA = JSON.stringify(zodToJsonSchema(Workflow));

const SYSTEM_PROMPT = [
    COPILOT_INSTRUCTIONS_MULTI_AGENT,
    COPILOT_MULTI_AGENT_EXAMPLE_1,
    CURRENT_WORKFLOW_PROMPT,
]
    .join('\n\n')
    .replace('{agent_model}', AGENT_MODEL)
    .replace('{workflow_schema}', WORKFLOW_SCHEMA);

const openai = createOpenAI({
    apiKey: PROVIDER_API_KEY,
    baseURL: PROVIDER_BASE_URL,
});

const ZTextEvent = z.object({
    content: z.string(),
});

const ZDoneEvent = z.object({
    done: z.literal(true),
});

const ZEvent = z.union([ZTextEvent, ZDoneEvent]);

function getContextPrompt(context: z.infer<typeof CopilotChatContext> | null): string {
    let prompt = '';
    switch (context?.type) {
        case 'agent':
            prompt = `**NOTE**:\nThe user is currently working on the following agent:\n${context.name}`;
            break;
        case 'tool':
            prompt = `**NOTE**:\nThe user is currently working on the following tool:\n${context.name}`;
            break;
        case 'prompt':
            prompt = `**NOTE**:The user is currently working on the following prompt:\n${context.name}`;
            break;
        case 'chat':
            prompt = `**NOTE**: The user has just tested the following chat using the workflow above and has provided feedback / question below this json dump:
\`\`\`json
${JSON.stringify(context.messages)}
\`\`\`
`;
            break;
    }
    return prompt;
}

function getCurrentWorkflowPrompt(workflow: z.infer<typeof Workflow>): string {
    return `Context:\n\nThe current workflow config is:
\`\`\`json
${JSON.stringify(workflow)}
\`\`\`
`;
}

function getDataSourcesPrompt(dataSources: WithStringId<z.infer<typeof DataSource>>[]): string {
    let prompt = '';
    if (dataSources.length > 0) {
        const simplifiedDataSources = dataSources.map(ds => ({
            id: ds._id,
            name: ds.name,
            description: ds.description,
            data: ds.data,
        }));
        prompt = `**NOTE**:
The following data sources are available:
\`\`\`json
${JSON.stringify(simplifiedDataSources)}
\`\`\`
`;
    }
    return prompt;
}

async function getDynamicToolsPrompt(userQuery: string, workflow: z.infer<typeof Workflow>): Promise<string> {
    console.log('--- [Co-pilot] Entering Dynamic Tool Creation ---');
    if (!USE_COMPOSIO_TOOLS) {
        console.log('[Co-pilot] Dynamic tool creation is disabled.');
        return '';
    }


    const composio = new Composio();

    // Step 1: Search for relevant tool slugs
    console.log('[Co-pilot] 🚀 Searching for relevant tools...');
    const searchResult = await composio.tools.execute('COMPOSIO_SEARCH_TOOLS', {
        userId: '0000-0000-0000', // hmmmmm
        arguments: { use_case: userQuery },
    });

    if (!searchResult.successful || !Array.isArray(searchResult.data?.results)) {
        console.warn('[Co-pilot] ⚠️ Tool search was not successful or returned no results.');
        return '';
    }

    const toolSlugs: string[] = searchResult.data.results.map((result: any) => result.tool);
    console.log(`[Co-pilot] ✅ Found tool slugs: ${toolSlugs.join(', ')}`);

    const composioTools = await Promise.all(toolSlugs.map(slug => getTool(slug)));
    const workflowTools: z.infer<typeof WorkflowTool>[] = composioTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: {
            type: 'object' as const,
            properties: tool.input_parameters?.properties || {},
            required: tool.input_parameters?.required || [],
        },
        isComposio: true,
        composioData: {
            slug: tool.slug,
            noAuth: tool.no_auth,
            toolkitName: tool.toolkit?.name || '',
            toolkitSlug: tool.toolkit?.slug || '',
            logo: tool.toolkit?.logo || '',
        },
    }));



    console.log('--- [Co-pilot] Exiting Dynamic Tool Creation (Success) ---');
    const toolConfigs = workflowTools.map(tool => 
        `**${tool.name}**:\n\`\`\`json\n${JSON.stringify(tool, null, 2)}\n\`\`\``
    ).join('\n\n');

    const prompt = `## Tool Suggestions:
The following tools are being suggested by the AI. You can use them in your workflow:

${toolConfigs}

To add any tool you can copy the above json as an add tool block`;
    console.log(prompt);
    return prompt;
}

function updateLastUserMessage(
    messages: z.infer<typeof CopilotMessage>[],
    currentWorkflowPrompt: string,
    contextPrompt: string,
    dataSourcesPrompt: string = '',
    dynamicToolsPrompt: string = '',
): void {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role === 'user') {
        lastMessage.content = `${currentWorkflowPrompt}\n\n${contextPrompt}\n\n${dataSourcesPrompt}\n\n${dynamicToolsPrompt}\n\nUser: ${JSON.stringify(lastMessage.content)}`;
    }
}


export async function getEditAgentInstructionsResponse(
    projectId: string,
    context: z.infer<typeof CopilotChatContext> | null,
    messages: z.infer<typeof CopilotMessage>[],
    workflow: z.infer<typeof Workflow>,
): Promise<string> {
    const logger = new PrefixLogger('copilot /getUpdatedAgentInstructions');
    logger.log('context', context);
    logger.log('projectId', projectId);

    // set the current workflow prompt
    const currentWorkflowPrompt = getCurrentWorkflowPrompt(workflow);

    // set context prompt
    let contextPrompt = getContextPrompt(context);

    // add the above prompts to the last user message
    updateLastUserMessage(messages, currentWorkflowPrompt, contextPrompt);

    // call model
    console.log("calling model", JSON.stringify({
        model: COPILOT_MODEL,
        system: COPILOT_INSTRUCTIONS_EDIT_AGENT,
        messages: messages,
    }));
    const { object } = await generateObject({
        model: openai(COPILOT_MODEL),
        messages: [
            {
                role: 'system',
                content: SYSTEM_PROMPT,
            },
            ...messages,
        ],
        schema: z.object({
            agent_instructions: z.string(),
        }),
    });

    return object.agent_instructions;
}

export async function* streamMultiAgentResponse(
    projectId: string,
    context: z.infer<typeof CopilotChatContext> | null,
    messages: z.infer<typeof CopilotMessage>[],
    workflow: z.infer<typeof Workflow>,
    dataSources: WithStringId<z.infer<typeof DataSource>>[]
): AsyncIterable<z.infer<typeof ZEvent>> {
    const logger = new PrefixLogger('copilot /stream');
    logger.log('context', context);
    logger.log('projectId', projectId);

    // set the current workflow prompt
    const currentWorkflowPrompt = getCurrentWorkflowPrompt(workflow);

    // set context prompt
    let contextPrompt = getContextPrompt(context);

    // set data sources prompt
    let dataSourcesPrompt = getDataSourcesPrompt(dataSources);

    // get dynamic tools prompt
    const dynamicToolsPrompt = await getDynamicToolsPrompt(messages[messages.length - 1].content, workflow);

    // add the above prompts to the last user message
    updateLastUserMessage(messages, currentWorkflowPrompt, contextPrompt, dataSourcesPrompt, dynamicToolsPrompt);

    // call model
    console.log("calling model", JSON.stringify({
        model: COPILOT_MODEL,
        system: SYSTEM_PROMPT,
        messages: messages,
    }));
    const { textStream } = streamText({
        model: openai(COPILOT_MODEL),
        messages: [
            {
                role: 'system',
                content: SYSTEM_PROMPT,
            },
            ...messages,
        ],
    });

    // emit response chunks
    for await (const chunk of textStream) {
        yield {
            content: chunk,
        };
    }

    // done
    yield {
        done: true,
    };
}