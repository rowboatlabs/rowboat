import { ToolAttachment } from "../entities/agent.js";
import { z } from "zod";
import { McpServers } from "../config/config.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Client } from "@modelcontextprotocol/sdk/client";
import { AssistantMessage } from "../entities/message.js";
import { BuiltinTools } from "./builtin-tools.js";
import { streamAgent } from "../../app.js";

async function execMcpTool(agentTool: z.infer<typeof ToolAttachment> & { type: "mcp" }, input: any): Promise<any> {
    // load mcp configuration from the tool
    const mcpConfig = McpServers[agentTool.mcpServerName];
    if (!mcpConfig) {
        throw new Error(`MCP server ${agentTool.mcpServerName} not found`);
    }

    // create transport
    let transport: Transport;
    if ("command" in mcpConfig) {
        transport = new StdioClientTransport({
            command: mcpConfig.command,
            args: mcpConfig.args,
            env: mcpConfig.env,
        });
    } else {
        // first try streamable http transport
        try {
            transport = new StreamableHTTPClientTransport(new URL(mcpConfig.url));
        } catch (error) {
            // if that fails, try sse transport
            transport = new SSEClientTransport(new URL(mcpConfig.url));
        }
    }

    if (!transport) {
        throw new Error(`No transport found for ${agentTool.mcpServerName}`);
    }

    // create client
    const client = new Client({
        name: 'rowboatx',
        version: '1.0.0',
    });
    await client.connect(transport);

    // call tool
    const result = await client.callTool({ name: agentTool.name, arguments: input });
    client.close();
    transport.close();
    return result;
}

async function execAgentTool(agentTool: z.infer<typeof ToolAttachment> & { type: "agent" }, input: any): Promise<any> {
    let lastMsg: z.infer<typeof AssistantMessage> | null = null;
    for await (const event of streamAgent({
        agent: agentTool.name,
        input: JSON.stringify(input),
    })) {
        if (event.type === "message" && event.message.role === "assistant") {
            lastMsg = event.message;
        }
        if (event.type === "error") {
            throw new Error(event.error);
        }
    }

    if (!lastMsg) {
        throw new Error("No message received from agent");
    }
    if (typeof lastMsg.content === "string") {
        return lastMsg.content;
    }
    return lastMsg.content.reduce((acc, part) => {
        if (part.type === "text") {
            acc += part.text;
        }
        return acc;
    }, "");
}

export async function execTool(agentTool: z.infer<typeof ToolAttachment>, input: any): Promise<any> {
    switch (agentTool.type) {
        case "mcp":
            return execMcpTool(agentTool, input);
        case "agent":
            return execAgentTool(agentTool, input);
        case "builtin":
            const builtinTool = BuiltinTools[agentTool.name];
            if (!builtinTool || !builtinTool.execute) {
                throw new Error(`Unsupported builtin tool: ${agentTool.name}`);
            }
            return builtinTool.execute(input);
    }
}