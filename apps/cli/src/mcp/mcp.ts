import container from "../di/container.js";
import { Client } from "@modelcontextprotocol/sdk/client";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import z from "zod";
import { IMcpConfigRepo } from "./repo.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export const StdioMcpServerConfig = z.object({
    type: z.literal("stdio").optional(),
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
});

export const HttpMcpServerConfig = z.object({
    type: z.literal("http").optional(),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
});

export const McpServerDefinition = z.union([StdioMcpServerConfig, HttpMcpServerConfig]);

export const McpServerConfig = z.object({
    mcpServers: z.record(z.string(), McpServerDefinition),
});

const connectionState = z.enum(["disconnected", "connected", "error"]);

export const McpServerList = z.object({
    mcpServers: z.record(z.string(), z.object({
        config: McpServerDefinition,
        state: connectionState,
        error: z.string().nullable(),
    })),
});

/*
            inputSchema: {
                [x: string]: unknown;
                type: "object";
                properties?: Record<string, object> | undefined;
                required?: string[] | undefined;
            };
*/
export const Tool = z.object({
    name: z.string(),
    description: z.string().optional(),
    inputSchema: z.object({
        type: z.literal("object"),
        properties: z.record(z.string(), z.any()).optional(),
        required: z.array(z.string()).optional(),
    }),
    outputSchema: z.object({
        type: z.literal("object"),
        properties: z.record(z.string(), z.any()).optional(),
        required: z.array(z.string()).optional(),
    }).optional(),
})

export const ListToolsResponse = z.object({
    tools: z.array(Tool),
    nextCursor: z.string().optional(),
});

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
            } catch (error) {
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

export async function executeTool(serverName: string, toolName: string, input: any): Promise<unknown> {
    const client = await getClient(serverName);
    const result = await client.callTool({
        name: toolName,
        arguments: input,
    });
    return result;
}