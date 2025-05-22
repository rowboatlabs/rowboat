'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SlidePanel } from '@/components/ui/slide-panel';
import { Info, Lock, Power, RefreshCw, Search, RefreshCcw } from 'lucide-react';
import { clsx } from 'clsx';
import { 
  listAvailableMcpServers,
  enableServer,
  updateProjectServers
} from '@/app/actions/klavis_actions';
import { toggleMcpTool, getSelectedMcpTools, fetchMcpToolsForServer } from '@/app/actions/mcp_actions';
import { z } from 'zod';
import { MCPServer } from '@/app/lib/types/types';
import { Checkbox } from '@heroui/react';
import { projectsCollection } from '@/app/lib/mongodb';
import { 
  ServerCard, 
  ToolManagementPanel,
  ServerOperationBanner 
} from './MCPServersCommon';

type McpServerType = z.infer<typeof MCPServer>;
type McpToolType = z.infer<typeof MCPServer>['tools'][number];

function sortServers(servers: McpServerType[]): McpServerType[] {
  return [...servers].sort((a, b) => a.name.localeCompare(b.name));
}

const fadeInAnimation = {
  '@keyframes fadeIn': {
    '0%': { opacity: 0, transform: 'translateY(-5px)' },
    '100%': { opacity: 1, transform: 'translateY(0)' }
  },
  '.animate-fadeIn': {
    animation: 'fadeIn 0.2s ease-out'
  }
} as const;

interface ServerLogoProps {
  serverName: string;
  className?: string;
}

export function ServerLogo({ serverName, className = "" }: ServerLogoProps) {
  const logoMap: Record<string, string> = {
    'GitHub': '/mcp-server-images/github.svg',
    'Google Drive': '/mcp-server-images/gdrive.svg',
    'Google Docs': '/mcp-server-images/gdocs.svg',
    'Jira': '/mcp-server-images/jira.svg',
    'Notion': '/mcp-server-images/notion.svg',
    'Resend': '/mcp-server-images/resend.svg',
    'Slack': '/mcp-server-images/slack.svg',
    'WordPress': '/mcp-server-images/wordpress.svg',
    'Supabase': '/mcp-server-images/supabase.svg',
    'Postgres': '/mcp-server-images/postgres.svg',
    'Firecrawl Web Search': '/mcp-server-images/firecrawl.webp',
    'Firecrawl Deep Research': '/mcp-server-images/firecrawl.webp',
    'Discord': '/mcp-server-images/discord.svg',
    'YouTube': '/mcp-server-images/youtube.svg',
  };

  const logoPath = logoMap[serverName] || '';
  
  if (!logoPath) return null;

  return (
    <div className={`relative w-6 h-6 ${className}`}>
      <Image
        src={logoPath}
        alt={`${serverName} logo`}
        fill
        className="object-contain"
      />
    </div>
  );
}

const toolCardStyles = {
    base: clsx(
        "group p-4 rounded-lg transition-all duration-200",
        "bg-gray-50/50 dark:bg-gray-800/50",
        "hover:bg-gray-100/50 dark:hover:bg-gray-700/50",
        "border border-transparent",
        "hover:border-gray-200 dark:hover:border-gray-600"
    ),
};

const ToolCard = ({ 
  tool, 
  server, 
  isSelected, 
  onSelect, 
  showCheckbox = false 
}: { 
  tool: McpToolType; 
  server: McpServerType; 
  isSelected?: boolean; 
  onSelect?: (selected: boolean) => void;
  showCheckbox?: boolean;
}) => {
  return (
    <div className={toolCardStyles.base}>
      <div className="flex items-start gap-3">
        {showCheckbox && (
          <Checkbox
            isSelected={isSelected}
            onValueChange={onSelect}
            size="sm"
          />
        )}
        <div className="flex-1">
          <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
            {tool.name}
          </h4>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {tool.description}
          </p>
        </div>
      </div>
    </div>
  );
};

