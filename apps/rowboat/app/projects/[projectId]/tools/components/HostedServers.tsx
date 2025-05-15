'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Info, RefreshCw, Search, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import { 
  listAvailableMcpServers,
  enableServer,
  updateProjectServers,
  generateServerAuthUrl,
  syncServerTools
} from '@/app/actions/klavis_actions';
import { toggleMcpTool, fetchMcpToolsForServer } from '@/app/actions/mcp_actions';
import { z } from 'zod';
import { MCPServer } from '@/app/lib/types/types';
import { Checkbox } from '@heroui/react';
import { 
  ServerCard, 
  ToolManagementPanel,
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

const ErrorBanner = ({ onRetry }: { onRetry: () => void }) => (
  <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-lg p-4">
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
        <p className="text-sm text-red-700 dark:text-red-300">
          Unable to load hosted tools. Please check your connection and try again. If the problem persists, contact us on Discord.
        </p>
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={onRetry}
        className="shrink-0"
      >
        <RefreshCw className="h-4 w-4 mr-2" />
        Retry
      </Button>
    </div>
  </div>
);

export function HostedServers() {
  const params = useParams();
  const projectId = typeof params.projectId === 'string' ? params.projectId : params.projectId?.[0];
  if (!projectId) throw new Error('Project ID is required');
  
  const [servers, setServers] = useState<McpServerType[]>([]);
  const [selectedServer, setSelectedServer] = useState<McpServerType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showOnlyEnabled, setShowOnlyEnabled] = useState(false);
  const [showOnlyReady, setShowOnlyReady] = useState(false);
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
      
      if (response.error || !response.data) {
        setError('No hosted tools found. Make sure to set your Klavis API key. Contact us on discord if you\'re still unable to see hosted tools.');
        return;
      }
      
      // Mark all servers as hosted type
      const serversWithType = response.data.map(server => ({
        ...server,
        serverType: 'hosted' as const
      }));
      
      setServers(serversWithType);
      setError(null);
    } catch (err: any) {
      setError('No hosted tools found. Make sure to set your Klavis API key. Contact us on discord if you\'re still unable to see hosted tools.');
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
      const isCurrentlyEnabled = enabledServers.has(serverKey);
      const newState = !isCurrentlyEnabled;

      // Immediately update UI state
      setServers(prevServers => {
        return prevServers.map(s => {
          if (s.name === serverKey) {
            return {
              ...s,
              isActive: newState,
              // If turning off, reset these states
              ...(newState ? {} : {
                serverUrl: undefined,
                tools: [],
                isAuthenticated: false
              })
            };
          }
          return s;
        });
      });
      
      setTogglingServers(prev => {
        const next = new Set(prev);
        next.add(serverKey);
        return next;
      });
      setToggleError(null);
      
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
          setServerToolCounts(prev => {
            const next = new Map(prev);
            next.set(serverKey, 0);
            return next;
          });
        }
      } catch (err) {
        console.error('Toggle failed:', { server: serverKey, error: err });
        // Revert the UI state on error
        setServers(prevServers => {
          return prevServers.map(s => {
            if (s.name === serverKey) {
              return {
                ...s,
                isActive: isCurrentlyEnabled,
                // Restore previous state if the toggle failed
                ...(isCurrentlyEnabled ? {} : {
                  serverUrl: undefined,
                  tools: [],
                  isAuthenticated: false
                })
              };
            }
            return s;
          });
        });
        
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
      if (!server.instanceId) {
        throw new Error('Server instance ID not found');
      }
      const authUrl = await generateServerAuthUrl(server.name, projectId, server.instanceId);
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
              
              await updateProjectServers(projectId, server.name);
              
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
      setSyncingServers(prev => {
        const next = new Set(prev);
        next.add(server.name);
        return next;
      });

      // Call the server action to sync and update DB
      await syncServerTools(projectId, server.name);
      
      // Refresh the server list to get updated data
      const response = await listAvailableMcpServers(projectId);
      if (response.data) {
        const updatedServer = response.data.find(s => s.name === server.name);
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
        }
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
    
    // Search text filter
    const matchesSearch = 
      server.name.toLowerCase().includes(searchLower) ||
      server.description.toLowerCase().includes(searchLower) ||
      serverTools.some(tool => 
        tool.name.toLowerCase().includes(searchLower) ||
        tool.description.toLowerCase().includes(searchLower)
      );

    // Enabled servers filter
    const matchesEnabled = !showOnlyEnabled || server.isActive;

    // Ready to use filter (server is active and either doesn't need auth or is already authenticated)
    const isReady = server.isActive && (!server.authNeeded || server.isAuthenticated);
    const matchesReady = !showOnlyReady || isReady;

    return matchesSearch && matchesEnabled && matchesReady;
  }));

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-800 dark:border-gray-200 mx-auto"></div>
        <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">Loading tools...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <p className="text-center text-red-500 dark:text-red-400">
          {error}
        </p>
      </div>
    );
  }

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
          <div className="flex-1 flex items-center gap-4">
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
            <div className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
              {filteredServers.length} {filteredServers.length === 1 ? 'server' : 'servers'} • {
                filteredServers.reduce((total, server) => total + (server.availableTools?.length || 0), 0)
              } tools
            </div>
            <div className="h-4 w-px bg-gray-200 dark:bg-gray-700" />
            <div className="flex items-center gap-8">
              <div className="group relative flex items-center gap-1">
                <label className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300">
                  <Checkbox
                    isSelected={showOnlyEnabled}
                    onValueChange={setShowOnlyEnabled}
                    size="sm"
                  />
                  Enabled Only
                </label>
                <div className="relative">
                  <Info className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500 cursor-help ml-1" />
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 dark:bg-gray-800 text-white text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap shadow-lg">
                    Shows only servers that are currently toggled ON
                  </div>
                </div>
              </div>

              <div className="group relative flex items-center gap-1">
                <label className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300">
                  <Checkbox
                    isSelected={showOnlyReady}
                    onValueChange={setShowOnlyReady}
                    size="sm"
                  />
                  Ready to Use
                </label>
                <div className="relative">
                  <Info className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500 cursor-help ml-1" />
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 dark:bg-gray-800 text-white text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap shadow-lg">
                    Shows only servers that are enabled and fully authenticated
                  </div>
                </div>
              </div>
            </div>
            <div className="h-4 w-px bg-gray-200 dark:bg-gray-700" />
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