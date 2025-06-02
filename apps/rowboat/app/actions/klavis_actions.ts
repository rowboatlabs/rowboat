'use server';

import { projectAuthCheck } from './project_actions';
import { z } from 'zod';
import { MCPServer, McpTool, McpServerResponse, McpServerTool } from '../lib/types/types';
import { projectsCollection } from '../lib/mongodb';
import { fetchMcpTools, toggleMcpTool } from './mcp_actions';
import { fetchMcpToolsForServer } from './mcp_actions';
import { headers } from 'next/headers';

type McpServerType = z.infer<typeof MCPServer>;
type McpToolType = z.infer<typeof McpTool>;
type McpServerResponseType = z.infer<typeof McpServerResponse>;

// Internal API Response Types
interface KlavisServerMetadata {
  id: string;
  name: string;
  description: string;
  tools: {
    name: string;
    description: string;
  }[];
  authNeeded: boolean;
}

interface GetAllServersResponse {
  servers: KlavisServerMetadata[];
}

interface CreateServerInstanceResponse {
  serverUrl: string;
  instanceId: string;
}

interface DeleteServerInstanceResponse {
  success: boolean;
  message: string;
}

interface UserInstance {
  id: string;
  name: string;
  description: string | null;
  tools: {
    name: string;
    description: string;
    authNeeded: boolean;
    isAuthenticated: boolean;
  }[] | null;
  authNeeded: boolean;
  isAuthenticated: boolean;
}

interface GetUserInstancesResponse {
  instances: UserInstance[];
}

// Add type for raw MCP tool response at the top with other types
interface RawMcpTool {
    name: string;
    description: string;
    inputSchema: string | {
        type: string;
        properties: Record<string, any>;
        required?: string[];
    };
}

const KLAVIS_BASE_URL = 'https://api.klavis.ai';

interface KlavisApiCallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: Record<string, any>;
  additionalHeaders?: Record<string, string>;
}

async function klavisApiCall<T>(
  endpoint: string,
  options: KlavisApiCallOptions = {}
): Promise<T> {
  const { method = 'GET', body, additionalHeaders = {} } = options;
  const startTime = performance.now();
  const url = `${KLAVIS_BASE_URL}${endpoint}`;

  try {
    const headers = {
      'Authorization': `Bearer ${process.env.KLAVIS_API_KEY}`,
      'Content-Type': 'application/json',
      ...additionalHeaders
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {})
    };

    const response = await fetch(url, fetchOptions);
    const endTime = performance.now();
    
    console.log('[Klavis API] Response time:', {
      url,
      method,
      durationMs: Math.round(endTime - startTime)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error);
    }

    return await response.json() as T;
  } catch (error) {
    const endTime = performance.now();
    console.error('[Klavis API] Failed call:', {
      url,
      method,
      durationMs: Math.round(endTime - startTime),
      error
    });
    throw error;
  }
}

// Lists all active server instances for a given project
export async function listActiveServerInstances(projectId: string): Promise<UserInstance[]> {
  try {
    await projectAuthCheck(projectId);

    const queryParams = new URLSearchParams({
      user_id: projectId,
      platform_name: 'Rowboat'
    });

    console.log('[Klavis API] Fetching active instances:', { projectId, platformName: 'Rowboat' });
    
    const endpoint = `/user/instances?${queryParams}`;
    const data = await klavisApiCall<GetUserInstancesResponse>(endpoint);

    // Only show instances that are authenticated or need auth
    const relevantInstances = data.instances.filter(i => i.isAuthenticated || i.authNeeded);
    console.log('[Klavis API] Active instances:', {
      count: relevantInstances.length,
      authenticated: relevantInstances.filter(i => i.isAuthenticated).map(i => i.name).join(', '),
      needsAuth: relevantInstances.filter(i => i.authNeeded && !i.isAuthenticated).map(i => i.name).join(', ')
    });

    return data.instances;
  } catch (error) {
    console.error('[Klavis API] Error listing active instances:', error);
    throw error;
  }
}

