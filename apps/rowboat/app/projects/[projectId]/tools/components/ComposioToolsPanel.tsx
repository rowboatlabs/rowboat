'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { PictureImg } from '@/components/ui/picture-img';
import { Button, Checkbox } from '@heroui/react';
import { ChevronLeft, ChevronRight, LinkIcon, Loader2, UnlinkIcon } from 'lucide-react';
import { listTools, deleteConnectedAccount } from '@/app/actions/composio_actions';
import { z } from 'zod';
import { ZTool, ZListResponse } from '@/app/lib/composio/composio';
import { SlidePanel } from '@/components/ui/slide-panel';
import { Project } from '@/app/lib/types/project_types';
import { ToolkitAuthModal } from './ToolkitAuthModal';

type ToolType = z.infer<typeof ZTool>;
type ToolListResponse = z.infer<ReturnType<typeof ZListResponse<typeof ZTool>>>;
type ProjectType = z.infer<typeof Project>;

interface ComposioToolsPanelProps {
  toolkit: {
    slug: string;
    name: string;
    meta: {
      logo: string;
    };
    no_auth?: boolean;
  } | null;
  isOpen: boolean;
  onClose: () => void;
  projectConfig: ProjectType | null;
  onUpdateToolsSelection: (selectedToolObjects: ToolType[]) => void;
  onProjectConfigUpdate: () => void;
  onRemoveToolkitTools: (toolkitSlug: string) => void;
  isSaving: boolean;
}

