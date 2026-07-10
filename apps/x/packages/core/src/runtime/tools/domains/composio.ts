// Builtin tools: composio domain. Entries moved VERBATIM from the historical
// monolith — the merge order in ../builtin-tools.ts preserves the original
// catalog key order (provider-payload bytes; see the key-order test there).

import { z } from "zod";
import { composioAccountsRepo } from "../../../composio/repo.js";
import { executeAction as executeComposioAction, isConfigured as isComposioConfigured, searchTools as searchComposioTools } from "../../../composio/client.js";
import { CURATED_TOOLKITS, CURATED_TOOLKIT_SLUGS } from "@x/shared/dist/composio.js";
import { BuiltinToolsSchema } from "../types.js";


export const composioTools: z.infer<typeof BuiltinToolsSchema> = {
    'composio-list-toolkits': {
        permission: "none",
        description: 'List available Composio integrations (Gmail, Slack, GitHub, etc.) and their connection status. Use this to show the user what services they can connect to.',
        inputSchema: z.object({
            category: z.enum(['all', 'communication', 'productivity', 'development', 'crm', 'social', 'storage', 'support', 'design', 'marketing', 'finance']).optional()
                .describe('Filter by category. Defaults to "all".'),
        }),
        execute: async ({ category }: { category?: string }) => {
            const toolkits = CURATED_TOOLKITS
                .filter(t => !category || category === 'all' || t.category === category)
                .map(t => ({
                    slug: t.slug,
                    name: t.displayName,
                    category: t.category,
                    isConnected: composioAccountsRepo.isConnected(t.slug),
                }));

            const connectedCount = toolkits.filter(t => t.isConnected).length;
            return {
                toolkits,
                connectedCount,
                totalCount: toolkits.length,
            };
        },
        isAvailable: async () => isComposioConfigured(),
    },

    'composio-search-tools': {
        permission: "none",
        description: 'Search for Composio tools by use case across connected services. Returns tool slugs, descriptions, and input schemas so you can call composio-execute-tool with the right parameters. Example: search "send email" to find Gmail tools, "create issue" to find GitHub/Jira tools.',
        inputSchema: z.object({
            query: z.string().describe('Natural language description of what you want to do (e.g., "send an email", "create a GitHub issue", "schedule a meeting")'),
            toolkitSlug: z.string().optional().describe('Optional: limit search to a specific toolkit (e.g., "gmail", "github")'),
        }),
        execute: async ({ query, toolkitSlug }: { query: string; toolkitSlug?: string }) => {
            try {
                const toolkitFilter = toolkitSlug ? [toolkitSlug] : undefined;
                const result = await searchComposioTools(query, toolkitFilter);

                // Filter to curated toolkits only (skip if a specific toolkit was requested —
                // the API already filtered server-side)
                const filtered = toolkitSlug
                    ? result.items
                    : result.items.filter(t => CURATED_TOOLKIT_SLUGS.has(t.toolkitSlug));

                // Annotate with connection status
                const tools = filtered.map(t => ({
                    slug: t.slug,
                    name: t.name,
                    description: t.description,
                    toolkitSlug: t.toolkitSlug,
                    isConnected: composioAccountsRepo.isConnected(t.toolkitSlug),
                    inputSchema: t.inputParameters,
                }));

                return {
                    tools,
                    resultCount: tools.length,
                    hint: tools.some(t => !t.isConnected)
                        ? 'Some tools require connecting the toolkit first. Use composio-connect-toolkit to help the user authenticate.'
                        : undefined,
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return { tools: [], resultCount: 0, error: message };
            }
        },
        isAvailable: async () => isComposioConfigured(),
    },

    'composio-execute-tool': {
        permission: "composio-execute",
        description: 'Execute a Composio tool by its slug. You MUST pass the arguments field with all required parameters from the search results inputSchema. Example: composio-execute-tool({ toolSlug: "GITHUB_ISSUES_LIST_FOR_REPO", toolkitSlug: "github", arguments: { owner: "rowboatlabs", repo: "rowboat", state: "open", per_page: 100 } })',
        inputSchema: z.object({
            toolSlug: z.string().describe('EXACT tool slug from search results (e.g., "GITHUB_ISSUES_LIST_FOR_REPO"). Copy it exactly — do not modify it.'),
            toolkitSlug: z.string().describe('The toolkit slug (e.g., "gmail", "github")'),
            arguments: z.record(z.string(), z.unknown()).describe('REQUIRED: Tool input parameters as key-value pairs. Get the required fields from the inputSchema returned by composio-search-tools. Never omit this.'),
        }),
        execute: async ({ toolSlug, toolkitSlug, arguments: args }: { toolSlug: string; toolkitSlug: string; arguments?: Record<string, unknown> }) => {
            // Default arguments to {} if the LLM omits the field entirely
            const toolArgs = args ?? {};

            // Check connection
            const account = composioAccountsRepo.getAccount(toolkitSlug);
            if (!account || account.status !== 'ACTIVE') {
                return {
                    successful: false,
                    data: null,
                    error: `Toolkit "${toolkitSlug}" is not connected. Use composio-connect-toolkit to help the user connect it first.`,
                };
            }

            try {
                return await executeComposioAction(toolSlug, {
                    connected_account_id: account.id,
                    user_id: 'rowboat-user',
                    version: 'latest',
                    arguments: toolArgs,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`[Composio] Tool execution failed for ${toolSlug}:`, message);
                return {
                    successful: false,
                    data: null,
                    error: `Failed to execute ${toolSlug}: ${message}. If fields are missing, check the inputSchema and retry with the correct arguments.`,
                };
            }
        },
        isAvailable: async () => isComposioConfigured(),
    },

    'composio-connect-toolkit': {
        permission: "none",
        description: 'Connect a Composio service (Gmail, Slack, GitHub, etc.) via OAuth. Shows a connect card for the user to authenticate.',
        inputSchema: z.object({
            toolkitSlug: z.string().describe('The toolkit slug to connect (e.g., "gmail", "github", "slack", "notion")'),
        }),
        execute: async ({ toolkitSlug }: { toolkitSlug: string }) => {
            // Validate against curated list
            if (!CURATED_TOOLKIT_SLUGS.has(toolkitSlug)) {
                const available = CURATED_TOOLKITS.map(t => `${t.slug} (${t.displayName})`).join(', ');
                return {
                    success: false,
                    error: `Unknown toolkit "${toolkitSlug}". Available toolkits: ${available}`,
                };
            }

            // Check if already connected
            if (composioAccountsRepo.isConnected(toolkitSlug)) {
                return {
                    success: true,
                    message: `${toolkitSlug} is already connected. You can search for and execute its tools.`,
                    alreadyConnected: true,
                };
            }

            // Return signal — the UI renders a ComposioConnectCard with a Connect button.
            // OAuth only starts when the user clicks that button.
            const toolkit = CURATED_TOOLKITS.find(t => t.slug === toolkitSlug);
            return {
                success: true,
                message: `Please connect ${toolkit?.displayName ?? toolkitSlug} to continue.`,
            };
        },
        isAvailable: async () => isComposioConfigured(),
    },
};