async function enrichToolsWithParameters(
    projectId: string,
    serverName: string,
    basicTools: { name: string; description: string }[],
    isNewlyEnabled: boolean = false
): Promise<McpToolType[]> {
    try {
        console.log(`[Klavis API] Starting tool enrichment for ${serverName}`);
        const enrichedTools = await fetchMcpToolsForServer(projectId, serverName);
        
        if (enrichedTools.length === 0) {
            console.log(`[Klavis API] No tools enriched for ${serverName}`);
            return basicTools.map(tool => ({
                id: tool.name,
                name: tool.name,
                description: tool.description,
                parameters: {
                    type: 'object',
                    properties: {},
                    required: []
                }
            }));
        }

        console.log(`[Klavis API] Processing ${enrichedTools.length} tools for ${serverName}`);

        // Create a map of enriched tools for this server
        const enrichedToolMap = new Map(
            enrichedTools.map(tool => [tool.name, {
                name: tool.name,
                description: tool.description,
                parameters: {
                    type: 'object' as const,
                    properties: tool.parameters?.properties || {},
                    required: tool.parameters?.required || []
                }
            }])
        );

        // Find tools that couldn't be enriched
        const unenrichedTools = basicTools
            .filter(tool => !enrichedToolMap.has(tool.name))
            .map(tool => tool.name);

        if (unenrichedTools.length > 0) {
            console.log('[Klavis API] Tools that could not be enriched:', {
                serverName,
                unenrichedTools: unenrichedTools.join(', ')
            });
        }

        // Enrich the basic tools with parameters and descriptions
        const result = basicTools.map(basicTool => {
            const enrichedTool = enrichedToolMap.get(basicTool.name);
            
            const tool: McpToolType = {
                id: basicTool.name,
                name: basicTool.name,
                description: enrichedTool?.description || basicTool.description || '',
                parameters: enrichedTool?.parameters || {
                    type: 'object',
                    properties: {},
                    required: []
                }
            };
            
            return tool;
        });

        console.log('[Klavis API] Tools processed:', {
            serverName,
            toolCount: result.length,
            tools: result.map(t => ({
                name: t.name,
                paramCount: Object.keys(t.parameters?.properties || {}).length,
                hasParams: t.parameters && Object.keys(t.parameters.properties).length > 0
            }))
        });

        return result;
    } catch (error) {
        console.error('[Klavis API] Error enriching tools with parameters:', {
            serverName,
            error: error instanceof Error ? error.message : 'Unknown error',
            basicToolCount: basicTools.length
        });
        // Return basic tools with empty parameters if enrichment fails
        return basicTools.map(tool => ({
            id: tool.name,
            name: tool.name,
            description: tool.description,
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }));
    }
}

