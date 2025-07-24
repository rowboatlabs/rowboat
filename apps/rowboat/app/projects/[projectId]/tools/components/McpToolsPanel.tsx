'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, Checkbox, Input } from '@heroui/react';
import { Search, X } from 'lucide-react';
import { Workflow, WorkflowTool } from '@/app/lib/types/workflow_types';
import { z } from 'zod';
import { SlidePanel } from '@/components/ui/slide-panel';

interface McpToolsPanelProps {
  server: {
    name: string;
    url: string;
  } | null;
  isOpen: boolean;
  onClose: () => void;
  tools: z.infer<typeof Workflow.shape.tools>;
  onAddTool: (tool: z.infer<typeof WorkflowTool>) => void;
  serverTools: z.infer<typeof WorkflowTool>[];
  toolsLoading: boolean;
  toolsError: string | null;
}

export function McpToolsPanel({ 
  server, 
  isOpen, 
  onClose, 
  tools: workflowTools,
  onAddTool,
  serverTools,
  toolsLoading,
  toolsError,
}: McpToolsPanelProps) {
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());
  const [hasChanges, setHasChanges] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

  // Filter out already selected tools
  const selectedToolNames = workflowTools
    .filter(tool => tool.isMcp && tool.mcpServerName === server?.name)
    .map(tool => tool.name);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Filter tools based on search query
  const filteredTools = useMemo(() => {
    if (!debouncedSearchQuery) return serverTools;
    
    const query = debouncedSearchQuery.toLowerCase();
    return serverTools.filter(tool => 
      tool.name.toLowerCase().includes(query) || 
      tool.description.toLowerCase().includes(query)
    );
  }, [serverTools, debouncedSearchQuery]);

  // Filter out already added tools
  const availableTools = filteredTools.filter(tool => !selectedToolNames.includes(tool.name));

  const handleToolSelectionChange = useCallback((toolName: string, selected: boolean) => {
    setSelectedTools(prev => {
      const next = new Set(prev);
      if (selected) {
        next.add(toolName);
      } else {
        next.delete(toolName);
      }
      setHasChanges(true);
      return next;
    });
  }, []);

  const handleAddSelectedTools = useCallback(() => {
    // Convert selected tool names to actual tool objects and add them
    const selectedToolObjects = serverTools.filter(tool => selectedTools.has(tool.name));
    
    selectedToolObjects.forEach(tool => {
      onAddTool(tool);
    });
    
    onClose();
  }, [selectedTools, serverTools, onAddTool, onClose]);

  const handleClose = useCallback(() => {
    setSelectedTools(new Set());
    setHasChanges(false);
    setSearchQuery('');
    setDebouncedSearchQuery('');
    onClose();
  }, [onClose]);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  if (!server) return null;

  return (
    <SlidePanel
      isOpen={isOpen}
      onClose={handleClose}
      title={
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 bg-blue-500 rounded-md flex items-center justify-center">
            <span className="text-white text-xs font-bold">MCP</span>
          </div>
          <span>{server.name}</span>
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

        {/* Error Display */}
        {toolsError && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-700 dark:text-red-300">{toolsError}</p>
          </div>
        )}

        {/* Scrollable Tools List */}
        <div className="flex-1 overflow-y-auto">
          {toolsLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-800 dark:border-gray-200 mx-auto"></div>
              <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
                {searchQuery ? 'Searching tools...' : 'Loading tools...'}
              </p>
            </div>
          ) : availableTools.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {searchQuery ? 'No tools found matching your search.' : 'No tools available.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {availableTools.map((tool) => (
                <div 
                  key={tool.name} 
                  className="group p-4 rounded-lg transition-all duration-200 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      isSelected={selectedTools.has(tool.name)}
                      onValueChange={(selected) => handleToolSelectionChange(tool.name, selected)}
                      size="sm"
                    />
                    <div className="flex-1 text-left flex flex-col gap-1">
                      <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors text-left">
                        {tool.name}
                      </h4>
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

        {/* Fixed Footer */}
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
                onPress={handleAddSelectedTools}
                disabled={selectedTools.size === 0}
              >
                Add Selected ({selectedTools.size})
              </Button>
            </div>
          </div>
        </div>
      </div>
    </SlidePanel>
  );
} 