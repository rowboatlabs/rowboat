import z from "zod";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, streamText, tool } from "ai";
import { Workflow, WorkflowTool } from "@/app/lib/types/workflow_types";
import { CopilotChatContext, CopilotMessage, DataSourceSchemaForCopilot, TriggerSchemaForCopilot } from "../../../entities/models/copilot";
import { PrefixLogger } from "@/app/lib/utils";
import zodToJsonSchema from "zod-to-json-schema";
import { COPILOT_INSTRUCTIONS_EDIT_AGENT } from "./copilot_edit_agent";
import { COPILOT_INSTRUCTIONS_MULTI_AGENT_WITH_DOCS as COPILOT_INSTRUCTIONS_MULTI_AGENT } from "./copilot_multi_agent";
import { COPILOT_MULTI_AGENT_EXAMPLE_1 } from "./example_multi_agent_1";
import { CURRENT_WORKFLOW_PROMPT } from "./current_workflow";
import { USE_COMPOSIO_TOOLS } from "@/app/lib/feature_flags";
import { composio, getTool, listTriggersTypes } from "../composio/composio";
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
    main_tools: z.array(composioToolSearchToolSuggestion).optional(),
    related_tools: z.array(composioToolSearchToolSuggestion).optional(),
    results: z.array(composioToolSearchToolSuggestion).optional(), // Keep for backward compatibility
}).passthrough();

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

function getCurrentTimePrompt(): string {
    return `**CURRENT TIME**: ${new Date().toISOString()}`;
}

function getTriggersPrompt(triggers: z.infer<typeof TriggerSchemaForCopilot>[]): string {
    if (!triggers || triggers.length === 0) {
        return '';
    }

    const simplifiedTriggers = triggers.map(trigger => {
        if (trigger.type === 'one_time') {
            return {
                id: trigger.id,
                type: 'one_time',
                name: trigger.name,
                scheduledTime: trigger.nextRunAt,
                input: trigger.input,
                status: trigger.status,
            };
        } else if (trigger.type === 'recurring') {
            return {
                id: trigger.id,
                type: 'recurring', 
                name: trigger.name,
                cron: trigger.cron,
                nextRunAt: trigger.nextRunAt,
                disabled: trigger.disabled,
                input: trigger.input,
            };
        } else {
            return {
                id: trigger.id,
                type: 'external',
                name: trigger.triggerTypeName,
                toolkit: trigger.toolkitSlug,
                triggerType: trigger.triggerTypeSlug,
                config: trigger.triggerConfig,
            };
        }
    });

    return `**NOTE**:
The following triggers are currently configured:
\`\`\`json
${JSON.stringify(simplifiedTriggers)}
\`\`\`
`;
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
    logger.log(`raw search result data: ${JSON.stringify(searchResult.data)}`);
    const result = composioToolSearchResponseSchema.safeParse(searchResult.data);
    if (!result.success) {
        logger.log(`tool search response is invalid: ${JSON.stringify(result.error)}`);
        logger.log(`expected schema: results (array), got: ${JSON.stringify(Object.keys(searchResult.data || {}))}`);
        return 'No tools found!';
    }
    const tools = result.data.main_tools || result.data.results || [];
    
    if (!tools.length) {
        logger.log(`tool search yielded no results`);
        return 'No tools found!';
    }

    const toolSlugs = tools.map((item) => item.tool_slug);
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

async function searchRelevantTriggers(
    usageTracker: UsageTracker,
    toolkitSlug: string,
    query?: string,
): Promise<string> {
    const logger = new PrefixLogger("copilot-search-triggers");
    const trimmedSlug = toolkitSlug.trim();
    const trimmedQuery = query?.trim() || '';
    console.log("🔧 TOOL CALL: searchRelevantTriggers", { toolkitSlug: trimmedSlug, query: trimmedQuery });

    if (!trimmedSlug) {
        logger.log('no toolkit slug provided');
        return 'Please provide a toolkit slug (for example "gmail" or "slack") when searching for triggers.';
    }

    if (!USE_COMPOSIO_TOOLS) {
        logger.log('dynamic trigger search is disabled');
        console.log("❌ TOOL CALL SKIPPED: searchRelevantTriggers - Composio tools disabled");
        return 'Trigger search is currently unavailable.';
    }

    const MAX_PAGES = 5;
    type TriggerListResponse = Awaited<ReturnType<typeof listTriggersTypes>>;
    type TriggerType = TriggerListResponse['items'][number];

    const triggers: TriggerType[] = [];
    let cursor: string | undefined;

    try {
        for (let page = 0; page < MAX_PAGES; page++) {
            logger.log(`fetching trigger page ${page + 1} for toolkit ${trimmedSlug}`);
            console.log("🔍 TOOL CALL: COMPOSIO_LIST_TRIGGERS", { toolkitSlug: trimmedSlug, cursor });
            const response = await listTriggersTypes(trimmedSlug, cursor);
            triggers.push(...response.items);
            console.log("✅ TOOL CALL SUCCESS: COMPOSIO_LIST_TRIGGERS", {
                toolkitSlug: trimmedSlug,
                fetchedCount: response.items.length,
                totalCollected: triggers.length,
                hasNext: Boolean(response.next_cursor),
            });
            if (!response.next_cursor) {
                break;
            }
            cursor = response.next_cursor || undefined;
        }
    } catch (error: any) {
        logger.log(`trigger search failed: ${error?.message || error}`);
        console.log("❌ TOOL CALL FAILED: COMPOSIO_LIST_TRIGGERS", {
            toolkitSlug: trimmedSlug,
            error: error?.message || error,
        });
        return `Trigger search failed for toolkit "${trimmedSlug}".`;
    }

    usageTracker.track({
        type: "COMPOSIO_TOOL_USAGE",
        toolSlug: `COMPOSIO_LIST_TRIGGER_TYPES:${trimmedSlug}`,
        context: "copilot.search_relevant_triggers",
    });

    if (!triggers.length) {
        logger.log('no triggers found for toolkit');
        return `No triggers are currently available for toolkit "${trimmedSlug}".`;
    }

    let filteredTriggers = triggers;
    if (trimmedQuery) {
        const queryLc = trimmedQuery.toLowerCase();
        filteredTriggers = triggers.filter(trigger => {
            const baseText = `${trigger.name} ${trigger.slug} ${trigger.description}`.toLowerCase();
            const propertyNames = Object.keys(trigger.config?.properties || {}).join(' ').toLowerCase();
            return baseText.includes(queryLc) || propertyNames.includes(queryLc);
        });
        logger.log(`filtered triggers to ${filteredTriggers.length} results using query`);
    }

    if (!filteredTriggers.length) {
        return `No triggers found for toolkit "${trimmedSlug}"${trimmedQuery ? ` matching "${trimmedQuery}"` : ''}.`;
    }

    const MAX_RESULTS = 8;
    const limitedTriggers = filteredTriggers.slice(0, MAX_RESULTS);
    const truncated = filteredTriggers.length > limitedTriggers.length;

    const formattedTriggers = limitedTriggers.map(trigger => {
        const requiredFields = trigger.config.required && trigger.config.required.length
            ? trigger.config.required.join(', ')
            : 'None';
        const configJson = JSON.stringify(trigger.config, null, 2);
        return `**${trigger.name}** (slug: ${trigger.slug})\nToolkit: ${trigger.toolkit.name} (${trigger.toolkit.slug})\nDescription: ${trigger.description}\nRequired config fields: ${requiredFields}\n\`\`\`json\n${configJson}\n\`\`\``;
    }).join('\n\n');

    const header = trimmedQuery
        ? `The following triggers match "${trimmedQuery}" in toolkit "${trimmedSlug}":`
        : `Available triggers for toolkit "${trimmedSlug}":`;

    const note = truncated
        ? `\n\nOnly showing the first ${MAX_RESULTS} results out of ${filteredTriggers.length}. Refine your query for more specific results.`
        : '';

    const response = `${header}\n\n${formattedTriggers}${note}`;
    logger.log('returning trigger search response');
    return response;
}

function updateLastUserMessage(
    messages: z.infer<typeof CopilotMessage>[],
    currentWorkflowPrompt: string,
    contextPrompt: string,
    dataSourcesPrompt: string = '',
    timePrompt: string = '',
    triggersPrompt: string = '',
): void {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role === 'user') {
        lastMessage.content = `${currentWorkflowPrompt}\n\n${contextPrompt}\n\n${dataSourcesPrompt}\n\n${timePrompt}\n\n${triggersPrompt}\n\nUser: ${JSON.stringify(lastMessage.content)}`;
    }
}