// Modify listAvailableMcpServers to use enriched tools
export async function listAvailableMcpServers(projectId: string): Promise<McpServerResponseType> {
    try {
        await projectAuthCheck(projectId);

        console.log('[Klavis API] Starting server list fetch:', { projectId });
        
        // Get MongoDB project data first
        const project = await projectsCollection.findOne({ _id: projectId });
        const mongodbServers = project?.mcpServers || [];
        const mongodbServerMap = new Map(mongodbServers.map(server => [server.name, server]));

        console.log('[Klavis API] Found ', mongodbServers.length, ' MongoDB servers');

        const serversEndpoint = '/mcp-server/servers';
        const rawData = await klavisApiCall<GetAllServersResponse>(serversEndpoint, {
            additionalHeaders: { 'Accept': 'application/json' }
        });

        console.log('[Klavis API] Raw server response:', { 
            serverCount: rawData.servers.length,
            servers: rawData.servers.map(s => s.name).join(', ')
        });
        
        if (!rawData || !rawData.servers || !Array.isArray(rawData.servers)) {
            console.error('[Klavis API] Invalid response format:', rawData);
            return { data: null, error: 'Invalid response format from server' };
        }

        // Get active instances for comparison
        const queryParams = new URLSearchParams({
            user_id: projectId,
            platform_name: 'Rowboat'
        });

        const instancesEndpoint = `/user/instances?${queryParams}`;
        let activeInstances: UserInstance[] = [];
        
        try {
            const instancesData = await klavisApiCall<GetUserInstancesResponse>(instancesEndpoint);
            activeInstances = instancesData.instances;
            console.log('[Klavis API] Active instances:', {
                count: activeInstances.length,
                authenticated: activeInstances.filter(i => i.isAuthenticated).map(i => i.name).join(', '),
                needsAuth: activeInstances.filter(i => i.authNeeded && !i.isAuthenticated).map(i => i.name).join(', ')
            });
        } catch (error) {
            console.error('[Klavis API] Failed to fetch user instances:', error);
        }

        const activeInstanceMap = new Map(activeInstances.map(instance => [instance.name, instance]));

        // Transform and enrich the data
        const transformedServers = [];
        let eligibleCount = 0;
        let serversWithToolsCount = 0;

        for (const server of rawData.servers) {
            const activeInstance = activeInstanceMap.get(server.name);
            const mongodbServer = mongodbServerMap.get(server.name);
            
            // Determine server eligibility
            const isActive = !!activeInstance;
            const authNeeded = activeInstance ? activeInstance.authNeeded : (server.authNeeded || false);
            const isAuthenticated = activeInstance ? activeInstance.isAuthenticated : false;
            const isEligible = isActive && (!authNeeded || isAuthenticated);

            // Get basic tools data first
            const basicTools = (server.tools || []).map(tool => ({
                id: tool.name || '',
                name: tool.name || '',
                description: tool.description || '',
            }));

            let availableTools: McpToolType[];
            let selectedTools: McpToolType[];

            // Only use MongoDB data for eligible servers
            if (isEligible) {
                eligibleCount++;
                console.log('[Klavis API] Processing server:', server.name);

                // Use MongoDB data if available
                availableTools = mongodbServer?.availableTools || basicTools;
                selectedTools = mongodbServer?.tools || [];

                if (selectedTools.length > 0) {
                    serversWithToolsCount++;
                }
            } else {
                // For non-eligible servers, just use basic data
                availableTools = basicTools;
                selectedTools = [];
            }

            transformedServers.push({
                ...server,
                instanceId: activeInstance?.id || server.id,
                serverName: server.name,
                tools: selectedTools,
                availableTools,
                isActive,
                authNeeded,
                isAuthenticated,
                requiresAuth: server.authNeeded || false,
                serverUrl: mongodbServer?.serverUrl
            });
        }

        console.log('[Klavis API] Server processing complete:', {
            totalServers: transformedServers.length,
            eligibleServers: eligibleCount,
            serversWithTools: serversWithToolsCount
        });

        return { data: transformedServers, error: null };
    } catch (error: any) {
        console.error('[Klavis API] Server list error:', error.message);
        return { data: null, error: error.message || 'An unexpected error occurred' };
    }
}

export async function createMcpServerInstance(
  serverName: string,
  projectId: string,
  platformName: string,
): Promise<CreateServerInstanceResponse> {
  try {
    await projectAuthCheck(projectId);

    const requestBody = {
      serverName,
      userId: projectId,
      platformName
    };
    console.log('[Klavis API] Creating server instance:', requestBody);
    
    const endpoint = '/mcp-server/instance/create';
    const result = await klavisApiCall<CreateServerInstanceResponse>(endpoint, {
      method: 'POST',
      body: requestBody
    });

    console.log('[Klavis API] Created server instance:', result);
    return result;
  } catch (error: any) {
    console.error('[Klavis API] Error creating instance:', error);
    throw error;
  }
}

// Helper function to filter eligible servers
function getEligibleServers(servers: McpServerType[]): McpServerType[] {
  return servers.filter(server => 
    server.isActive && (!server.authNeeded || server.isAuthenticated)
  );
}

async function getServerInstance(instanceId: string): Promise<{
  instanceId: string;
  authNeeded: boolean;
  isAuthenticated: boolean;
  serverName: string;
  serverUrl?: string;
}> {
  const endpoint = `/mcp-server/instance/get/${instanceId}`;
  return await klavisApiCall(endpoint);
}

