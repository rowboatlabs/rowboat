'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SlidePanel } from '@/components/ui/slide-panel';
import { Info, RefreshCw, RefreshCcw, Lock, Wrench } from 'lucide-react';
import { clsx } from 'clsx';
import { MCPServer, McpTool } from '@/app/lib/types/types';
import type { z } from 'zod';
import { TestToolModal } from './TestToolModal';

type McpServerType = z.infer<typeof MCPServer>;
type McpToolType = z.infer<typeof McpTool>;

interface ServerLogoProps {
  serverName: string;
  className?: string;
  fallback?: React.ReactNode;
}

export function ServerLogo({ serverName, className = "", fallback }: ServerLogoProps) {
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
    'Google Sheets': '/mcp-server-images/gsheets.svg',
    'Google Calendar': '/mcp-server-images/gcalendar.svg',
    'Gmail': '/mcp-server-images/gmail.svg',
  };

  const logoPath = logoMap[serverName];
  
  if (!logoPath) return fallback || null;

  return (
    <div className={`relative w-6 h-6 ${className}`}>
      <Image
        src={logoPath}
        alt={`${serverName} logo`}
        fill
        sizes="16px"
        className="object-contain"
      />
    </div>
  );
}

interface ServerOperationBannerProps {
  serverName: string;
  operation: 'setup' | 'delete' | 'checking-auth';
}

export function ServerOperationBanner({ serverName, operation }: ServerOperationBannerProps) {
  const getMessage = () => {
    switch (operation) {
      case 'setup':
        return 'Setting up server (~10s)';
      case 'delete':
        return 'Removing server (~10s)';
      case 'checking-auth':
        return 'Checking authentication';
      default:
        return 'Processing';
    }
  };

  const getMessageColor = () => {
    switch (operation) {
      case 'setup':
        return 'text-emerald-600 dark:text-emerald-400';
      case 'delete':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-gray-600 dark:text-gray-400';
    }
  };

  return (
    <div className="mb-4 text-sm animate-fadeIn">
      <div className="flex flex-col gap-1 bg-gray-50 dark:bg-gray-800/50 rounded-md p-3">
        <div className="flex items-center gap-2">
          <div className="animate-spin rounded-full h-3 w-3 border-2 border-b-transparent border-current" />
          <span className={`font-medium ${getMessageColor()}`}>{getMessage()}</span>
        </div>
        <div className="text-gray-500 dark:text-gray-400 pl-5">
          You can safely navigate away from this page
        </div>
      </div>
    </div>
  );
}

interface ToolCardProps {
  tool: McpToolType;
  server: McpServerType;
  isSelected?: boolean;
  onSelect?: (selected: boolean) => void;
  showCheckbox?: boolean;
  onTest?: (tool: McpToolType) => void;
  isServerReady?: boolean;
}