export async function getEditAgentInstructionsResponse(
    usageTracker: UsageTracker,
    projectId: string,
    context: z.infer<typeof CopilotChatContext> | null,
    messages: z.infer<typeof CopilotMessage>[],
    workflow: z.infer<typeof Workflow>,
    triggers: z.infer<typeof TriggerSchemaForCopilot>[] = [],
): Promise<string> {
    const logger = new PrefixLogger('copilot /getUpdatedAgentInstructions');
    logger.log('context', context);
    logger.log('projectId', projectId);

    // set the current workflow prompt
    const currentWorkflowPrompt = getCurrentWorkflowPrompt(workflow);

    // set context prompt
    let contextPrompt = getContextPrompt(context);

    // set time prompt
    let timePrompt = getCurrentTimePrompt();

    // set triggers prompt
    let triggersPrompt = getTriggersPrompt(triggers);

    // add the above prompts to the last user message
    updateLastUserMessage(messages, currentWorkflowPrompt, contextPrompt, '', timePrompt, triggersPrompt);

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
    dataSources: z.infer<typeof DataSourceSchemaForCopilot>[],
    triggers: z.infer<typeof TriggerSchemaForCopilot>[] = []
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

    // set time prompt
    let timePrompt = getCurrentTimePrompt();

    // set triggers prompt
    let triggersPrompt = getTriggersPrompt(triggers);

    // add the above prompts to the last user message
    updateLastUserMessage(messages, currentWorkflowPrompt, contextPrompt, dataSourcesPrompt, timePrompt, triggersPrompt);

    // call model
    console.log("🤖 AI MODEL CALL STARTED", {
        model: COPILOT_MODEL,
        maxSteps: 20,
        availableTools: ["search_relevant_tools", "search_relevant_triggers"]
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
            "search_relevant_triggers": tool({
                description: "Use this tool to discover external triggers provided by Composio toolkits. Supply the toolkit slug (for example 'gmail', 'slack', or 'salesforce') and optionally keywords from the user's request to narrow down results. Always call this before adding an external trigger to ensure the trigger exists and to understand its configuration schema.",
                parameters: z.object({
                    toolkitSlug: z.string().describe("Slug of the Composio toolkit to search, such as 'gmail', 'slack', 'salesforce', 'googlecalendar'."),
                    query: z.string().min(1).describe("Optional keywords pulled from the user's request to filter trigger names, descriptions, or config fields.").optional(),
                }),
                execute: async ({ toolkitSlug, query }: { toolkitSlug: string; query?: string }) => {
                    console.log("🎯 AI TOOL CALL: search_relevant_triggers", { toolkitSlug, query });
                    const result = await searchRelevantTriggers(usageTracker, toolkitSlug, query);
                    console.log("✅ AI TOOL CALL COMPLETED: search_relevant_triggers", {
                        toolkitSlug,
                        query,
                        resultLength: result.length,
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
