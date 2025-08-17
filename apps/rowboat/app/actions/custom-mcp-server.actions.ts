'use server';

import { projectsCollection } from '../lib/mongodb';
import { z } from 'zod';
import { projectAuthCheck } from './project.actions';
import { CustomMcpServer } from "@/src/entities/models/project";
import { getMcpClient } from '../lib/mcp';
import { WorkflowTool } from '../lib/types/workflow_types';
import { authCheck } from './auth.actions';

type McpServerType = z.infer<typeof CustomMcpServer>;

function validateUrl(url: string): string {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('Invalid protocol');
    }
    return parsedUrl.toString();
  } catch (error) {
    throw new Error('Invalid URL');
  }
}

export async function addServer(projectId: string, name: string, server: McpServerType): Promise<void> {
  await projectAuthCheck(projectId);

  // Validate the server URL
  validateUrl(server.serverUrl);

  // Update the customMcpServers record with the server
  await projectsCollection.updateOne(
    { _id: projectId },
    { $set: { [`customMcpServers.${name}`]: server } }
  );
}

export async function removeServer(projectId: string, name: string): Promise<void> {
  await projectAuthCheck(projectId);

  await projectsCollection.updateOne(
    { _id: projectId },
    { $unset: { [`customMcpServers.${name}`]: "" } }
  );
}

export async function fetchTools(serverUrl: string, serverName: string): Promise<z.infer<typeof WorkflowTool>[]> {
    await authCheck();

    const client = await getMcpClient(serverUrl, serverName);
    const result = await client.listTools();
    return result.tools.map(tool => {
        return {
            name: tool.name,
            description: tool.description || '',
            parameters: {
                type: 'object',
                properties: tool.inputSchema?.properties || {},
                required: tool.inputSchema?.required || [],
                additionalProperties: true,
            },
            isMcp: true,
            mcpServerName: serverName,
            mcpServerURL: serverUrl,
        };
    });
}