export function ToolCard({ 
  tool, 
  server, 
  isSelected, 
  onSelect, 
  showCheckbox = false,
  onTest,
  isServerReady = false
}: ToolCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const toolCardStyles = {
    base: clsx(
      "group p-4 rounded-lg transition-all duration-200",
      "bg-gray-50/50 dark:bg-gray-800/50",
      "hover:bg-gray-100/50 dark:hover:bg-gray-700/50",
      "border border-transparent",
      "hover:border-gray-200 dark:hover:border-gray-600"
    ),
  };

  return (
    <div className={toolCardStyles.base}>
      <div className="flex items-start gap-3">
        {showCheckbox && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => onSelect?.(e.target.checked)}
            className="mt-1"
          />
        )}
        <div className="flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                {tool.name}
              </h4>
              <div>
                <p className={clsx(
                  "text-sm text-gray-500 dark:text-gray-400",
                  !isExpanded && "line-clamp-3"
                )}>
                  {tool.description}
                </p>
                {tool.description.length > 150 && (
                  <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 mt-1"
                  >
                    {isExpanded ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
            </div>
            {onTest && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onTest(tool)}
                disabled={!isServerReady}
                className="shrink-0 bg-blue-50 dark:bg-blue-900/20 
                  text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 
                  hover:text-blue-800 dark:hover:text-blue-200"
              >
                Test
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface ServerCardProps {
  server: McpServerType;
  onToggle: () => void;
  onManageTools: () => void;
  onSync?: () => void;
  onAuth?: () => void;
  onRemove?: () => void;
  isToggling: boolean;
  isSyncing?: boolean;
  operation?: 'setup' | 'delete' | 'checking-auth';
  error?: { message: string };
  showAuth?: boolean;
}

export function ServerCard({
  server,
  onToggle,
  onManageTools,
  onSync,
  onAuth,
  onRemove,
  isToggling,
  isSyncing,
  operation,
  error,
  showAuth = false
}: ServerCardProps) {
  const isEligible = server.serverType === 'custom' || 
    (server.isActive && (!server.authNeeded || server.isAuthenticated));

  return (
    <div className="relative border-2 border-gray-200/80 dark:border-gray-700/80 rounded-xl p-6 
      bg-white dark:bg-gray-900 shadow-sm dark:shadow-none 
      backdrop-blur-sm hover:shadow-md dark:hover:shadow-none 
      transition-all duration-200 min-h-[280px]
      hover:border-blue-200 dark:hover:border-blue-900">
      <div className="flex flex-col h-full">
        {operation && (
          <ServerOperationBanner 
            serverName={server.name} 
            operation={operation} 
          />
        )}
        <div className="flex justify-between items-start mb-6 flex-wrap gap-2">
          <div className="flex-1 min-w-[200px]">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <ServerLogo serverName={server.name} className="mr-2" />
                <h3 className="font-semibold text-lg text-gray-900 dark:text-gray-100">
                  {server.name}
                </h3>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Switch
                  checked={server.isActive}
                  onCheckedChange={onToggle}
                  disabled={isToggling}
                  className={clsx(
                    "data-[state=checked]:bg-blue-500 dark:data-[state=checked]:bg-blue-600",
                    "data-[state=unchecked]:bg-gray-200 dark:data-[state=unchecked]:bg-gray-700",
                    isToggling && "opacity-50 cursor-not-allowed",
                    "scale-75"
                  )}
                />
                {onRemove && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={onRemove}
                    disabled={isToggling}
                    className="ml-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {server.availableTools && server.availableTools.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-xs font-medium 
                  bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300">
                  {server.availableTools.length} tools available
                </span>
              )}
              {isEligible && server.tools.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-xs font-medium 
                  bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300">
                  {server.tools.length} tools selected
                </span>
              )}
            </div>
            {error && (
              <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 
                py-1 px-2 rounded-md mt-2 animate-fadeIn">
                {error.message}
              </div>
            )}
          </div>
        </div>
        
        <div className="flex-1">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 line-clamp-2">
            {server.description}
          </p>
        </div>

        <div className="flex items-end gap-2 mt-auto flex-wrap">
          {showAuth && server.isActive && server.authNeeded && (
            <div className="flex flex-col items-start gap-1 mb-0">
              {!server.isAuthenticated && onAuth && (
                <>
                  <span className="text-xs font-medium text-orange-600 dark:text-orange-400 mb-1">
                    Needs authentication!
                  </span>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={onAuth}
                    disabled={isToggling}
                    className="text-xs shrink-0"
                  >
                    <div className="inline-flex items-center">
                      <Lock className="h-3.5 w-3.5" />
                      <span className="ml-1.5">Auth</span>
                    </div>
                  </Button>
                </>
              )}
              {server.isAuthenticated && (
                <div className="text-xs py-1 px-2 rounded-full shrink-0 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20">
                  Authenticated
                </div>
              )}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {isEligible && onSync && (
              <Button
                size="sm"
                variant="secondary"
                onClick={onSync}
                disabled={isSyncing || isToggling}
                className="text-xs shrink-0"
              >
                <div className="inline-flex items-center">
                  <RefreshCcw className={clsx(
                    "h-3.5 w-3.5",
                    isSyncing && "animate-spin"
                  )} />
                  <span className="ml-1.5">
                    {isSyncing ? 'Syncing...' : 'Sync'}
                  </span>
                </div>
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={onManageTools}
              disabled={isToggling}
              className="text-xs shrink-0"
            >
              <div className="inline-flex items-center">
                <Wrench className="h-3.5 w-3.5" />
                <span className="ml-1.5">{isEligible ? 'Tools' : 'Tools'}</span>
              </div>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ToolManagementPanelProps {
  server: McpServerType | null;
  onClose: () => void;
  selectedTools: Set<string>;
  onToolSelectionChange: (toolId: string, selected: boolean) => void;
  onSaveTools: () => void;
  onSyncTools?: () => void;
  hasChanges: boolean;
  isSaving: boolean;
  isSyncing?: boolean;
}

export function ToolManagementPanel({
  server,
  onClose,
  selectedTools,
  onToolSelectionChange,
  onSaveTools,
  onSyncTools,
  hasChanges,
  isSaving,
  isSyncing
}: ToolManagementPanelProps) {
  const [testingTool, setTestingTool] = useState<McpToolType | null>(null);
  
  if (!server) return null;

  const isEligible = server.serverType === 'custom' || 
    (server.isActive && (!server.authNeeded || server.isAuthenticated));

  return (
    <>
      <SlidePanel
        isOpen={!!server}
        onClose={() => {
          if (hasChanges) {
            if (window.confirm('You have unsaved changes. Are you sure you want to close?')) {
              onClose();
            }
          } else {
            onClose();
          }
        }}
        title={server.name}
      >
        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Available Tools</h4>
              </div>
              {isEligible && (
                <div className="flex items-center gap-2">
                  {onSyncTools && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={onSyncTools}
                      disabled={isSyncing}
                    >
                      <div className="inline-flex items-center">
                        <RefreshCcw className={clsx(
                          "h-3.5 w-3.5",
                          isSyncing && "animate-spin"
                        )} />
                        <span className="ml-1.5">
                          {isSyncing ? 'Syncing...' : 'Sync'}
                        </span>
                      </div>
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const allTools = new Set<string>(server.availableTools?.map((t: McpToolType) => t.id) || []);
                      const shouldSelectAll = selectedTools.size !== allTools.size;
                      Array.from(allTools).forEach((toolId: string) => {
                        onToolSelectionChange(toolId, shouldSelectAll);
                      });
                    }}
                  >
                    {selectedTools.size === (server.availableTools || []).length ? 'Deselect All' : 'Select All'}
                  </Button>
                  {hasChanges && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={onSaveTools}
                      disabled={isSaving}
                    >
                      {isSaving ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-2 border-b-transparent border-white mr-2" />
                          Saving...
                        </>
                      ) : (
                        'Save Changes'
                      )}
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-4">
              {(server.availableTools || []).map((tool: McpToolType) => (
                <ToolCard
                  key={tool.id}
                  tool={tool}
                  server={server}
                  isSelected={selectedTools.has(tool.id)}
                  onSelect={(selected) => onToolSelectionChange(tool.id, selected)}
                  showCheckbox={isEligible}
                  onTest={(tool) => setTestingTool(tool)}
                  isServerReady={isEligible}
                />
              ))}
            </div>
          </div>
        </div>
      </SlidePanel>

      {testingTool && (
        <TestToolModal
          isOpen={!!testingTool}
          onClose={() => setTestingTool(null)}
          tool={testingTool}
          server={server}
        />
      )}
    </>
  );
} 