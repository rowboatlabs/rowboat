'use server';

import { projectsCollection } from '../lib/mongodb';
import { MCPServer } from '../lib/types/types';
import { z } from 'zod';
import { projectAuthCheck } from './project_actions';

type McpServerType = z.infer<typeof MCPServer>;

function formatServerUrl(url: string): string {
  // Ensure URL starts with http:// or https://
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'http://' + url;
  }
  // Remove trailing slash if present
  return url.replace(/\/$/, '');
}

export async function fetchCustomServers(projectId: string) {
  await projectAuthCheck(projectId);

  const project = await projectsCollection.findOne({ _id: projectId });
  return (project?.mcpServers || [])
    .filter(server => server.serverType === 'custom')
    .map(server => ({
      ...server,
      serverType: 'custom' as const,
      isReady: true // Custom servers are always ready
    }));
}

export async function addCustomServer(projectId: string, server: McpServerType) {
  await projectAuthCheck(projectId);

  // Format the server URL and ensure isReady is true for custom servers
  const formattedServer = {
    ...server,
    serverUrl: formatServerUrl(server.serverUrl || ''),
    isReady: true // Custom servers are always ready
  };

  await projectsCollection.updateOne(
    { _id: projectId },
    { $push: { mcpServers: formattedServer } }
  );

  return formattedServer;
}

export async function removeCustomServer(projectId: string, serverName: string) {
  await projectAuthCheck(projectId);

  await projectsCollection.updateOne(
    { _id: projectId },
    { $pull: { mcpServers: { name: serverName } } }
  );
}

export async function toggleCustomServer(projectId: string, serverName: string, isActive: boolean) {
  await projectAuthCheck(projectId);

  await projectsCollection.updateOne(
    { _id: projectId, "mcpServers.name": serverName },
    { 
      $set: { 
        "mcpServers.$.isActive": isActive,
        "mcpServers.$.isReady": isActive // Update isReady along with isActive
      } 
    }
  );
}

export async function updateCustomServerTools(
  projectId: string, 
  serverName: string, 
  tools: McpServerType['tools'],
  availableTools?: McpServerType['availableTools']
) {
  await projectAuthCheck(projectId);

  const update: Record<string, any> = {
    "mcpServers.$.tools": tools
  };
  
  if (availableTools) {
    update["mcpServers.$.availableTools"] = availableTools;
  }

  await projectsCollection.updateOne(
    { _id: projectId, "mcpServers.name": serverName },
    { $set: update }
  );
} 