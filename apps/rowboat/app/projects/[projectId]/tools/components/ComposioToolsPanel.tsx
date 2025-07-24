'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { PictureImg } from '@/components/ui/picture-img';
import { Button, Checkbox, Input } from '@heroui/react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { Workflow, WorkflowTool } from '@/app/lib/types/workflow_types';
import { listTools } from '@/app/actions/composio_actions';
import { z } from 'zod';
import { ZTool, ZListResponse } from '@/app/lib/composio/composio';
import { SlidePanel } from '@/components/ui/slide-panel';

type ToolType = z.infer<typeof ZTool>;
type ToolListResponse = z.infer<ReturnType<typeof ZListResponse<typeof ZTool>>>;

interface ComposioToolsPanelProps {
  toolkit: {
    slug: string;
    name: string;
    meta: {
      logo: string;
    };
    no_auth?: boolean;
  };
  isOpen: boolean;
  onClose: () => void;
  tools: z.infer<typeof Workflow.shape.tools>;
  onAddTool: (tool: z.infer<typeof WorkflowTool>) => void;
}

export function ComposioToolsPanel({ 
  toolkit, 
  isOpen, 
  onClose, 
  tools: workflowTools,
  onAddTool,
}: ComposioToolsPanelProps) {
  const params = useParams();
  const projectId = typeof params.projectId === 'string' ? params.projectId : params.projectId?.[0];
  if (!projectId) throw new Error('Project ID is required');
  
  const [tools, setTools] = useState<ToolType[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());
  const [hasChanges, setHasChanges] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

  const selectedToolSlugs = workflowTools
    .filter(tool => tool.isComposio && tool.composioData?.toolkitSlug === toolkit.slug)
    .map(tool => tool.composioData!.slug);

  // Filter out already selected tools
  const availableTools = tools.filter(tool => !selectedToolSlugs.includes(tool.slug));

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadToolsForToolkit = useCallback(async (toolkitSlug: string, cursor: string | null = null, search: string | null = null) => {
    try {
      setToolsLoading(true);
      
      const response: ToolListResponse = await listTools(projectId, toolkitSlug, search, cursor);
      
      setTools(response.items);
      setNextCursor(response.next_cursor);
      
      if (cursor === null) {
        // First page - reset pagination state
        setCurrentCursor(null);
        setCursorHistory([]);
      }
    } catch (err: any) {
      console.error('Error fetching tools:', err);
      setTools([]);
    } finally {
      setToolsLoading(false);
    }
  }, [projectId]);

  // Load tools when search query changes
  useEffect(() => {
    if (toolkit && isOpen) {
      loadToolsForToolkit(toolkit.slug, null, debouncedSearchQuery || null);
    }
  }, [toolkit, isOpen, debouncedSearchQuery, loadToolsForToolkit]);

  const handleNextPage = useCallback(async () => {
    if (!nextCursor) return;
    
    // Add current cursor to history
    setCursorHistory(prev => [...prev, currentCursor || '']);
    setCurrentCursor(nextCursor);
    
    await loadToolsForToolkit(toolkit.slug, nextCursor, debouncedSearchQuery || null);
  }, [nextCursor, toolkit, currentCursor, debouncedSearchQuery, loadToolsForToolkit]);

  const handlePreviousPage = useCallback(async () => {
    if (cursorHistory.length === 0) return;
    
    // Get the previous cursor from history
    const previousCursor = cursorHistory[cursorHistory.length - 1];
    const newHistory = cursorHistory.slice(0, -1);
    
    setCursorHistory(newHistory);
    setCurrentCursor(previousCursor);
    
    await loadToolsForToolkit(toolkit.slug, previousCursor, debouncedSearchQuery || null);
  }, [cursorHistory, toolkit, debouncedSearchQuery, loadToolsForToolkit]);

  const handleToolSelectionChange = useCallback((toolSlug: string, selected: boolean) => {
    setSelectedTools(prev => {
      const next = new Set(prev);
      if (selected) {
        next.add(toolSlug);
      } else {
        next.delete(toolSlug);
      }
      setHasChanges(true);
      return next;
    });
  }, []);

  const handleAddSelectedTools = useCallback(() => {
    // Convert selected tool slugs to actual tool objects and add them
    const selectedToolObjects = tools.filter(tool => selectedTools.has(tool.slug));
    
    selectedToolObjects.forEach(tool => {
      const toolToAdd = {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object' as const,
          properties: tool.input_parameters?.properties || {},
          required: tool.input_parameters?.required || [],
        },
        isComposio: true,
        composioData: {
          slug: tool.slug,
          noAuth: toolkit.no_auth || false,
          toolkitName: toolkit.name,
          toolkitSlug: toolkit.slug,
          logo: toolkit.meta.logo,
        },
      };
      
      onAddTool(toolToAdd);
    });
    
    onClose();
  }, [selectedTools, tools, toolkit, onAddTool, onClose]);

  const handleClose = useCallback(() => {
    setTools([]);
    setSelectedTools(new Set());
    setHasChanges(false);
    setSearchQuery('');
    setDebouncedSearchQuery('');
    onClose();
  }, [onClose]);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  if (!toolkit) return null;

  return (
    <SlidePanel
      isOpen={isOpen}
      onClose={handleClose}
      title={
        <div className="flex items-center gap-3">
          {toolkit.meta.logo && (
            <PictureImg 
              src={toolkit.meta.logo} 
              alt={`${toolkit.name} logo`}
              width={24}
              height={24}
              className="rounded-md object-cover"
            />
          )}
          <span>{toolkit.name}</span>
        </div>
      }
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Select Tools</h4>
            </div>
            {hasChanges && (
              <Button
                variant="solid"
                size="sm"
                color="primary"
                onPress={handleAddSelectedTools}
              >
                Add Selected ({selectedTools.size})
              </Button>
            )}
          </div>

          {/* Search Box */}
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-gray-400" />
            </div>
            <Input
              type="text"
              placeholder="Search tools..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-10"
              size="sm"
            />
            {searchQuery && (
              <button
                onClick={handleClearSearch}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Tools List */}
        <div className="flex-1 overflow-y-auto">
          {toolsLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-800 dark:border-gray-200 mx-auto"></div>
              <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
                {searchQuery ? 'Searching tools...' : 'Loading tools...'}
              </p>
            </div>
          ) : tools.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {searchQuery ? 'No tools found matching your search.' : 'No tools available.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {availableTools.map((tool) => (
                <div 
                  key={tool.slug} 
                  className="group p-4 rounded-lg transition-all duration-200 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      isSelected={selectedTools.has(tool.slug)}
                      onValueChange={(selected) => handleToolSelectionChange(tool.slug, selected)}
                      size="sm"
                    />
                    <div className="flex-1 text-left flex flex-col gap-1">
                      <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors text-left">
                        {tool.name}
                      </h4>
                      <div className="font-mono text-xs text-gray-500 dark:text-gray-400 text-left truncate max-w-[300px] bg-gray-100 dark:bg-gray-700 p-1 rounded-md" title={tool.slug}>
                        {tool.slug}
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 text-left">
                        {tool.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Fixed Pagination Controls */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {availableTools.length > 0 && (
                <span>
                  {availableTools.length} tool{availableTools.length !== 1 ? 's' : ''} found
                  {searchQuery && ` for "${searchQuery}"`}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="bordered"
                size="sm"
                onClick={handlePreviousPage}
                disabled={cursorHistory.length === 0 || toolsLoading}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <Button
                variant="bordered"
                size="sm"
                onClick={handleNextPage}
                disabled={!nextCursor || toolsLoading}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </SlidePanel>
  );
} 