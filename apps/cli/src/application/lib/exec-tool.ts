import { tool, Tool } from "ai";
import { AgentTool } from "../entities/agent.js";
import { z } from "zod";
import { McpServers } from "../config/config.js";
import { getMcpClient } from "./mcp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Client } from "@modelcontextprotocol/sdk/client";
import { executeCommand } from "./command-executor.js";
import { loadWorkflow } from "./utils.js";
import { AssistantMessage } from "../entities/message.js";
import { executeWorkflow } from "./exec-workflow.js";
import readline from "readline";

async function execMcpTool(agentTool: z.infer<typeof AgentTool> & { type: "mcp" }, input: any): Promise<any> {
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

async function execBashTool(agentTool: z.infer<typeof AgentTool>, input: any): Promise<any> {
    const result = await executeCommand(input.command as string);
    return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
    };
}

export async function execAskHumanTool(agentTool: z.infer<typeof AgentTool>, question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    let p = new Promise<string>((resolve, reject) => {
        rl.question(`>> Provide answer to: ${question}:\n\n`, (answer) => {
            resolve(answer);
            rl.close();
        });
    });
    const answer = await p;
    return answer;
}

async function execWorkflowTool(agentTool: z.infer<typeof AgentTool> & { type: "workflow" }, input: any): Promise<any> {
    let lastMsg: z.infer<typeof AssistantMessage> | null = null;
    for await (const event of executeWorkflow(agentTool.name, input.message)) {
        if (event.type === "message" && event.message.role === "assistant") {
            lastMsg = event.message;
        }
        if (event.type === "error") {
            throw new Error(event.error);
        }
    }

    if (!lastMsg) {
        throw new Error("No message received from workflow");
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

export async function execTool(agentTool: z.infer<typeof AgentTool>, input: any): Promise<any> {
    switch (agentTool.type) {
        case "mcp":
            return execMcpTool(agentTool, input);
        case "workflow":
            return execWorkflowTool(agentTool, input);
        case "builtin":
            switch (agentTool.name) {
                case "bash":
                    return execBashTool(agentTool, input);
                default:
                    throw new Error(`Unknown builtin tool: ${agentTool.name}`);
            }
    }
}