export async function updateProjectServers(projectId: string, targetServerName?: string): Promise<void> {
    try {
        await projectAuthCheck(projectId);
        
        console.log('[Auth] Starting server data update:', { projectId, targetServerName });

        // Get current MongoDB data
        const project = await projectsCollection.findOne({ _id: projectId });
        if (!project) {
            console.error('[Auth] Project not found in MongoDB:', { projectId });
            throw new Error("Project not found");
        }

        const mcpServers = project.mcpServers || [];
        
        // Get active instances to find auth status
        const instances = await listActiveServerInstances(projectId);
        
        // If targetServerName is provided, only process that server
        const instancesToProcess = targetServerName 
            ? instances.filter(i => i.name === targetServerName)
            : instances;
        
        // For each active instance, get its current status
        for (const instance of instancesToProcess) {
            if (!instance.id) continue;

            try {
                // Get fresh instance data
                const serverInstance = await getServerInstance(instance.id);
                
                // Find this server in MongoDB
                const serverIndex = mcpServers.findIndex(s => s.name === instance.name);
                if (serverIndex === -1) continue;
                
                // Update server readiness based on auth status
                const isReady = !serverInstance.authNeeded || serverInstance.isAuthenticated;
                
                // Update existing server
                const updatedServer = {
                    ...mcpServers[serverIndex],
                    isAuthenticated: serverInstance.isAuthenticated,
                    isReady
                };
                mcpServers[serverIndex] = updatedServer;

                // If server is now ready and has no tools, try to enrich them
                if (isReady && (!updatedServer.tools || updatedServer.tools.length === 0)) {
                    try {
                        console.log(`[Auth] Enriching tools for ${instance.name}`);
                        const enrichedTools = await enrichToolsWithParameters(
                            projectId,
                            instance.name,
                            updatedServer.availableTools || [],
                            true
                        );

                        if (enrichedTools.length > 0) {
                            console.log(`[Auth] Writing ${enrichedTools.length} tools to DB for ${instance.name}`);
                            updatedServer.availableTools = enrichedTools;
                            await batchAddTools(projectId, instance.name, enrichedTools);
                        }
                    } catch (enrichError) {
                        console.error(`[Auth] Tool enrichment failed for ${instance.name}:`, enrichError);
                    }
                }
            } catch (error) {
                console.error(`[Auth] Error updating ${instance.name}:`, error);
            }
        }

        // Update MongoDB with new server data
        await projectsCollection.updateOne(
            { _id: projectId },
            { $set: { mcpServers } }
        );
        console.log('[Auth] MongoDB update completed');
    } catch (error) {
        console.error('[Auth] Error updating server data:', error);
        throw error;
    }
}

async function batchAddTools(projectId: string, serverName: string, tools: McpToolType[]): Promise<void> {
    console.log(`[Klavis API] Writing ${tools.length} tools to ${serverName}`);
    
    const toolsToWrite = tools.map(tool => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters || {
            type: 'object',
            properties: {},
            required: []
        }
    }));

    console.log('[Klavis API] DB Write - batchAddTools:', {
        serverName,
        toolCount: tools.length,
        tools: tools.map(t => t.name).join(', ')
    });

    // Update MongoDB in a single operation
    await projectsCollection.updateOne(
        { _id: projectId, "mcpServers.name": serverName },
        { 
            $set: { 
                "mcpServers.$.tools": toolsToWrite
            }
        }
    );
    
    console.log(`[Klavis API] Tools written to ${serverName}`);
}

