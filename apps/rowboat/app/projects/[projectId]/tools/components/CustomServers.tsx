'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Info, Plus, Search } from 'lucide-react';
import { clsx } from 'clsx';
import { z } from 'zod';
import { MCPServer } from '@/app/lib/types/types';
import { 
  ServerCard, 
  ToolManagementPanel 
} from './MCPServersCommon';
import { fetchMcpToolsForServer } from '@/app/actions/mcp_actions';
import { 
  fetchCustomServers,
  addCustomServer,
  removeCustomServer,
  toggleCustomServer,
  updateCustomServerTools
} from '@/app/actions/custom_server_actions';
import { Modal } from '@/components/ui/modal';

type McpServerType = z.infer<typeof MCPServer>;
type McpToolType = z.infer<typeof MCPServer>['tools'][number];

export function CustomServers() {
  const params = useParams();
  const projectId = typeof params.projectId === 'string' ? params.projectId : params.projectId?.[0];
  if (!projectId) throw new Error('Project ID is required');
  
  const [servers, setServers] = useState<McpServerType[]>([]);
  const [selectedServer, setSelectedServer] = useState<McpServerType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [togglingServers, setTogglingServers] = useState<Set<string>>(new Set());
  const [serverOperations, setServerOperations] = useState<Map<string, 'setup' | 'delete'>>(new Map());
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());
  const [hasToolChanges, setHasToolChanges] = useState(false);
  const [savingTools, setSavingTools] = useState(false);
  const [syncingServers, setSyncingServers] = useState<Set<string>>(new Set());
  const [showAddServer, setShowAddServer] = useState(false);
  const [newServerName, setNewServerName] = useState('');
  const [newServerUrl, setNewServerUrl] = useState('');

  const fetchServers = useCallback(async () => {
    try {
      setLoading(true);
      const customServers = await fetchCustomServers(projectId);
      setServers(customServers);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load custom MCP servers');
      console.error('Error fetching servers:', err);
      setServers([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const handleToggleServer = async (server: McpServerType) => {
    try {
      const serverKey = server.name;
      setTogglingServers(prev => {
        const next = new Set(prev);
        next.add(serverKey);
        return next;
      });
      
      setServerOperations(prev => {
        const next = new Map(prev);
        next.set(serverKey, server.isActive ? 'delete' : 'setup');
        return next;
      });

      await toggleCustomServer(projectId, server.name, !server.isActive);

      // Update local state
      setServers(prevServers => {
        return prevServers.map(s => {
          if (s.name === serverKey) {
            return {
              ...s,
              isActive: !s.isActive
            };
          }
          return s;
        });
      });
    } catch (err) {
      console.error('Toggle failed:', { server: server.name, error: err });
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

  const handleSyncServer = async (server: McpServerType) => {
    if (!projectId || !server.isActive) return;

    try {
      setSyncingServers(prev => {
        const next = new Set(prev);
        next.add(server.name);
        return next;
      });
      const enrichedTools = await fetchMcpToolsForServer(projectId, server.name);
      
      const updatedAvailableTools = enrichedTools.map(tool => ({
        id: tool.name,
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }));

      await updateCustomServerTools(
        projectId,
        server.name,
        updatedAvailableTools, // Auto-select all tools for custom servers
        updatedAvailableTools
      );
      
      // Update servers state
      setServers(prevServers => {
        return prevServers.map(s => {
          if (s.name === server.name) {
            return {
              ...s,
              availableTools: updatedAvailableTools,
              tools: updatedAvailableTools
            };
          }
          return s;
        });
      });

      // If this server is currently selected, update the selectedTools state
      if (selectedServer?.name === server.name) {
        setSelectedServer(prev => {
          if (!prev) return null;
          return {
            ...prev,
            availableTools: updatedAvailableTools,
            tools: updatedAvailableTools
          };
        });
        // Update selectedTools to include all tools for the custom server
        setSelectedTools(new Set(updatedAvailableTools.map(tool => tool.id)));
      }
    } finally {
      setSyncingServers(prev => {
        const next = new Set(prev);
        next.delete(server.name);
        return next;
      });
    }
  };

  // Add effect to sync selectedTools when selectedServer changes
  useEffect(() => {
    if (selectedServer) {
      setSelectedTools(new Set(selectedServer.tools.map(tool => tool.id)));
      setHasToolChanges(false);
    }
  }, [selectedServer]);

  const handleAddServer = async () => {
    if (!newServerName || !newServerUrl) return;

    try {
      const newServer: McpServerType = {
        id: `custom-${Date.now()}`,
        name: newServerName,
        description: `Custom MCP server at ${newServerUrl}`,
        serverUrl: newServerUrl,
        tools: [],
        availableTools: [],
        isActive: true,
        isReady: true,
        serverType: 'custom',
        authNeeded: false,
        isAuthenticated: false
      };

      // Add to MongoDB and get back the formatted server
      const formattedServer = await addCustomServer(projectId, newServer);

      // Update local state with the formatted server
      setServers(prev => [...prev, formattedServer]);
      setShowAddServer(false);
      setNewServerName('');
      setNewServerUrl('');

      // Fetch tools for the new server using the formatted URL
      await handleSyncServer(formattedServer);
    } catch (err) {
      console.error('Error adding server:', err);
      setError('Failed to add server. Please try again.');
    }
  };

  const handleRemoveServer = async (server: McpServerType) => {
    // Show confirmation dialog
    const shouldRemove = window.confirm(
      "Are you sure you want to delete this server? Alternatively, you can toggle it OFF if you'd like to retain the configuration but not make it available to agents."
    );

    if (!shouldRemove) return;

    try {
      await removeCustomServer(projectId, server.name);
      // Update local state
      setServers(prev => prev.filter(s => s.name !== server.name));
      // If this server was selected, close the tool management panel
      if (selectedServer?.name === server.name) {
        setSelectedServer(null);
      }
    } catch (err) {
      console.error('Error removing server:', err);
      setError('Failed to remove server. Please try again.');
    }
  };

  const handleSaveToolSelection = async () => {
    if (!selectedServer || !projectId) return;
    
    setSavingTools(true);
    try {
      const availableTools = selectedServer.availableTools || [];
      const selectedToolsList = availableTools.filter(tool => selectedTools.has(tool.id));
      
      await updateCustomServerTools(
        projectId,
        selectedServer.name,
        selectedToolsList,
        availableTools
      );
      
      setServers(prevServers => {
        return prevServers.map(s => {
          if (s.name === selectedServer.name) {
            return {
              ...s,
              tools: selectedToolsList
            };
          }
          return s;
        });
      });

      setSelectedServer(prev => {
        if (!prev) return null;
        return {
          ...prev,
          tools: selectedToolsList
        };
      });
      
      setHasToolChanges(false);
    } catch (error) {
      console.error('Error saving tool selection:', error);
    } finally {
      setSavingTools(false);
    }
  };

  const filteredServers = servers.filter(server => {
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
  });

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg p-4">
        <div className="flex gap-3">
          <div className="flex-shrink-0">
            <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <p className="text-sm text-blue-700 dark:text-blue-300">
            Add your own MCP servers here. These servers will be available to agents in the Build view once toggled ON.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <Button
          size="sm"
          variant="primary"
          onClick={() => setShowAddServer(true)}
        >
          <div className="inline-flex items-center">
            <Plus className="h-4 w-4" />
            <span className="ml-2">Add Server</span>
          </div>
        </Button>
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
        </div>
      </div>

      <Modal
        isOpen={showAddServer}
        onClose={() => {
          setShowAddServer(false);
          setNewServerName('');
          setNewServerUrl('');
        }}
        title="Add Custom MCP Server"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Server Name
            </label>
            <input
              type="text"
              value={newServerName}
              onChange={(e) => setNewServerName(e.target.value)}
              placeholder="e.g., My Custom Server"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-md 
                bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100
                focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Server URL
            </label>
            <input
              type="text"
              value={newServerUrl}
              onChange={(e) => setNewServerUrl(e.target.value)}
              placeholder="e.g., http://localhost:3000"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-md 
                bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100
                focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setShowAddServer(false);
                setNewServerName('');
                setNewServerUrl('');
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={handleAddServer}
              disabled={!newServerName || !newServerUrl}
            >
              Add Server
            </Button>
          </div>
        </div>
      </Modal>

      {loading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-800 dark:border-gray-200 mx-auto"></div>
          <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">Loading servers...</p>
        </div>
      ) : error ? (
        <div className="text-center py-8 text-red-500 dark:text-red-400">{error}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredServers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              onToggle={() => handleToggleServer(server)}
              onManageTools={() => setSelectedServer(server)}
              onSync={() => handleSyncServer(server)}
              onRemove={() => handleRemoveServer(server)}
              isToggling={togglingServers.has(server.name)}
              isSyncing={syncingServers.has(server.name)}
              operation={serverOperations.get(server.name)}
              error={error && error.includes(server.name) ? { message: error } : undefined}
              showAuth={false}
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