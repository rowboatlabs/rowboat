import z from "zod";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, streamText } from "ai";
import { WithStringId } from "../types/types";
import { Workflow } from "../types/workflow_types";
import { CopilotChatContext, CopilotMessage } from "../types/copilot_types";
import { DataSource } from "../types/datasource_types";
import { PrefixLogger } from "../utils";
import zodToJsonSchema from "zod-to-json-schema";
import { COPILOT_INSTRUCTIONS_EDIT_AGENT } from "./copilot_edit_agent";
import { COPILOT_INSTRUCTIONS_MULTI_AGENT } from "./copilot_multi_agent";
import { COPILOT_MULTI_AGENT_EXAMPLE_1 } from "./example_multi_agent_1";
import { CURRENT_WORKFLOW_PROMPT } from "./current_workflow";
import { Composio } from '@composio/core';

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

async function getDynamicToolsPrompt(userQuery: string, workflow: z.infer<typeof Workflow>): Promise<{ prompt: string; updatedWorkflow: z.infer<typeof Workflow> }> {
    console.log('--- [Co-pilot] Entering Dynamic Tool Creation ---');
    if (process.env.ENABLE_DYNAMIC_TOOL_CONTEXT !== 'true' || !process.env.COMPOSIO_API_KEY) {
        console.log('[Co-pilot] Dynamic tool creation is disabled or COMPOSIO_API_KEY is missing.');
        return { prompt: '', updatedWorkflow: workflow };
    }

    try {
        const composio = new Composio();
        
        // Step 1: Search for relevant tool slugs
        console.log('[Co-pilot] 🚀 Searching for relevant tools...');
        const searchResult = await composio.tools.execute('COMPOSIO_SEARCH_TOOLS', {
            userId: '0000-0000-0000', // hmmmmm
            arguments: { use_case: userQuery },
        });

        if (!searchResult.successful || !Array.isArray(searchResult.data?.results)) {
            console.warn('[Co-pilot] ⚠️ Tool search was not successful or returned no results.');
            return { prompt: '', updatedWorkflow: workflow };
        }
        
        const toolSlugs = searchResult.data.results.map((result: any) => result.tool);
        console.log(`[Co-pilot] ✅ Found tool slugs: ${toolSlugs.join(', ')}`);
        
        let dynamicTools = [];
        let toolDescriptions = [];

        for (const slug of toolSlugs) {
            try {
                // Step 2: Retrieve full details for each tool slug
                console.log(`[Co-pilot] 📥 Retrieving details for tool: ${slug}`);
                const response = await fetch(`https://backend.composio.dev/api/v3/tools/${slug}`, {
                    headers: {
                        'x-api-key': process.env.COMPOSIO_API_KEY!,
                        'Content-Type': 'application/json',
                    },
                });
                
                if (!response.ok) {
                    throw new Error(`Failed to fetch tool ${slug}: ${response.status}`);
                }
                
                const toolDetails = await response.json();

                // Step 3: Map tool details to the WorkflowTool schema (same as workflow editor)
                const inputParameters = toolDetails.input_parameters || {};
                const requiredParams = Object.entries(inputParameters)
                    .filter(([_, param]: [string, any]) => param.required)
                    .map(([key, _]) => key);

                const newToolConfig = {
                    name: toolDetails.slug,
                    description: toolDetails.description,
                    parameters: {
                        type: 'object' as const,
                        properties: inputParameters,
                        required: requiredParams,
                    },
                    isComposio: true,
                    composioData: {
                        slug: toolDetails.slug,
                        noAuth: toolDetails.no_auth,
                        toolkitName: toolDetails.toolkit.name,
                        toolkitSlug: toolDetails.toolkit.slug,
                        logo: toolDetails.toolkit.logo,
                    },
                };

                // Add to dynamic tools array (same logic as workflow editor reducer)
                dynamicTools.push(newToolConfig);
                toolDescriptions.push(`**${newToolConfig.name}**: ${newToolConfig.description}`);
                console.log(`[Co-pilot] ✅ Successfully prepared tool config for ${slug}.`);

            } catch (error) {
                console.error(`[Co-pilot] ❌ Failed to retrieve or process tool ${slug}:`, error);
            }
        }
        
        if (dynamicTools.length > 0) {
            // Create updated workflow with new tools (same as workflow editor reducer)
            const updatedWorkflow = {
                ...workflow,
                tools: [...workflow.tools, ...dynamicTools]
            };
            
            console.log('--- [Co-pilot] Exiting Dynamic Tool Creation (Success) ---');
            return {
                prompt: `**DYNAMIC COMPOSIO TOOLS AVAILABLE**:
The following Composio tools have been dynamically discovered and are now available for use in your workflow:

${toolDescriptions.join('\n\n')}

These tools are ready to be used by your agents. You can reference them in your workflow configuration.`,
                updatedWorkflow
            };
        }

    } catch (error) {
        console.error('[Co-pilot] ❌ An exception occurred during the tool creation process:', error);
    }
    
    console.log('--- [Co-pilot] Exiting Dynamic Tool Creation (Failure) ---');
    return { prompt: '', updatedWorkflow: workflow };
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
        lastMessage.content = `${dynamicToolsPrompt}\n\n${currentWorkflowPrompt}\n\n${contextPrompt}\n\n${dataSourcesPrompt}\n\nUser: ${JSON.stringify(lastMessage.content)}`;
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

    let contextPrompt = getContextPrompt(context);
    let dynamicToolsPrompt = '';
    let updatedWorkflow = workflow;
    const lastUserMessage = messages.filter(msg => msg.role === 'user').pop();
    
    if (lastUserMessage && typeof lastUserMessage.content === 'string') {
        const dynamicResult = await getDynamicToolsPrompt(lastUserMessage.content, workflow);
        dynamicToolsPrompt = dynamicResult.prompt;
        updatedWorkflow = dynamicResult.updatedWorkflow;
    }

    // Use the updated workflow that includes dynamic tools
    const currentWorkflowPrompt = getCurrentWorkflowPrompt(updatedWorkflow);
    updateLastUserMessage(messages, currentWorkflowPrompt, contextPrompt, '', dynamicToolsPrompt);

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

    let contextPrompt = getContextPrompt(context);
    let dataSourcesPrompt = getDataSourcesPrompt(dataSources);
    let dynamicToolsPrompt = '';
    let updatedWorkflow = workflow;
    const lastUserMessage = messages.filter(msg => msg.role === 'user').pop();

    if (lastUserMessage && typeof lastUserMessage.content === 'string') {
        const dynamicResult = await getDynamicToolsPrompt(lastUserMessage.content, workflow);
        dynamicToolsPrompt = dynamicResult.prompt;
        updatedWorkflow = dynamicResult.updatedWorkflow;
    }

    // Use the updated workflow that includes dynamic tools
    const currentWorkflowPrompt = getCurrentWorkflowPrompt(updatedWorkflow);
    updateLastUserMessage(messages, currentWorkflowPrompt, contextPrompt, dataSourcesPrompt, dynamicToolsPrompt);

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

    for await (const chunk of textStream) {
        yield {
            content: chunk,
        };
    }

    yield {
        done: true,
    };
}