export function HostedServers() {
  const params = useParams();
  const projectId = typeof params.projectId === 'string' ? params.projectId : params.projectId?.[0];
  if (!projectId) throw new Error('Project ID is required');
  
  const [servers, setServers] = useState<McpServerType[]>([]);
  const [selectedServer, setSelectedServer] = useState<McpServerType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [toggleError, setToggleError] = useState<{serverId: string; message: string} | null>(null);
  const [enabledServers, setEnabledServers] = useState<Set<string>>(new Set());
  const [togglingServers, setTogglingServers] = useState<Set<string>>(new Set());
  const [serverOperations, setServerOperations] = useState<Map<string, 'setup' | 'delete' | 'checking-auth'>>(new Map());
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());
  const [hasToolChanges, setHasToolChanges] = useState(false);
  const [savingTools, setSavingTools] = useState(false);
  const [serverToolCounts, setServerToolCounts] = useState<Map<string, number>>(new Map());
  const [syncingServers, setSyncingServers] = useState<Set<string>>(new Set());

  const fetchServers = useCallback(async () => {
    try {
      setLoading(true);
      const response = await listAvailableMcpServers(projectId || "");
      
      if (response.error) {
        console.error(`Call to listAvailableMcpServers failed with projectId: ${projectId} and error: ${response.error}`);
        throw new Error(response.error);
      }
      
      if (!response.data) {
        throw new Error('No data received from server');
      }
      
      // Mark all servers as hosted type
      const serversWithType = response.data.map(server => ({
        ...server,
        serverType: 'hosted' as const
      }));
      
      setServers(serversWithType);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load MCP servers');
      console.error('Error fetching servers:', err);
      setServers([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  // Initialize enabled servers on load and keep it updated
  useEffect(() => {
    if (servers) {
      console.log('Updating enabled servers from server data:', servers);
      const enabled = new Set(
        servers
          .filter(server => server.isActive)
          .map(server => server.name)
      );
      console.log('New enabled servers state:', Array.from(enabled));
      setEnabledServers(enabled);
    }
  }, [servers]);

  // Initialize tool counts when servers are loaded
  useEffect(() => {
    const newCounts = new Map<string, number>();
    servers.forEach(server => {
      if (isServerEligible(server)) {
        newCounts.set(server.name, server.tools.length);
      }
    });
    setServerToolCounts(newCounts);
  }, [servers]);

  // Initialize selected tools when opening the panel
  useEffect(() => {
    if (selectedServer) {
      setSelectedTools(new Set(selectedServer.tools.map(t => t.id)));
      setHasToolChanges(false);
    }
  }, [selectedServer]);

  const isServerEligible = (server: McpServerType) => {
    return server.isActive && (!server.authNeeded || server.isAuthenticated);
  };

  const handleToggleTool = async (server: McpServerType) => {
    try {
      const serverKey = server.name;
      setTogglingServers(prev => new Set([...prev, serverKey]));
      setToggleError(null);

      const isCurrentlyEnabled = enabledServers.has(serverKey);
      const newState = !isCurrentlyEnabled;
      
      setServerOperations(prev => {
        const next = new Map(prev);
        next.set(serverKey, newState ? 'setup' : 'delete');
        return next;
      });

      try {
        const result = await enableServer(server.name, projectId || "", newState);
        
        setEnabledServers(prev => {
          const next = new Set(prev);
          if (!newState) {
            next.delete(serverKey);
          } else if ('instanceId' in result) {
            next.add(serverKey);
          }
          return next;
        });

        if (newState) {
          const response = await listAvailableMcpServers(projectId || "");
          if (response.data) {
            const updatedServer = response.data.find(s => s.name === serverKey);
            if (updatedServer) {
              setServers(prevServers => {
                return prevServers.map(s => {
                  if (s.name === serverKey) {
                    return { ...updatedServer, serverType: 'hosted' as const };
                  }
                  return s;
                });
              });

              setServerToolCounts(prev => {
                const next = new Map(prev);
                next.set(serverKey, updatedServer.tools.length);
                return next;
              });
            }
          }
        } else {
          setServers(prevServers => {
            return prevServers.map(s => {
              if (s.name === serverKey) {
                return {
                  ...s,
                  isActive: false,
                  serverUrl: undefined,
                  tools: [],
                  availableTools: s.availableTools,
                  isAuthenticated: false
                };
              }
              return s;
            });
          });

          setServerToolCounts(prev => {
            const next = new Map(prev);
            next.set(serverKey, 0);
            return next;
          });
        }
      } catch (err) {
        console.error('Toggle failed:', { server: serverKey, error: err });
        setEnabledServers(prev => {
          const next = new Set(prev);
          if (newState) {
            next.delete(serverKey);
          } else {
            next.add(serverKey);
          }
          return next;
        });
        setToggleError({
          serverId: serverKey,
          message: "We're having trouble setting up this server. Please reach out on discord."
        });
      }
    } finally {
      const serverKey = server.name;
      setTogglingServers(prev => {
        const next = new Set(prev);
        next.delete(serverKey);
        return next;
      });
      setServerOperations(prev => {
        const next = new Map(prev);
        next.delete(serverKey);
        return next;
      });
    }
  };

  const handleAuthenticate = async (server: McpServerType) => {
    try {
      const authUrl = `https://api.klavis.ai/oauth/${server.name.toLowerCase()}/authorize?instance_id=${server.instanceId}&redirect_url=${window.location.origin}/projects/${projectId}/tools/oauth/callback`;
      const authWindow = window.open(
        authUrl,
        '_blank',
        'width=600,height=700'
      );

      if (authWindow) {
        const checkInterval = setInterval(async () => {
          if (authWindow.closed) {
            clearInterval(checkInterval);
            
            try {
              setServerOperations(prev => {
                const next = new Map(prev);
                next.set(server.name, 'checking-auth');
                return next;
              });
              
              await updateProjectServers(projectId);
              
              const response = await listAvailableMcpServers(projectId);
              if (response.data) {
                const updatedServer = response.data.find(us => us.name === server.name);
                if (updatedServer) {
                  setServers(prevServers => {
                    return prevServers.map(s => {
                      if (s.name === server.name) {
                        return { ...updatedServer, serverType: 'hosted' as const };
                      }
                      return s;
                    });
                  });

                  if (selectedServer?.name === server.name) {
                    setSelectedServer({ ...updatedServer, serverType: 'hosted' as const });
                  }

                  if (!server.authNeeded || updatedServer.isAuthenticated) {
                    await handleSyncServer(updatedServer);
                  }
                }
              }
            } finally {
              setServerOperations(prev => {
                const next = new Map(prev);
                next.delete(server.name);
                return next;
              });
            }
          }
        }, 500);
      } else {
        window.alert('Failed to open authentication window. Please check your popup blocker settings.');
      }
    } catch (error) {
      console.error('[Auth] Error initiating OAuth:', error);
      window.alert('Failed to setup authentication');
    }
  };

  const handleSaveToolSelection = async () => {
    if (!selectedServer || !projectId) return;
    
    setSavingTools(true);
    try {
        const availableTools = selectedServer.availableTools || [];
        const previousTools = new Set(selectedServer.tools.map(t => t.id));
        const updatedTools = new Set<string>();
        
        for (const tool of availableTools) {
            const isSelected = selectedTools.has(tool.id);
            await toggleMcpTool(projectId, selectedServer.name, tool.id, isSelected);
            if (isSelected) {
                updatedTools.add(tool.id);
            }
        }
        
        setServers(prevServers => {
            return prevServers.map(s => {
                if (s.name === selectedServer.name) {
                    return {
                        ...s,
                        tools: availableTools.filter(tool => selectedTools.has(tool.id))
                    };
                }
                return s;
            });
        });

        setSelectedServer(prev => {
            if (!prev) return null;
            return {
                ...prev,
                tools: availableTools.filter(tool => selectedTools.has(tool.id))
            };
        });

        setServerToolCounts(prev => {
            const next = new Map(prev);
            next.set(selectedServer.name, selectedTools.size);
            return next;
        });
        
        setHasToolChanges(false);
    } catch (error) {
        console.error('Error saving tool selection:', error);
    } finally {
        setSavingTools(false);
    }
  };

  const handleSyncServer = async (server: McpServerType) => {
    if (!projectId || !isServerEligible(server)) return;

    try {
      setSyncingServers(prev => new Set([...prev, server.name]));
      const enrichedTools = await fetchMcpToolsForServer(projectId, server.name);
      
      setServers(prevServers => {
        return prevServers.map(s => {
          if (s.name === server.name) {
            const updatedAvailableTools = (s.availableTools || []).map(originalTool => {
              const enrichedTool = enrichedTools.find(t => t.name === originalTool.name);
              return enrichedTool ? {
                ...originalTool,
                description: enrichedTool.description,
                parameters: enrichedTool.parameters
              } : originalTool;
            });
            
            return {
              ...s,
              availableTools: updatedAvailableTools
            };
          }
          return s;
        });
      });

      if (selectedServer?.name === server.name) {
        setSelectedServer(prev => {
          if (!prev) return null;
          const updatedAvailableTools = (prev.availableTools || []).map(originalTool => {
            const enrichedTool = enrichedTools.find(t => t.name === originalTool.name);
            return enrichedTool ? {
              ...originalTool,
              description: enrichedTool.description,
              parameters: enrichedTool.parameters
            } : originalTool;
          });
          
          return {
            ...prev,
            availableTools: updatedAvailableTools
          };
        });
      }
    } finally {
      setSyncingServers(prev => {
        const next = new Set(prev);
        next.delete(server.name);
        return next;
      });
    }
  };

  const filteredServers = sortServers(servers.filter(server => {
    const searchLower = searchQuery.toLowerCase();
    const serverTools = server.tools || [];
    return (
      server.name.toLowerCase().includes(searchLower) ||
      server.description.toLowerCase().includes(searchLower) ||
      serverTools.some(tool => 
        tool.name.toLowerCase().includes(searchLower) ||
        tool.description.toLowerCase().includes(searchLower)
      )
    );
  }));

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg p-4">
        <div className="flex gap-3">
          <div className="flex-shrink-0">
            <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <p className="text-sm text-blue-700 dark:text-blue-300">
            To make hosted MCP tools available to agents in the Build view, first toggle the servers ON here. Some tools may require authentication after enabling.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-2 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-gray-400 dark:text-gray-500" />
            </div>
            <input
              type="text"
              placeholder="Search servers or tools..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-md 
                bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 
                placeholder-gray-400 dark:placeholder-gray-500
                focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400
                hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
            />
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={fetchServers}
            disabled={loading}
          >
            <div className="inline-flex items-center">
              <RefreshCw className={clsx("h-4 w-4", loading && "animate-spin")} />
              <span className="ml-2">Refresh</span>
            </div>
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-800 dark:border-gray-200 mx-auto"></div>
          <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">Loading tools...</p>
        </div>
      ) : error ? (
        <div className="text-center py-8 text-red-500 dark:text-red-400">{error}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredServers.map((server) => (
            <ServerCard
              key={server.instanceId}
              server={server}
              onToggle={() => handleToggleTool(server)}
              onManageTools={() => setSelectedServer(server)}
              onSync={() => handleSyncServer(server)}
              onAuth={() => handleAuthenticate(server)}
              isToggling={togglingServers.has(server.name)}
              isSyncing={syncingServers.has(server.name)}
              operation={serverOperations.get(server.name)}
              error={toggleError?.serverId === server.name ? toggleError : undefined}
              showAuth={true}
            />
          ))}
        </div>
      )}

      <ToolManagementPanel
        server={selectedServer}
        onClose={() => {
          setSelectedServer(null);
          setSelectedTools(new Set());
          setHasToolChanges(false);
        }}
        selectedTools={selectedTools}
        onToolSelectionChange={(toolId, selected) => {
          setSelectedTools(prev => {
            const next = new Set(prev);
            if (selected) {
              next.add(toolId);
            } else {
              next.delete(toolId);
            }
            setHasToolChanges(true);
            return next;
          });
        }}
        onSaveTools={handleSaveToolSelection}
        onSyncTools={selectedServer ? () => handleSyncServer(selectedServer) : undefined}
        hasChanges={hasToolChanges}
        isSaving={savingTools}
        isSyncing={selectedServer ? syncingServers.has(selectedServer.name) : false}
      />
    </div>
  );
}