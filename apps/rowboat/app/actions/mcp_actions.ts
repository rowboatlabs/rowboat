"use server";
import { z } from "zod";
import { WorkflowTool } from "../lib/types/workflow_types";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { projectAuthCheck } from "./project_actions";
import { callMcpTool } from "../lib/utils";
import { projectsCollection } from "../lib/mongodb";
import { Project } from "../lib/types/project_types";

export async function fetchMcpTools(projectId: string): Promise<z.infer<typeof WorkflowTool>[]> {
    await projectAuthCheck(projectId);

    const project = await projectsCollection.findOne({
        _id: projectId,
    });

    const mcpServers = project?.mcpServers ?? [];

    const tools: z.infer<typeof WorkflowTool>[] = [];

    for (const mcpServer of mcpServers) {
        try {
            const transport = new SSEClientTransport(new URL(mcpServer.url));

            const client = new Client(
                {
                    name: "rowboat-client",
                    version: "1.0.0"
                },
                {
                    capabilities: {
                        prompts: {},
                        resources: {},
                        tools: {}
                    }
                }
            );

            await client.connect(transport);

            // List tools
            const result = await client.listTools();

            await client.close();

            tools.push(...result.tools.map((mcpTool) => {
                let props = mcpTool.inputSchema.properties as Record<string, { description: string; type: string }>;
                const tool: z.infer<typeof WorkflowTool> = {
                    name: mcpTool.name,
                    description: mcpTool.description ?? "",
                    parameters: {
                        type: "object",
                        properties: props ?? {},
                        required: mcpTool.inputSchema.required as string[] ?? [],
                    },
                    isMcp: true,
                    mcpServerName: mcpServer.name,
                }
                return tool;
            }));
        } catch (e) {
            console.error(`Error fetching MCP tools from ${mcpServer.name}: ${e}`);
        }
    }

    return tools;
}

export async function updateMcpServers(projectId: string, mcpServers: z.infer<typeof Project>['mcpServers']): Promise<void> {
    await projectAuthCheck(projectId);
    await projectsCollection.updateOne({
        _id: projectId,
    }, { $set: { mcpServers } });
}

export async function executeMcpTool(projectId: string, mcpServerName: string, toolName: string, parameters: Record<string, unknown>): Promise<unknown> {
    await projectAuthCheck(projectId);

    const result = await callMcpTool(projectId, mcpServerName, toolName, parameters);
    return result;
}