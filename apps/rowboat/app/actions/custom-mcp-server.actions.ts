'use server';

import { z } from 'zod';
import { CustomMcpServer } from "@/src/entities/models/project";
import { getMcpClient } from '../lib/mcp';
import { WorkflowTool } from '../lib/types/workflow_types';
import { authCheck } from './auth.actions';
import { container } from '@/di/container';
import { IAddCustomMcpServerController } from '@/src/interface-adapters/controllers/projects/add-custom-mcp-server.controller';
import { IRemoveCustomMcpServerController } from '@/src/interface-adapters/controllers/projects/remove-custom-mcp-server.controller';

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

const addCustomMcpServerController = container.resolve<IAddCustomMcpServerController>('addCustomMcpServerController');
const removeCustomMcpServerController = container.resolve<IRemoveCustomMcpServerController>('removeCustomMcpServerController');

export async function addServer(projectId: string, name: string, server: McpServerType): Promise<void> {
  const user = await authCheck();
  // validate early for UX; use-case will validate again
  validateUrl(server.serverUrl);
  await addCustomMcpServerController.execute({
    caller: 'user',
    userId: user._id,
    projectId,
    name,
    server,
  });
}

export async function removeServer(projectId: string, name: string): Promise<void> {
  const user = await authCheck();
  await removeCustomMcpServerController.execute({
    caller: 'user',
    userId: user._id,
    projectId,
    name,
  });
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
