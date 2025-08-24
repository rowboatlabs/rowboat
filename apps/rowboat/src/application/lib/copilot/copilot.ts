import z from "zod";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, streamText, tool } from "ai";
import { Workflow, WorkflowTool } from "@/app/lib/types/workflow_types";
import { CopilotChatContext, CopilotMessage, DataSourceSchemaForCopilot } from "../../../entities/models/copilot";
import { PrefixLogger } from "@/app/lib/utils";
import zodToJsonSchema from "zod-to-json-schema";
import { COPILOT_INSTRUCTIONS_EDIT_AGENT } from "./copilot_edit_agent";
import { COPILOT_INSTRUCTIONS_MULTI_AGENT } from "./copilot_multi_agent";
import { COPILOT_MULTI_AGENT_EXAMPLE_1 } from "./example_multi_agent_1";
import { CURRENT_WORKFLOW_PROMPT } from "./current_workflow";
import { USE_COMPOSIO_TOOLS } from "@/app/lib/feature_flags";
import { composio, getTool } from "../composio/composio";
import { UsageTracker } from "@/app/lib/billing";
import { CopilotStreamEvent } from "@/src/entities/models/copilot";

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
    compatibility: "strict",
});

const composioToolSearchToolSuggestion = z.object({
    toolkit: z.string(),
    tool_slug: z.string(),
    description: z.string(),
});
const composioToolSearchResponseSchema = z.object({
    results: z.array(composioToolSearchToolSuggestion),
    related_tools: z.array(composioToolSearchToolSuggestion),
});

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

