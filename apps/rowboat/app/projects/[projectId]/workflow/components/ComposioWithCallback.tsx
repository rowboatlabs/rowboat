'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Info, RefreshCw, Search } from 'lucide-react';
import clsx from 'clsx';
import { listToolkits, listTools, updateComposioSelectedTools } from '@/app/actions/composio_actions';
import { getProjectConfig } from '@/app/actions/project_actions';
import { z } from 'zod';
import { ZToolkit, ZListResponse, ZTool } from '@/app/lib/composio/composio';
import { Project } from '@/app/lib/types/project_types';
import { ComposioToolsPanel } from '../../tools/components/ComposioToolsPanel';
import { ToolkitCard } from '../../tools/components/ToolkitCard';

type ToolkitType = z.infer<typeof ZToolkit>;
type ToolkitListResponse = z.infer<ReturnType<typeof ZListResponse<typeof ZToolkit>>>;
type ProjectType = z.infer<typeof Project>;

interface ComposioWithCallbackProps {
  onToolsUpdated?: () => void;
}

export function ComposioWithCallback({ onToolsUpdated }: ComposioWithCallbackProps) {
  const params = useParams();
  const projectId = typeof params.projectId === 'string' ? params.projectId : params.projectId?.[0];
  if (!projectId) throw new Error('Project ID is required');
  
  const [toolkits, setToolkits] = useState<ToolkitType[]>([]);
  const [projectConfig, setProjectConfig] = useState<ProjectType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedToolkit, setSelectedToolkit] = useState<ToolkitType | null>(null);
  const [isToolsPanelOpen, setIsToolsPanelOpen] = useState(false);
  const [savingTools, setSavingTools] = useState(false);

  const loadProjectConfig = useCallback(async () => {
    try {
      const config = await getProjectConfig(projectId);
      setProjectConfig(config);
    } catch (err: any) {
      console.error('Error fetching project config:', err);
      setError('Unable to load project configuration.');
    }
  }, [projectId]);

  const loadAllToolkits = useCallback(async () => {
    let cursor: string | null = null;
    let allToolkits: ToolkitType[] = [];
    
    try {
      setLoading(true);
      
      do {
        const response: ToolkitListResponse = await listToolkits(projectId, cursor);
        allToolkits = [...allToolkits, ...response.items];
        cursor = response.next_cursor;
      } while (cursor !== null);
      
      setToolkits(allToolkits);
      setError(null);
    } catch (err: any) {
      setError('Unable to load all Composio toolkits. Please check your connection and try again.');
      console.error('Error fetching all toolkits:', err);
      setToolkits([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const handleManageTools = useCallback((toolkit: ToolkitType) => {
    setSelectedToolkit(toolkit);
    setIsToolsPanelOpen(true);
  }, []);

  const handleCloseToolsPanel = useCallback(() => {
    setSelectedToolkit(null);
    setIsToolsPanelOpen(false);
  }, []);

  const handleProjectConfigUpdate = useCallback(() => {
    loadProjectConfig();
  }, [loadProjectConfig]);

  const handleUpdateToolsSelection = useCallback(async (selectedToolObjects: z.infer<typeof ZTool>[]) => {
    if (!projectId) return;
    
    setSavingTools(true);
    try {
      // Get existing selected tools from project config
      const existingSelectedTools = projectConfig?.composioSelectedTools || [];
      
      // Create a map of existing tools by slug for easy lookup
      const existingToolsMap = new Map(existingSelectedTools.map(tool => [tool.slug, tool]));
      
      // Add or update the new selections
      for (const tool of selectedToolObjects) {
        existingToolsMap.set(tool.slug, tool);
      }
      
      // Convert back to array
      const mergedSelectedTools = Array.from(existingToolsMap.values());
      
      await updateComposioSelectedTools(projectId, mergedSelectedTools);
      
      // Refresh project config to get updated data
      await loadProjectConfig();
      
      // Notify parent component that tools were updated
      if (onToolsUpdated) {
        onToolsUpdated();
      }
    } catch (error) {
      console.error('Error saving tool selection:', error);
    } finally {
      setSavingTools(false);
    }
  }, [projectId, projectConfig, loadProjectConfig, onToolsUpdated]);

  const handleRemoveToolkitTools = useCallback(async (toolkitSlug: string) => {
    if (!projectId) return;
    
    setSavingTools(true);
    try {
      // Get existing selected tools from project config
      const existingSelectedTools = projectConfig?.composioSelectedTools || [];
      
      // Filter out all tools from the specified toolkit
      const filteredSelectedTools = existingSelectedTools.filter(tool => 
        tool.toolkit.slug !== toolkitSlug
      );
      
      await updateComposioSelectedTools(projectId, filteredSelectedTools);
      
      // Refresh project config to get updated data
      await loadProjectConfig();
      
      // Notify parent component that tools were updated
      if (onToolsUpdated) {
        onToolsUpdated();
      }
    } catch (error) {
      console.error('Error removing toolkit tools:', error);
    } finally {
      setSavingTools(false);
    }
  }, [projectId, projectConfig, loadProjectConfig, onToolsUpdated]);

  useEffect(() => {
    loadProjectConfig();
  }, [loadProjectConfig]);

  useEffect(() => {
    loadAllToolkits();
  }, [loadAllToolkits]);

  const filteredToolkits = toolkits.filter(toolkit => {
    const searchLower = searchQuery.toLowerCase();
    return (
      toolkit.name.toLowerCase().includes(searchLower) ||
      toolkit.meta.description.toLowerCase().includes(searchLower) ||
      toolkit.slug.toLowerCase().includes(searchLower)
    );
  }).sort((a, b) => {
    // Sort by actual connection status first (only connected tools, not no-auth)
    const aConnected = !a.no_auth && projectConfig?.composioConnectedAccounts?.[a.slug]?.status === 'ACTIVE';
    const bConnected = !b.no_auth && projectConfig?.composioConnectedAccounts?.[b.slug]?.status === 'ACTIVE';
    
    if (aConnected && !bConnected) return -1;
    if (!aConnected && bConnected) return 1;
    
    // If both have same connection status, maintain original order (don't sort alphabetically)
    return 0;
  });

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-800 dark:border-gray-200 mx-auto"></div>
        <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">Loading Composio toolkits...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh] space-y-6 px-4">
        <p className="text-center text-red-500 dark:text-red-400 max-w-[600px]">
          {error}
        </p>
        <Button 
          variant="secondary"
          onClick={() => {
            loadProjectConfig();
            loadAllToolkits();
          }}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Search Bar */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search toolkits..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
              bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 
              placeholder-gray-500 dark:placeholder-gray-400 
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Toolkits Grid */}
      <div className="flex-1 overflow-y-auto">
        {filteredToolkits.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 dark:text-gray-400">
              {searchQuery ? 'No toolkits found matching your search.' : 'No toolkits available.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredToolkits.map((toolkit) => {
              const isConnected = toolkit.no_auth || projectConfig?.composioConnectedAccounts?.[toolkit.slug]?.status === 'ACTIVE';
              const connectedAccountId = projectConfig?.composioConnectedAccounts?.[toolkit.slug]?.id;
              
              return (
                <ToolkitCard 
                  key={toolkit.slug} 
                  toolkit={toolkit} 
                  projectId={projectId}
                  isConnected={isConnected}
                  connectedAccountId={connectedAccountId}
                  projectConfig={projectConfig}
                  onManageTools={() => handleManageTools(toolkit)}
                  onProjectConfigUpdate={handleProjectConfigUpdate}
                  onRemoveToolkitTools={handleRemoveToolkitTools}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Tools Panel */}
      <ComposioToolsPanel
        toolkit={selectedToolkit}
        isOpen={isToolsPanelOpen}
        onClose={handleCloseToolsPanel}
        projectConfig={projectConfig}
        onUpdateToolsSelection={handleUpdateToolsSelection}
        onProjectConfigUpdate={handleProjectConfigUpdate}
        onRemoveToolkitTools={handleRemoveToolkitTools}
        isSaving={savingTools}
      />
    </div>
  );
}