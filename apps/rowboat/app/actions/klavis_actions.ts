'use server';

import { projectAuthCheck } from './project_actions';
import { z } from 'zod';
import { MCPServer, McpTool, McpServerResponse, McpServerTool } from '../lib/types/types';
import { projectsCollection } from '../lib/mongodb';
import { fetchMcpTools, toggleMcpTool } from './mcp_actions';
import { fetchMcpToolsForServer } from './mcp_actions';

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

    console.log('[Klavis API] =================== Active Instances ===================');
    data.instances.forEach((instance, index) => {
      console.log(`[Klavis API] Instance ${index + 1}:`, {
        id: instance.id,
        name: instance.name,
        description: instance.description,
        tools: `[${instance.tools?.length || 0} tools]`,
        isAuthenticated: instance.isAuthenticated,
        authNeeded: instance.authNeeded
      });
    });
    console.log('[Klavis API] =====================================================');
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
        console.log('[Klavis API] Starting tool enrichment:', {
            serverName,
            isNewlyEnabled,
            basicToolCount: basicTools.length,
            basicTools: basicTools.map(t => t.name)
        });

        // Fetch full tool details including parameters for this specific server
        console.log(`[Klavis API] Fetching enriched tools for ${serverName} from MCP...`);
        const enrichedTools = await fetchMcpToolsForServer(projectId, serverName);
        
        console.log('[Klavis API] Raw MCP tools response:', {
            serverName,
            rawResponse: enrichedTools
        });

        // Create a map of enriched tools for this server
        const enrichedToolMap = new Map(
            enrichedTools.map(t => [t.name, t])
        );

        // Find tools that couldn't be enriched
        const unenrichedTools = basicTools
            .filter(tool => !enrichedToolMap.has(tool.name))
            .map(tool => tool.name);

        if (unenrichedTools.length > 0) {
            console.log('[Klavis API] Tools that could not be enriched:', {
                serverName,
                unenrichedTools
            });
        }

        console.log('[Klavis API] Tool enrichment results:', {
            serverName,
            totalEnrichedTools: enrichedTools.length,
            serverSpecificTools: enrichedToolMap.size,
            enrichedToolNames: Array.from(enrichedToolMap.keys())
        });

        // Enrich the basic tools with parameters and descriptions
        const result = basicTools.map(basicTool => {
            const enrichedTool = enrichedToolMap.get(basicTool.name);
            const tool: McpToolType = {
                id: basicTool.name,
                name: basicTool.name,
                description: enrichedTool?.description || basicTool.description || '', // Use MCP server description if available
                parameters: {
                    type: 'object',
                    properties: enrichedTool?.parameters?.properties || {},
                    required: enrichedTool?.parameters?.required || []
                }
            };
            
            return tool;
        });

        console.log('[Klavis API] Enrichment complete:', {
            serverName,
            totalTools: result.length,
            enrichedCount: result.filter(t => enrichedToolMap.has(t.name)).length
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
            servers: rawData.servers.map(s => ({
                name: s.name,
                toolCount: s.tools?.length || 0
            }))
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
                instances: activeInstances.map(i => ({
                    name: i.name,
                    isAuthenticated: i.isAuthenticated,
                    authNeeded: i.authNeeded
                }))
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
                console.log('[Klavis API] Processing eligible server:', {
                    serverName: server.name,
                    isActive,
                    isAuthenticated,
                    authNeeded,
                    hasMongodbData: !!mongodbServer,
                    mongoToolCount: mongodbServer?.tools.length || 0
                });

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

export async function updateProjectServers(projectId: string): Promise<void> {
  try {
    await projectAuthCheck(projectId);
    
    console.log('[Auth] Starting server data update after OAuth:', { projectId });

    // Get current MongoDB data
    const project = await projectsCollection.findOne({ _id: projectId });
    if (!project) {
      console.error('[Auth] Project not found in MongoDB:', { projectId });
      throw new Error("Project not found");
    }

    const mcpServers = project.mcpServers || [];
    console.log('[Auth] Current MongoDB servers:', {
      serverCount: mcpServers.length,
      servers: mcpServers.map(s => ({
        name: s.name,
        isActive: s.isActive,
        isReady: s.isReady,
        isAuthenticated: s.isAuthenticated,
        authNeeded: s.authNeeded,
        serverUrl: s.serverUrl
      }))
    });
    
    // Get active instances to find auth status
    console.log('[Auth] Fetching active instances...');
    const instances = await listActiveServerInstances(projectId);
    console.log('[Auth] Active instances:', {
      count: instances.length,
      instances: instances.map(i => ({
        name: i.name,
        id: i.id,
        isAuthenticated: i.isAuthenticated,
        authNeeded: i.authNeeded
      }))
    });
    
    // For each active instance, get its current status
    for (const instance of instances) {
      if (!instance.id) {
        console.warn('[Auth] Instance missing ID:', { instanceName: instance.name });
        continue;
      }

      try {
        console.log('[Auth] Getting fresh instance data:', { 
          instanceName: instance.name,
          instanceId: instance.id 
        });
        
        // Get fresh instance data
        const serverInstance = await getServerInstance(instance.id);
        console.log('[Auth] Server instance data:', {
          name: instance.name,
          authNeeded: serverInstance.authNeeded,
          isAuthenticated: serverInstance.isAuthenticated,
          serverUrl: serverInstance.serverUrl
        });
        
        // Find this server in MongoDB
        const serverIndex = mcpServers.findIndex(s => s.name === instance.name);
        console.log('[Auth] MongoDB server lookup:', {
          name: instance.name,
          found: serverIndex >= 0,
          index: serverIndex
        });
        
        // Update server readiness based on auth status
        const isReady = !serverInstance.authNeeded || serverInstance.isAuthenticated;
        console.log('[Auth] Server readiness check:', {
          name: instance.name,
          isReady,
          authNeeded: serverInstance.authNeeded,
          isAuthenticated: serverInstance.isAuthenticated
        });
        
        if (serverIndex >= 0) {
          // Update existing server
          const updatedServer = {
            ...mcpServers[serverIndex],
            isAuthenticated: serverInstance.isAuthenticated,
            isReady: isReady
          };

          console.log('[Auth] Updating existing server in MongoDB:', {
            name: instance.name,
            oldAuth: mcpServers[serverIndex].isAuthenticated,
            newAuth: serverInstance.isAuthenticated,
            oldReady: mcpServers[serverIndex].isReady,
            newReady: isReady
          });

          mcpServers[serverIndex] = updatedServer;

          // If server is now ready and has no tools, try to enrich them
          if (isReady && (!updatedServer.tools || updatedServer.tools.length === 0)) {
            try {
              console.log(`[Auth] Enriching tools for newly authenticated server ${instance.name}`);
              const enrichedTools = await enrichToolsWithParameters(
                projectId,
                instance.name,
                updatedServer.availableTools || [],
                true
              );

              if (enrichedTools.length > 0) {
                updatedServer.availableTools = enrichedTools;
                await batchAddTools(projectId, instance.name, enrichedTools);
              }
            } catch (enrichError) {
              console.error(`[Auth] Tool enrichment failed for ${instance.name}:`, enrichError);
            }
          }
        }
      } catch (error) {
        console.error('[Auth] Error updating server instance:', {
          instanceId: instance.id,
          instanceName: instance.name,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Update MongoDB with new server data
    console.log('[Auth] Updating MongoDB with new server data:', {
      serverCount: mcpServers.length,
      servers: mcpServers.map(s => ({
        name: s.name,
        isActive: s.isActive,
        isReady: s.isReady,
        isAuthenticated: s.isAuthenticated
      }))
    });

    await projectsCollection.updateOne(
      { _id: projectId },
      { $set: { mcpServers } }
    );
    console.log('[Auth] MongoDB update completed successfully');
  } catch (error) {
    console.error('[Auth] Error updating server data:', {
      projectId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

async function batchAddTools(projectId: string, serverName: string, tools: McpToolType[]): Promise<void> {
    console.log(`[Klavis API] Batch adding ${tools.length} tools for ${serverName}`);
    
    // Update MongoDB in a single operation
    await projectsCollection.updateOne(
        { _id: projectId, "mcpServers.name": serverName },
        { 
            $set: { 
                "mcpServers.$.tools": tools.map(tool => ({
                    id: tool.id,
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters || {
                        type: 'object',
                        properties: {},
                        required: []
                    }
                }))
            }
        }
    );
    
    console.log(`[Klavis API] Successfully added ${tools.length} tools to ${serverName}`);
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
                console.log(`[Klavis API] Enriching tools for newly enabled server ${serverName}`);
                const enrichedTools = await enrichToolsWithParameters(
                    projectId,
                    serverName,
                    basicTools,
                    true // isNewlyEnabled = true
                );

                if (enrichedTools.length > 0) {
                    // Update server with enriched tools
                    await projectsCollection.updateOne(
                        { _id: projectId, "mcpServers.name": serverName },
                        { 
                            $set: { 
                                "mcpServers.$.availableTools": enrichedTools
                            }
                        }
                    );

                    // For auth-needed servers, we'll still write the tools but they won't be usable until auth
                    await batchAddTools(projectId, serverName, enrichedTools);
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