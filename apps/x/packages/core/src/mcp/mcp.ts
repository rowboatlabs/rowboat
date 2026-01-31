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
    McpServerList,
} from "@x/shared/dist/mcp.js";

type mcpState = {
    state: z.infer<typeof connectionState>,
    client: Client | null,
    error: string | null,
};
const clients: Record<string, mcpState> = {};

async function getClient(serverName: string): Promise<Client> {
    if (clients[serverName] && clients[serverName].state === "connected") {
        return clients[serverName].client!;
    }
    const repo = container.resolve<IMcpConfigRepo>('mcpConfigRepo');
    const { mcpServers } = await repo.getConfig();
    const config = mcpServers[serverName];
    if (!config) {
        throw new Error(`MCP server ${serverName} not found`);
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
            try {
                transport = new StreamableHTTPClientTransport(new URL(config.url));
            } catch {
                // if that fails, try sse transport
                transport = new SSEClientTransport(new URL(config.url));
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
    const repo = container.resolve<IMcpConfigRepo>('mcpConfigRepo');
    const { mcpServers } = await repo.getConfig();
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