export async function enableServer(
    serverName: string,
    projectId: string,
    enabled: boolean
): Promise<CreateServerInstanceResponse | {}> {
    try {
        await projectAuthCheck(projectId);

        console.log('[Klavis API] Toggle server request:', { serverName, projectId, enabled });
        
        if (enabled) {
            console.log(`[Klavis API] Creating server instance for ${serverName}...`);
            const result = await createMcpServerInstance(serverName, projectId, "Rowboat");
            console.log('[Klavis API] Server instance created:', { 
                serverName, 
                instanceId: result.instanceId,
                serverUrl: result.serverUrl 
            });

            // Get the current server list from MongoDB
            const project = await projectsCollection.findOne({ _id: projectId });
            if (!project) throw new Error("Project not found");

            const mcpServers = project.mcpServers || [];
            
            // Find the server we're enabling
            const serverIndex = mcpServers.findIndex(s => s.name === serverName);
            const rawServerData = (await klavisApiCall<GetAllServersResponse>('/mcp-server/servers')).servers
                .find(s => s.name === serverName);
            
            if (!rawServerData) throw new Error("Server data not found");

            // Get basic tools data
            const basicTools = (rawServerData.tools || []).map(tool => ({
                id: tool.name || '',
                name: tool.name || '',
                description: tool.description || '',
            }));

            // Update server status in MongoDB
            const updatedServer = {
                ...rawServerData,
                instanceId: result.instanceId,
                serverName: serverName,
                serverUrl: result.serverUrl,
                tools: basicTools, // Select all tools by default
                availableTools: basicTools, // Use basic tools initially
                isActive: true, // Keep isActive true to indicate server is enabled
                isReady: !rawServerData.authNeeded, // Use isReady to indicate eligibility
                authNeeded: rawServerData.authNeeded || false,
                isAuthenticated: false,
                requiresAuth: rawServerData.authNeeded || false
            };

            if (serverIndex === -1) {
                mcpServers.push(updatedServer);
            } else {
                mcpServers[serverIndex] = updatedServer;
            }

            // Update MongoDB with server status
            await projectsCollection.updateOne(
                { _id: projectId },
                { $set: { mcpServers } }
            );

            // Wait for server warm-up (increased from 2s to 5s)
            console.log(`[Klavis API] New server detected, waiting 5s for ${serverName} to initialize...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            console.log(`[Klavis API] Warm-up period complete for ${serverName}`);

            // Try to enrich tools regardless of auth status
            try {
                console.log(`[Klavis API] Enriching tools for ${serverName}`);
                const enrichedTools = await enrichToolsWithParameters(
                    projectId,
                    serverName,
                    basicTools,
                    true
                );

                if (enrichedTools.length > 0) {
                    console.log(`[Klavis API] Writing ${enrichedTools.length} tools to DB for ${serverName}`);
                    // First update availableTools
                    await projectsCollection.updateOne(
                        { _id: projectId, "mcpServers.name": serverName },
                        { 
                            $set: { 
                                "mcpServers.$.availableTools": enrichedTools,
                                "mcpServers.$.isReady": true // Mark server as ready after successful enrichment
                            }
                        }
                    );

                    // Then write the tools
                    await batchAddTools(projectId, serverName, enrichedTools);
                    console.log(`[Klavis API] Successfully wrote tools for ${serverName}`);
                }
            } catch (enrichError) {
                console.error(`[Klavis API] Tool enrichment failed for ${serverName}:`, enrichError);
            }

            return result;
        } else {
            // Get active instances to find the one to delete
            const instances = await listActiveServerInstances(projectId);
            const instance = instances.find(i => i.name === serverName);
            
            if (instance?.id) {
                await deleteMcpServerInstance(instance.id, projectId);
                console.log('[Klavis API] Disabled server:', { serverName, instanceId: instance.id });

                // Remove from MongoDB
                await projectsCollection.updateOne(
                    { _id: projectId },
                    { $pull: { mcpServers: { name: serverName } } }
                );
            } else {
                console.log('[Klavis API] No instance found to disable:', { serverName });
            }
            
            return {};
        }
    } catch (error: any) {
        console.error('[Klavis API] Toggle error:', { 
            server: serverName, 
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        throw error;
    }
}

export async function deleteMcpServerInstance(
  instanceId: string,
  projectId: string,
): Promise<void> {
  try {
    await projectAuthCheck(projectId);

    console.log('[Klavis API] Deleting instance:', { instanceId });
    
    const endpoint = `/mcp-server/instance/delete/${instanceId}`;
    try {
      await klavisApiCall<DeleteServerInstanceResponse>(endpoint, {
        method: 'DELETE'
      });
      console.log('[Klavis API] Instance deleted successfully:', { instanceId });
      
      // Get the server info from MongoDB to find its name
      const project = await projectsCollection.findOne({ _id: projectId });
      const server = project?.mcpServers?.find(s => s.instanceId === instanceId);
      
      if (server) {
        // Update just this server's status in MongoDB
        await projectsCollection.updateOne(
          { _id: projectId, "mcpServers.name": server.name },
          { 
            $set: { 
              "mcpServers.$.isActive": false,
              "mcpServers.$.serverUrl": null,
              "mcpServers.$.tools": [],
              "mcpServers.$.availableTools": [],
              "mcpServers.$.instanceId": null
            }
          }
        );
        console.log('[MongoDB] Server status updated:', { serverName: server.name });
      }
    } catch (error: any) {
      if (error.message.includes('404')) {
        console.log('[Klavis API] Instance already deleted:', { instanceId });
        return;
      }
      throw error;
    }
  } catch (error: any) {
    console.error('[Klavis API] Error deleting instance:', error);
    throw error;
  }
}

// Server name to URL parameter mapping
const SERVER_URL_PARAMS: Record<string, string> = {
  'Google Calendar': 'gcalendar',
  'Google Drive': 'gdrive',
  'Google Docs': 'gdocs',
  'Google Sheets': 'gsheets',
  'Gmail': 'gmail',
};

// Server name to environment variable mapping for client IDs
const SERVER_CLIENT_ID_MAP: Record<string, string | undefined> = {
  'GitHub': process.env.KLAVIS_GITHUB_CLIENT_ID,
  'Google Calendar': process.env.KLAVIS_GOOGLE_CLIENT_ID,
  'Google Drive': process.env.KLAVIS_GOOGLE_CLIENT_ID,
  'Google Docs': process.env.KLAVIS_GOOGLE_CLIENT_ID,
  'Google Sheets': process.env.KLAVIS_GOOGLE_CLIENT_ID,
  'Gmail': process.env.KLAVIS_GOOGLE_CLIENT_ID,
  'Slack': process.env.KLAVIS_SLACK_ID,
};

export async function generateServerAuthUrl(
  serverName: string,
  projectId: string,
  instanceId: string,
): Promise<string> {
  try {
    await projectAuthCheck(projectId);

    // Get the origin from request headers
    const headersList = headers();
    const host = headersList.get('host') || '';
    const protocol = headersList.get('x-forwarded-proto') || 'http';
    const origin = `${protocol}://${host}`;

    // Get the URL parameter for this server
    const serverUrlParam = SERVER_URL_PARAMS[serverName] || serverName.toLowerCase();

    // Build base params
    const params: Record<string, string> = {
      instance_id: instanceId,
      redirect_url: `${origin}/projects/${projectId}/tools/oauth/callback`
    };

    // Add client_id if available for this server
    const clientId = SERVER_CLIENT_ID_MAP[serverName];
    if (clientId) {
      params.client_id = clientId;
    }

    let authUrl = `${KLAVIS_BASE_URL}/oauth/${serverUrlParam}/authorize?${new URLSearchParams(params).toString()}`
    console.log('authUrl', authUrl);

    return authUrl;
  } catch (error) {
    console.error('[Klavis API] Error generating auth URL:', error);
    throw error;
  }
}

export async function syncServerTools(projectId: string, serverName: string): Promise<void> {
    try {
        await projectAuthCheck(projectId);
        
        console.log('[Klavis API] Starting server tool sync:', { projectId, serverName });
        
        // Get enriched tools from MCP
        const enrichedTools = await fetchMcpToolsForServer(projectId, serverName);
        console.log('[Klavis API] Received enriched tools:', {
            serverName,
            toolCount: enrichedTools.length
        });

        // Convert enriched tools to the correct format
        const formattedTools = enrichedTools.map(tool => {
            return {
                id: tool.name,
                name: tool.name,
                description: tool.description,
                parameters: {
                    type: 'object' as const,
                    properties: tool.parameters?.properties || {},
                    required: tool.parameters?.required || []
                }
            };
        });

        // First verify the server exists
        const project = await projectsCollection.findOne({ _id: projectId });
        if (!project) {
            throw new Error(`Project ${projectId} not found`);
        }
        const server = project.mcpServers?.find(s => s.name === serverName);
        if (!server) {
            throw new Error(`Server ${serverName} not found in project ${projectId}`);
        }

        // Update MongoDB with enriched tools
        const updateResult = await projectsCollection.updateOne(
            { _id: projectId, "mcpServers.name": serverName },
            { 
                $set: { 
                    "mcpServers.$.availableTools": formattedTools,
                    "mcpServers.$.tools": formattedTools // Also update selected tools to match
                }
            }
        );

        console.log('[Klavis API] Tools synced:', {
            serverName,
            toolCount: formattedTools.length,
            success: updateResult.modifiedCount > 0
        });

    } catch (error) {
        console.error('[Klavis API] Error syncing server tools:', {
            serverName,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error;
    }
}