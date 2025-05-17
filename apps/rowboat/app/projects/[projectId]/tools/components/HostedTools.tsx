'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SlidePanel } from '@/components/ui/slide-panel';
import { Info, Lock, Power, RefreshCw, Search } from 'lucide-react';
import { clsx } from 'clsx';
import { 
  McpServer, 
  McpTool,
  listAvailableMcpServers,
  enableServer
} from '@/app/actions/klavis_actions';

const SERVER_PRIORITY: Record<string, number> = {
  'GitHub': 1,
  'Slack': 2,
  'Google Drive': 3,
  'Google Docs': 4,
  'Jira': 5,
  'Discord': 6,
  'YouTube': 7,
  'Firecrawl Web Search': 8,
  'Firecrawl Deep Research': 9,
  'Notion': 10
};

function sortServers(servers: McpServer[], filterType: FilterType = 'all'): McpServer[] {
  return [...servers].sort((a, b) => {
    // For popular view, only sort priority servers
    if (filterType === 'popular') {
      const priorityA = SERVER_PRIORITY[a.serverName] || 999;
      const priorityB = SERVER_PRIORITY[b.serverName] || 999;
      if (priorityA === 999 && priorityB === 999) return 0;
      return priorityA - priorityB;
    }

    // For all view, sort by priority first, then available/coming soon
    if (filterType === 'all') {
      const priorityA = SERVER_PRIORITY[a.serverName] || 999;
      const priorityB = SERVER_PRIORITY[b.serverName] || 999;
      const hasToolsA = (a.tools || []).length > 0;
      const hasToolsB = (b.tools || []).length > 0;

      // If both are priority servers, sort by priority
      if (priorityA !== 999 && priorityB !== 999) {
        return priorityA - priorityB;
      }
      // If one is priority server, it comes first
      if (priorityA !== 999) return -1;
      if (priorityB !== 999) return 1;
      // If neither is priority, available servers come before coming soon
      if (hasToolsA !== hasToolsB) {
        return hasToolsA ? -1 : 1;
      }
      // If both are same type (available or coming soon), sort alphabetically
      return a.serverName.localeCompare(b.serverName);
    }

    // For other views, sort alphabetically
    return a.serverName.localeCompare(b.serverName);
  });
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

type FilterType = 'all' | 'available' | 'coming-soon' | 'popular';

export function HostedTools() {
  const params = useParams();
  const projectId = typeof params.projectId === 'string' ? params.projectId : params.projectId?.[0];
  const [servers, setServers] = useState<McpServer[]>([]);
  const [selectedServer, setSelectedServer] = useState<McpServer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [toggleError, setToggleError] = useState<{serverId: string; message: string} | null>(null);
  const [enabledServers, setEnabledServers] = useState<Set<string>>(new Set());
  const [togglingServers, setTogglingServers] = useState<Set<string>>(new Set());

  const fetchServers = useCallback(async () => {
    try {
      setLoading(true);
      const response = await listAvailableMcpServers(projectId || "");
      
      if (response.error) {
        throw new Error(response.error);
      }
      
      if (!response.data) {
        throw new Error('No data received from server');
      }
      
      // Log active servers
      const activeServers = response.data.filter(server => server.isActive);
      console.log('[Klavis API] =================== Active Servers in UI ===================');
      activeServers.forEach((server, index) => {
        console.log(`[Klavis API] Active Server ${index + 1}:`, JSON.stringify({
          id: server.id,
          instanceId: server.instanceId,
          name: server.serverName,
          description: server.description,
          isAuthenticated: server.isAuthenticated,
          tools: server.tools,
        }, null, 2));
      });
      console.log('[Klavis API] ========================================================');
      
      setServers(response.data);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load MCP servers');
      console.error('Error fetching servers:', err);
      // Initialize empty array to prevent map errors
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
      // A server is considered enabled if it is active
      const enabled = new Set(
        servers
          .filter(server => server.isActive)
          .map(server => server.serverName)
      );
      console.log('New enabled servers state:', Array.from(enabled));
      setEnabledServers(enabled);
    }
  }, [servers]);

  const handleToggleTool = async (server: McpServer) => {
    try {
      const serverKey = server.serverName;
      console.log('Toggle:', { server: serverKey, newState: !enabledServers.has(serverKey) });

      setTogglingServers(prev => new Set([...prev, serverKey]));
      setToggleError(null);

      const isCurrentlyEnabled = enabledServers.has(serverKey);
      const newState = !isCurrentlyEnabled;
      
      try {
        const result = await enableServer(server.serverName, projectId || "", newState);
        
        // Update local state immediately
        setEnabledServers(prev => {
          const next = new Set(prev);
          if (!newState) {
            next.delete(serverKey);
          } else if ('instanceId' in result) {
            next.add(serverKey);
          }
          return next;
        });

        // Update servers state immediately
        setServers(prevServers => {
          return prevServers.map(s => {
            if (s.serverName === serverKey) {
              return {
                ...s,
                isActive: newState,
                instanceId: newState ? ('instanceId' in result ? result.instanceId : s.instanceId) : s.id,
                serverUrl: newState ? ('serverUrl' in result ? result.serverUrl : undefined) : undefined,
                isAuthenticated: false // Always set to false when toggling, will be updated on next refresh
              };
            }
            return s;
          });
        });

        // Update server list in background
        const updatedServers = await listAvailableMcpServers(projectId || "");
        
        if (updatedServers.data) {
          setServers(updatedServers.data);
          // Verify our local state matches server state
          const serverState = updatedServers.data.find((s: McpServer) => s.serverName === serverKey);
          const serverEnabled = Boolean(serverState?.isActive);
          
          if (serverEnabled !== newState) {
            console.log('State mismatch:', { server: serverKey, expected: newState, actual: serverEnabled });
            setEnabledServers(prev => {
              const next = new Set(prev);
              if (serverEnabled) {
                next.add(serverKey);
              } else {
                next.delete(serverKey);
              }
              return next;
            });
          }
        }
      } catch (err) {
        console.error('Toggle failed:', { server: serverKey, error: err });
        // Revert local state on error
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
      setTogglingServers(prev => {
        const next = new Set(prev);
        next.delete(server.serverName);
        return next;
      });
    }
  };

  const handleAuthenticate = async (server: McpServer) => {
    try {
      const authWindow = window.open(
        `https://api.klavis.ai/oauth/${server.serverName.toLowerCase()}/authorize?instance_id=${server.instanceId}&redirect_url=${window.location.origin}/projects/${projectId}/tools/oauth/callback`,
        '_blank',
        'width=600,height=700'
      );

      if (authWindow) {
        const checkInterval = setInterval(() => {
          if (authWindow.closed) {
            clearInterval(checkInterval);
            console.log('OAuth window closed, refreshing server status...');
            fetchServers();
          }
        }, 500);
      }
    } catch (error) {
      console.error('Error initiating OAuth:', error);
      window.alert('Failed to setup authentication');
    }
  };

  const handleCreateServer = async (serverName: string) => {
    if (!projectId) {
      console.error('No project ID available');
      return;
    }

    try {
      await enableServer(serverName, projectId, true);
      await fetchServers();
      
      const updatedServers = await listAvailableMcpServers(projectId);
      const server = updatedServers.data?.find((s: McpServer) => s.serverName === serverName);
      if (server?.tools?.[0]?.requiresAuth) {
        window.open(`https://api.klavis.ai/oauth/${serverName.toLowerCase()}/authorize?instance_id=${server.instanceId}`, '_blank');
      }
    } catch (err) {
      console.error('Error creating server:', err);
    }
  };

  const filteredServers = sortServers(servers.filter(server => {
    // First apply the search filter
    const searchLower = searchQuery.toLowerCase();
    const serverTools = server.tools || [];
    const matchesSearch = (
      server.serverName.toLowerCase().includes(searchLower) ||
      server.description.toLowerCase().includes(searchLower) ||
      serverTools.some(tool => 
        tool.name.toLowerCase().includes(searchLower) ||
        tool.description.toLowerCase().includes(searchLower)
      )
    );

    // Then apply the type filter
    const hasTools = (serverTools.length > 0);
    const isPriority = SERVER_PRIORITY[server.serverName] !== undefined;
    
    switch (activeFilter) {
      case 'available':
        return matchesSearch && hasTools && !isPriority;
      case 'coming-soon':
        return matchesSearch && !hasTools;
      case 'popular':
        return matchesSearch && isPriority;
      default:
        return matchesSearch;
    }
  }), activeFilter);

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
        <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
          {[
            { id: 'all', label: 'All' },
            { id: 'popular', label: 'Popular' },
            { id: 'available', label: 'More' },
            { id: 'coming-soon', label: 'Coming Soon' }
          ].map((filter) => (
            <button
              key={filter.id}
              onClick={() => setActiveFilter(filter.id as FilterType)}
              className={clsx(
                'px-4 py-2 text-sm font-medium transition-colors relative',
                activeFilter === filter.id
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400 rounded'
              )}
            >
              {filter.label}
              {activeFilter === filter.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400" />
              )}
            </button>
          ))}
        </div>

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
            <div
              key={server.instanceId}
              className="relative border-2 border-gray-200/80 dark:border-gray-700/80 rounded-xl p-6 
                bg-white dark:bg-gray-900 shadow-sm dark:shadow-none 
                backdrop-blur-sm hover:shadow-md dark:hover:shadow-none 
                transition-all duration-200 flex flex-col
                hover:border-blue-200 dark:hover:border-blue-900"
            >
              <div className="flex flex-col h-full">
                <div className="flex justify-between items-center mb-6">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <ServerLogo serverName={server.serverName} className="mr-2" />
                        <h3 className="font-semibold text-lg text-gray-900 dark:text-gray-100">{server.serverName}</h3>
                        {(server.tools || []).length > 0 ? (
                          <span className="px-1.5 py-0.5 rounded-full text-xs font-medium 
                            bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300">
                            {(server.tools || []).length} tools
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded-full text-xs font-medium 
                            bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300">
                            Coming soon
                          </span>
                        )}
                      </div>
                      {(server.tools || []).length > 0 && (
                        <Switch
                          checked={enabledServers.has(server.serverName)}
                          onCheckedChange={() => handleToggleTool(server)}
                          disabled={togglingServers.has(server.serverName)}
                          className={clsx(
                            "data-[state=checked]:bg-blue-500 dark:data-[state=checked]:bg-blue-600",
                            "data-[state=unchecked]:bg-gray-200 dark:data-[state=unchecked]:bg-gray-700",
                            togglingServers.has(server.serverName) && "opacity-50 cursor-not-allowed"
                          )}
                        />
                      )}
                    </div>
                    {toggleError?.serverId === server.serverName && (
                      <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 
                        py-1 px-2 rounded-md mt-2 animate-fadeIn">
                        {toggleError.message}
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-blue-500 to-purple-500"></span>
                      Klavis AI
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 line-clamp-2">
                    {server.description}
                  </p>
                </div>

                <div className="flex items-center gap-2 mt-auto">
                  {server.isActive && server.authNeeded && (
                    <div className="inline-flex items-center space-x-2">
                      {!server.isAuthenticated && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => handleAuthenticate(server)}
                        >
                          <div className="inline-flex items-center">
                            <Lock className="h-3.5 w-3.5" />
                            <span className="ml-1.5">Auth</span>
                          </div>
                        </Button>
                      )}
                      <div className={clsx(
                        "text-xs py-1 px-2 rounded-full",
                        server.isAuthenticated 
                          ? "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20"
                          : "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20"
                      )}>
                        {server.isAuthenticated ? 'Authenticated' : 'Not authenticated'}
                      </div>
                    </div>
                  )}
                  {(server.tools || []).length > 0 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setSelectedServer(server)}
                      className="ml-auto"
                    >
                      <div className="inline-flex items-center">
                        <Info className="h-4 w-4" />
                        <span className="ml-1.5">Tools</span>
                      </div>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <SlidePanel
        isOpen={!!selectedServer}
        onClose={() => setSelectedServer(null)}
        title={selectedServer?.serverName || 'Server Details'}
      >
        {selectedServer && (
          <div className="space-y-6">
            <div>
              <div className="flex items-center gap-3 mb-6">
                <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Available Tools</h4>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium 
                  bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                  {(selectedServer.tools || []).length}
                </span>
              </div>
              <div className="space-y-4">
                {(selectedServer.tools || []).map((tool) => (
                  <div
                    key={`${selectedServer.instanceId}-${tool.id}`}
                    className="group p-4 rounded-lg bg-gray-50/50 dark:bg-gray-800/50"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div className="px-2.5 py-1 rounded-md text-sm font-medium 
                          bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100">
                          {tool.name}
                        </div>
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 pl-2.5">
                        {tool.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </SlidePanel>
    </div>
  );
}