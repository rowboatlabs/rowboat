'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { RefreshCw, Search } from 'lucide-react';
import clsx from 'clsx';
import { listToolkits } from '@/app/actions/composio.actions';
import { getProjectConfig } from '@/app/actions/project.actions';
import { z } from 'zod';
import { ZToolkit, ZListResponse, ZTool } from '@/app/lib/composio/composio';
import { Project } from "@/src/entities/models/project";
import { ToolkitCard } from './ToolkitCard';
import { Workflow } from '@/app/lib/types/workflow_types';

type ToolkitType = z.infer<typeof ZToolkit>;
type ToolkitListResponse = z.infer<ReturnType<typeof ZListResponse<typeof ZToolkit>>>;
type ProjectType = z.infer<typeof Project>;

interface SelectComposioToolkitProps {
  projectId: string;
  tools: z.infer<typeof Workflow.shape.tools>;
  onSelectToolkit: (toolkit: ToolkitType) => void;
  initialToolkitSlug?: string | null;
  filterByTriggers?: boolean; // New prop to filter toolkits that have triggers
  filterByTools?: boolean; // New prop to filter toolkits that have tools
}

export function SelectComposioToolkit({
  projectId,
  tools,
  onSelectToolkit,
  initialToolkitSlug,
  filterByTriggers = false,
  filterByTools = false
}: SelectComposioToolkitProps) {
  const [toolkits, setToolkits] = useState<ToolkitType[]>([]);
  const [projectConfig, setProjectConfig] = useState<ProjectType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

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
      
      // Filter toolkits based on the filter props
      let finalToolkits = allToolkits;
      if (filterByTriggers) {
        finalToolkits = finalToolkits.filter(toolkit => toolkit.meta.triggers_count > 0);
      }
      if (filterByTools) {
        finalToolkits = finalToolkits.filter(toolkit => toolkit.meta.tools_count > 0);
      }
      
      setToolkits(finalToolkits);
      setError(null);
    } catch (err: any) {
      setError('Unable to load all Composio toolkits. Please check your connection and try again.');
      console.error('Error fetching all toolkits:', err);
      setToolkits([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, filterByTriggers, filterByTools]);

  const handleSelectToolkit = useCallback((toolkit: ToolkitType) => {
    onSelectToolkit(toolkit);
  }, [onSelectToolkit]);

  useEffect(() => {
    loadProjectConfig();
  }, [loadProjectConfig]);

  useEffect(() => {
    loadAllToolkits();
  }, [loadAllToolkits]);

  // Auto-select toolkit if initialToolkitSlug is provided
  useEffect(() => {
    if (initialToolkitSlug && toolkits.length > 0) {
      const toolkit = toolkits.find(t => t.slug === initialToolkitSlug);
      if (toolkit) {
        onSelectToolkit(toolkit);
      }
    }
  }, [initialToolkitSlug, toolkits, onSelectToolkit]);

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
        <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
          {filterByTriggers 
            ? 'Loading Composio toolkits with triggers...' 
            : filterByTools 
              ? 'Loading Composio toolkits with tools...'
              : 'Loading Composio toolkits...'
          }
        </p>
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
    <div className="space-y-6">
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 flex items-center gap-4">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-2 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-gray-400 dark:text-gray-500" />
              </div>
              <input
                type="text"
                placeholder={
                  filterByTriggers 
                    ? "Search toolkits with triggers..." 
                    : filterByTools 
                      ? "Search toolkits with tools..."
                      : "Search toolkits..."
                }
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
              {filteredToolkits.length} {filteredToolkits.length === 1 ? 'toolkit' : 'toolkits'}
              {filterByTriggers && ' with triggers'}
              {filterByTools && ' with tools'}
            </div>
            <div className="h-4 w-px bg-gray-200 dark:bg-gray-700" />
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              loadProjectConfig();
              loadAllToolkits();
            }}
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
        {filteredToolkits.map((toolkit) => {
          const isConnected = toolkit.no_auth || projectConfig?.composioConnectedAccounts?.[toolkit.slug]?.status === 'ACTIVE';
          
          return (
            <ToolkitCard 
              key={toolkit.slug} 
              toolkit={toolkit} 
              isConnected={isConnected}
              workflowTools={tools}
              onSelectToolkit={() => handleSelectToolkit(toolkit)}
              showTriggerCounts={filterByTriggers}
            />
          );
        })}
      </div>

      {filteredToolkits.length === 0 && !loading && (
        <div className="text-center py-12">
          <p className="text-gray-500 dark:text-gray-400">
            {searchQuery 
              ? 'No toolkits found matching your search.' 
              : filterByTriggers 
                ? 'No toolkits with triggers available.' 
                : filterByTools
                  ? 'No toolkits with tools available.'
                  : 'No toolkits available.'
            }
          </p>
        </div>
      )}
    </div>
  );
} 