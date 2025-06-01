"use server";
import { z } from "zod";
import { WorkflowTool } from "../lib/types/workflow_types";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { projectAuthCheck } from "./project_actions";
import { projectsCollection } from "../lib/mongodb";
import { Project } from "../lib/types/project_types";
import { MCPServer } from "../lib/types/types";

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

export async function listMcpServers(projectId: string): Promise<z.infer<typeof MCPServer>[]> {
    await projectAuthCheck(projectId);
    const project = await projectsCollection.findOne({
        _id: projectId,
    });
    return project?.mcpServers ?? [];
}

/**
 * Create an MCP server instance using the Klavis AI API
 * @param serverName Name of the server, e.g. 'Github'
 * @param userId Unique user ID
 * @param platformName Platform name, set to 'Rowboat'
 * @returns Response containing serverUrl and instanceId
 */
export async function createMcpServerInstance(
  serverName: string,
  userId: string,
  platformName: string,
): Promise<{ serverUrl: string; instanceId: string }> {
  try {
    const response = await fetch('https://api.klavis.ai/mcp-server/instance/create', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.KLAVIS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        serverName,
        userId,
        platformName,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create MCP server instance: ${response.status} ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error creating MCP server instance:', error);
    throw error;
  }
}