export function ComposioToolsPanel({ 
  toolkit, 
  isOpen, 
  onClose, 
  projectConfig,
  onUpdateToolsSelection,
  onProjectConfigUpdate,
  onRemoveToolkitTools,
  isSaving
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
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isProcessingAuth, setIsProcessingAuth] = useState(false);

  const loadToolsForToolkit = useCallback(async (toolkitSlug: string, cursor: string | null = null) => {
    try {
      setToolsLoading(true);
      
      const response: ToolListResponse = await listTools(projectId, toolkitSlug, cursor);
      
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

  const handleNextPage = useCallback(async () => {
    if (!nextCursor || !toolkit) return;
    
    // Add current cursor to history
    setCursorHistory(prev => [...prev, currentCursor || '']);
    setCurrentCursor(nextCursor);
    
    await loadToolsForToolkit(toolkit.slug, nextCursor);
  }, [nextCursor, toolkit, currentCursor, loadToolsForToolkit]);

  const handlePreviousPage = useCallback(async () => {
    if (cursorHistory.length === 0 || !toolkit) return;
    
    // Get the previous cursor from history
    const previousCursor = cursorHistory[cursorHistory.length - 1];
    const newHistory = cursorHistory.slice(0, -1);
    
    setCursorHistory(newHistory);
    setCurrentCursor(previousCursor);
    
    await loadToolsForToolkit(toolkit.slug, previousCursor);
  }, [cursorHistory, toolkit, loadToolsForToolkit]);

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

  const handleSaveTools = useCallback(async () => {
    // Convert selected tool slugs to actual tool objects
    const selectedToolObjects = tools.filter(tool => selectedTools.has(tool.slug));
    await onUpdateToolsSelection(selectedToolObjects);
    setHasChanges(false);
  }, [onUpdateToolsSelection, selectedTools, tools]);

  const handleConnect = useCallback(() => {
    setShowAuthModal(true);
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (!toolkit) return;
    
    const connectedAccountId = projectConfig?.composioConnectedAccounts?.[toolkit.slug]?.id;
    
    setIsProcessingAuth(true);
    try {
      if (connectedAccountId) {
        await deleteConnectedAccount(projectId, toolkit.slug, connectedAccountId);
        onProjectConfigUpdate();
        onRemoveToolkitTools(toolkit.slug);
      }
    } catch (err: any) {
      console.error('Disconnect failed:', err);
    } finally {
      setIsProcessingAuth(false);
    }
  }, [projectId, toolkit, projectConfig, onProjectConfigUpdate, onRemoveToolkitTools]);

  const handleAuthComplete = useCallback(() => {
    setShowAuthModal(false);
    onProjectConfigUpdate();
  }, [onProjectConfigUpdate]);

  const handleClose = useCallback(() => {
    setTools([]);
    setSelectedTools(new Set());
    setHasChanges(false);
    if (hasChanges) {
      if (window.confirm('You have unsaved changes. Are you sure you want to close?')) {
        onClose();
      }
    } else {
      onClose();
    }
  }, [onClose, hasChanges]);

  // Initialize selected tools from project config when opening the panel
  useEffect(() => {
    if (toolkit && isOpen && projectConfig?.composioSelectedTools) {
      const toolSlugs = new Set(projectConfig.composioSelectedTools.map(tool => tool.slug));
      setSelectedTools(toolSlugs);
      setHasChanges(false);
    }
  }, [toolkit, isOpen, projectConfig]);

  useEffect(() => {
    if (toolkit && isOpen) {
      loadToolsForToolkit(toolkit.slug, null);
    }
  }, [toolkit, isOpen, loadToolsForToolkit]);

  if (!toolkit) return null;

  // Check if the toolkit is connected (has an active connected account) or doesn't require auth
  const isToolkitConnected = toolkit.no_auth || projectConfig?.composioConnectedAccounts?.[toolkit.slug]?.status === 'ACTIVE';

  return (
    <>
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
          {/* Connection Status Banner */}
          {!toolkit.no_auth && (
            <div className={`mb-6 p-4 rounded-lg border-2 ${
              isToolkitConnected 
                ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' 
                : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${
                    isToolkitConnected ? 'bg-emerald-500' : 'bg-blue-500'
                  }`}></div>
                  <div>
                    <h3 className={`font-semibold text-sm ${
                      isToolkitConnected 
                        ? 'text-emerald-800 dark:text-emerald-200' 
                        : 'text-blue-800 dark:text-blue-200'
                    }`}>
                      {isToolkitConnected ? 'Toolkit Connected' : 'Authentication Required'}
                    </h3>
                    <p className={`text-xs mt-0.5 ${
                      isToolkitConnected 
                        ? 'text-emerald-700 dark:text-emerald-300' 
                        : 'text-blue-700 dark:text-blue-300'
                    }`}>
                      {isToolkitConnected 
                        ? 'You can select and use tools from this toolkit'
                        : 'You can select tools now. Authentication will be required in the build view to use them.'
                      }
                    </p>
                  </div>
                </div>
                {isToolkitConnected && (
                  <Button
                    variant="solid"
                    size="sm"
                    onPress={handleDisconnect}
                    disabled={isProcessingAuth}
                    color="danger"
                    isLoading={isProcessingAuth}
                    startContent={<UnlinkIcon className="h-4 w-4" />}
                  >
                    Disconnect
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Available Tools</h4>
              <div className="flex items-center gap-2">
                {hasChanges && (
                  <Button
                    variant="solid"
                    size="sm"
                    color="primary"
                    onPress={handleSaveTools}
                    disabled={isSaving}
                    isLoading={isSaving}
                  >
                    Save Changes
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Scrollable Tools List */}
          <div className="flex-1 overflow-y-auto">
            {toolsLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-800 dark:border-gray-200 mx-auto"></div>
                <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">Loading tools...</p>
              </div>
            ) : (
              <div className="space-y-4">
                {tools.map((tool) => (
                  <div key={tool.slug} className="group p-4 rounded-lg transition-all duration-200 border border-transparent bg-gray-50/50 dark:bg-gray-800/50 hover:bg-gray-100/50 dark:hover:bg-gray-700/50 hover:border-gray-200 dark:hover:border-gray-600">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        isSelected={selectedTools.has(tool.slug)}
                        onValueChange={(selected) => handleToolSelectionChange(tool.slug, selected)}
                        size="sm"
                      />
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
                ))}
              </div>
            )}
          </div>

          {/* Fixed Pagination Controls */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
            <div className="flex items-center justify-end">
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

      {/* Auth Modal */}
      {toolkit && (
        <ToolkitAuthModal
          key={toolkit.slug}
          isOpen={showAuthModal}
          onClose={() => setShowAuthModal(false)}
          toolkitSlug={toolkit.slug}
          projectId={projectId}
          onComplete={handleAuthComplete}
        />
      )}
    </>
  );
} 