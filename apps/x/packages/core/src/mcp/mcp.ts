import container from "../di/container.js";
import { Client } from "@modelcontextprotocol/sdk/client";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import z from "zod";
import { IMcpConfigRepo } from "./repo.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
    connectionState,
    ListToolsResponse,
    McpServerConfig,
    McpServerList,
} from "@x/shared/dist/mcp.js";
import { spacesMcpServers } from "../spaces/orgs.js";

type mcpState = {
    state: z.infer<typeof connectionState>,
    client: Client | null,
    error: string | null,
    /** Config snapshot the client connected with — a change forces a reconnect. */
    configKey?: string,
};
const clients: Record<string, mcpState> = {};

/**
 * The server list every consumer sees: mcp.json entries merged with entries
 * DERIVED from the spaces org registry (spaces_orgs.json) at read time. The
 * registry is the single source of truth for orgs — nothing spaces-related is
 * ever written to mcp.json, so the two can't drift. Derived entries win on a
 * name collision: a stale file entry must never shadow the live registry
 * (an old token would silently act as the wrong member).
 */
async function effectiveServers(): Promise<z.infer<typeof McpServerConfig>["mcpServers"]> {
    const repo = container.resolve<IMcpConfigRepo>('mcpConfigRepo');
    const { mcpServers } = await repo.getConfig();
    return { ...mcpServers, ...spacesMcpServers() };
}

async function getClient(serverName: string): Promise<Client> {
    const mcpServers = await effectiveServers();
    const config = mcpServers[serverName];
    if (!config) {
        throw new Error(`MCP server ${serverName} not found`);
    }
    const configKey = JSON.stringify(config);
    const cached = clients[serverName];
    if (cached && cached.state === "connected" && cached.configKey === configKey) {
        return cached.client!;
    }
    if (cached?.client) {
        // Config changed since this client connected (token rotated, org
        // re-added, mcp.json edited) — drop it and reconnect fresh.
        try {
            await cached.client.close();
        } catch {
            // stale client; ignore
        }
        delete clients[serverName];
    }
    let transport: Transport | undefined = undefined;
    try {
        // create transport
        if ("command" in config) {
            transport = new StdioClientTransport({
                command: config.command,
                args: config.args,
                env: config.env,
            });
        } else {
            // Forward any configured headers (e.g. Authorization) so
            // auth-protected remote MCP servers can be reached.
            const requestInit = config.headers
                ? { headers: config.headers }
                : undefined;
            try {
                transport = new StreamableHTTPClientTransport(new URL(config.url), {
                    requestInit,
                });
            } catch {
                // if that fails, try sse transport
                transport = new SSEClientTransport(new URL(config.url), {
                    requestInit,
                });
            }
        }

        if (!transport) {
            throw new Error(`No transport found for ${serverName}`);
        }

        // create client
        const client = new Client({
            name: 'rowboatx',
            version: '1.0.0',
        });
        await client.connect(transport);

        // store
        clients[serverName] = {
            state: "connected",
            client,
            error: null,
            configKey,
        };
        return client;
    } catch (error) {
        clients[serverName] = {
            state: "error",
            client: null,
            error: error instanceof Error ? error.message : "Unknown error",
        };
        transport?.close();
        throw error;
    }
}

export async function cleanup() {
    for (const [serverName, { client }] of Object.entries(clients)) {
        await client?.transport?.close();
        await client?.close();
        delete clients[serverName];
    }
}

/**
 * Force-close all MCP client connections.
 * Used during force abort to immediately reject any pending MCP tool calls.
 * Clients will be lazily reconnected on next use.
 */
export async function forceCloseAllMcpClients(): Promise<void> {
    for (const [serverName, { client }] of Object.entries(clients)) {
        try {
            await client?.close();
        } catch {
            // Ignore errors during force close
        }
        delete clients[serverName];
    }
}

export async function listServers(): Promise<z.infer<typeof McpServerList>> {
    const mcpServers = await effectiveServers();
    const result: z.infer<typeof McpServerList> = {
        mcpServers: {},
    };
    for (const [serverName, config] of Object.entries(mcpServers)) {
        const state = clients[serverName];
        result.mcpServers[serverName] = {
            config,
            state: state ? state.state : "disconnected",
            error: state ? state.error : null,
        };
    }
    return result;
}

export async function listTools(serverName: string, cursor?: string): Promise<z.infer<typeof ListToolsResponse>> {
    const client = await getClient(serverName);
    const { tools, nextCursor } = await client.listTools({
        cursor,
    });
    return {
        tools,
        nextCursor,
    }
}

export async function executeTool(serverName: string, toolName: string, input: Record<string, unknown>): Promise<unknown> {
    const client = await getClient(serverName);
    const result = await client.callTool({
        name: toolName,
        arguments: input,
    });
    return result;
}