function getDataSourcesPrompt(dataSources: z.infer<typeof DataSourceSchemaForCopilot>[]): string {
    let prompt = '';
    if (dataSources.length > 0) {
        const simplifiedDataSources = dataSources.map(ds => ({
            id: ds.id,
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

async function searchRelevantTools(usageTracker: UsageTracker, query: string): Promise<string> {
    const logger = new PrefixLogger("copilot-search-tools");
    console.log("🔧 TOOL CALL: searchRelevantTools", { query });
    
    if (!USE_COMPOSIO_TOOLS) {
        logger.log("dynamic tool search is disabled");
        console.log("❌ TOOL CALL SKIPPED: searchRelevantTools - Composio tools disabled");
        return 'No tools found!';
    }

    // Search for relevant tool slugs
    logger.log('searching for relevant tools...');
    console.log("🔍 TOOL CALL: COMPOSIO_SEARCH_TOOLS", { use_case: query });
    const searchResult = await composio.tools.execute('COMPOSIO_SEARCH_TOOLS', {
        userId: '0000-0000-0000',
        arguments: { use_case: query },
    });

    if (!searchResult.successful) {
        logger.log(`tool search failed: ${searchResult.error}`)
        return 'No tools found!';
    }

    // track composio search tool usage
    usageTracker.track({
        type: "COMPOSIO_TOOL_USAGE",
        toolSlug: "COMPOSIO_SEARCH_TOOLS",
        context: "copilot.search_relevant_tools",
    });

    // parse results
    const result = composioToolSearchResponseSchema.safeParse(searchResult.data);
    if (!result.success) {
        logger.log(`tool search response is invalid: ${result.error}`);
        return 'No tools found!';
    }
    if (!result.data.results.length) {
        logger.log(`tool search yielded no results`);
        return 'No tools found!';
    }

    const toolSlugs = result.data.results.map((item) => item.tool_slug);
    logger.log(`found tool slugs: ${toolSlugs.join(', ')}`);
    console.log("✅ TOOL CALL SUCCESS: COMPOSIO_SEARCH_TOOLS", { 
        toolSlugs, 
        resultCount: toolSlugs.length 
    });

    // Enrich tools with full details
    console.log("🔧 TOOL CALL: getTool (multiple calls)", { toolSlugs });
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

    // Format the response
    const toolConfigs = workflowTools.map(tool => 
        `**${tool.name}**:\n\`\`\`json\n${JSON.stringify(tool, null, 2)}\n\`\`\``
    ).join('\n\n');

    const response = `The following tools were found:\n\n${toolConfigs}`;
    logger.log('returning response', response);
    console.log("✅ TOOL CALL COMPLETED: searchRelevantTools", { 
        toolsFound: workflowTools.length,
        toolNames: workflowTools.map(t => t.name)
    });
    return response;
}

function updateLastUserMessage(
    messages: z.infer<typeof CopilotMessage>[],
    currentWorkflowPrompt: string,
    contextPrompt: string,
    dataSourcesPrompt: string = '',
): void {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role === 'user') {
        lastMessage.content = `${currentWorkflowPrompt}\n\n${contextPrompt}\n\n${dataSourcesPrompt}\n\nUser: ${JSON.stringify(lastMessage.content)}`;
    }
}

export async function getEditAgentInstructionsResponse(
    usageTracker: UsageTracker,
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
    const { object, usage } = await generateObject({
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

    // log usage
    usageTracker.track({
        type: "LLM_USAGE",
        modelName: COPILOT_MODEL,
        inputTokens: usage.promptTokens,
        outputTokens: usage.completionTokens,
        context: "copilot.llm_usage",
    });

    return object.agent_instructions;
}

export async function* streamMultiAgentResponse(
    usageTracker: UsageTracker,
    projectId: string,
    context: z.infer<typeof CopilotChatContext> | null,
    messages: z.infer<typeof CopilotMessage>[],
    workflow: z.infer<typeof Workflow>,
    dataSources: z.infer<typeof DataSourceSchemaForCopilot>[]
): AsyncIterable<z.infer<typeof CopilotStreamEvent>> {
    const logger = new PrefixLogger('copilot /stream');
    logger.log('context', context);
    logger.log('projectId', projectId);

    console.log("🚀 COPILOT STREAM STARTED", { 
        projectId, 
        contextType: context?.type, 
        contextName: context && 'name' in context ? context.name : undefined,
        messageCount: messages.length 
    });

    // set the current workflow prompt
    const currentWorkflowPrompt = getCurrentWorkflowPrompt(workflow);

    // set context prompt
    let contextPrompt = getContextPrompt(context);

    // set data sources prompt
    let dataSourcesPrompt = getDataSourcesPrompt(dataSources);

    // add the above prompts to the last user message
    updateLastUserMessage(messages, currentWorkflowPrompt, contextPrompt, dataSourcesPrompt);

    // call model
    console.log("🤖 AI MODEL CALL STARTED", {
        model: COPILOT_MODEL,
        maxSteps: 20,
        availableTools: ["search_relevant_tools"]
    });
    
    const { fullStream } = streamText({
        model: openai(COPILOT_MODEL),
        maxSteps: 10,
        tools: {
            "search_relevant_tools": tool({
                description: "Use this tool whenever the user wants to add tools to their agents , search for tools or have questions about specific tools. ALWAYS search for real tools before suggesting mock tools. Use this when users mention: email sending, calendar management, file operations, database queries, web scraping, payment processing, social media integration, CRM operations, analytics, notifications, or any external service integration. This tool searches a comprehensive library of real, production-ready tools that can be integrated into workflows.",
                parameters: z.object({
                    query: z.string().describe("Describe the specific functionality or use-case needed. Be specific about the action (e.g., 'send email via Gmail', 'create calendar events', 'upload files to cloud storage', 'process payments via Stripe', 'search web content', 'manage customer data in CRM'). Include the service/platform if mentioned by user."),
                }),
                execute: async ({ query }: { query: string }) => {
                    console.log("🎯 AI TOOL CALL: search_relevant_tools", { query });
                    const result = await searchRelevantTools(usageTracker, query);
                    console.log("✅ AI TOOL CALL COMPLETED: search_relevant_tools", { 
                        query, 
                        resultLength: result.length 
                    });
                    return result;
                },
            }),
        },
        messages: [
            {
                role: 'system',
                content: SYSTEM_PROMPT,
            },
            ...messages,
        ],
    });

    // emit response chunks
    let chunkCount = 0;
    for await (const event of fullStream) {
        chunkCount++;
        if (chunkCount === 1) {
            console.log("📤 FIRST RESPONSE CHUNK SENT");
        }
        
        if (event.type === "text-delta") {
            yield {
                content: event.textDelta,
            };
        } else if (event.type === "tool-call") {
            yield {
                type: 'tool-call',
                toolName: event.toolName,
                toolCallId: event.toolCallId,
                args: event.args,
                query: event.args.query || undefined,
            };
        } else if (event.type === "tool-result") { 
            yield {
                type: 'tool-result',
                toolCallId: event.toolCallId,
                result: event.result,
            };
        } else if (event.type === "step-finish") {
            // log usage
            usageTracker.track({
                type: "LLM_USAGE",
                modelName: COPILOT_MODEL,
                inputTokens: event.usage.promptTokens,
                outputTokens: event.usage.completionTokens,
                context: "copilot.llm_usage",
            });
        }
    }

    console.log("✅ COPILOT STREAM COMPLETED", { 
        projectId, 
        totalChunks: chunkCount 
    });
}