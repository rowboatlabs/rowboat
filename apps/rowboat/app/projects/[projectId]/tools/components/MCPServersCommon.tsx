'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SlidePanel } from '@/components/ui/slide-panel';
import { Info, RefreshCw, RefreshCcw, Lock } from 'lucide-react';
import { clsx } from 'clsx';
import { MCPServer, McpTool } from '@/app/lib/types/types';
import type { z } from 'zod';

type McpServerType = z.infer<typeof MCPServer>;
type McpToolType = z.infer<typeof McpTool>;

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

interface ServerOperationBannerProps {
  serverName: string;
  operation: 'setup' | 'delete' | 'checking-auth';
}

export function ServerOperationBanner({ serverName, operation }: ServerOperationBannerProps) {
  return (
    <div className="mb-4 bg-blue-50 dark:bg-blue-900/20 
      border border-blue-100 dark:border-blue-800 rounded-lg p-2 text-center text-sm
      text-blue-700 dark:text-blue-300 animate-fadeIn">
      <div className="flex items-center justify-center gap-2">
        <div className="animate-spin rounded-full h-4 w-4 border-2 border-b-transparent border-current" />
        <span>
          {operation === 'setup' ? 'Setting up server...' : 
           operation === 'delete' ? 'Deleting server...' :
           'Checking authentication...'}
        </span>
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
}

export function ToolCard({ 
  tool, 
  server, 
  isSelected, 
  onSelect, 
  showCheckbox = false 
}: ToolCardProps) {
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
        <div className="flex justify-between items-center mb-6">
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ServerLogo serverName={server.name} className="mr-2" />
                <h3 className="font-semibold text-lg text-gray-900 dark:text-gray-100">
                  {server.name}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={server.isActive}
                  onCheckedChange={onToggle}
                  disabled={isToggling}
                  className={clsx(
                    "data-[state=checked]:bg-blue-500 dark:data-[state=checked]:bg-blue-600",
                    "data-[state=unchecked]:bg-gray-200 dark:data-[state=unchecked]:bg-gray-700",
                    isToggling && "opacity-50 cursor-not-allowed"
                  )}
                />
                {onRemove && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={onRemove}
                    className="ml-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2">
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
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-blue-500 to-purple-500"></span>
              {server.serverType === 'hosted' ? 'Klavis AI' : 'Custom Server'}
            </span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 line-clamp-2">
            {server.description}
          </p>
        </div>

        <div className="flex items-center gap-2 mt-auto">
          {showAuth && server.isActive && server.authNeeded && (
            <div className="flex items-center gap-2">
              {!server.isAuthenticated && onAuth && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={onAuth}
                >
                  <div className="inline-flex items-center">
                    <Lock className="h-3.5 w-3.5" />
                    <span className="ml-1.5">Authenticate</span>
                  </div>
                </Button>
              )}
              <div className={clsx(
                "text-xs py-1 px-2 rounded-full",
                server.isAuthenticated 
                  ? "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20"
                  : "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20"
              )}>
                {server.isAuthenticated ? 'Authenticated' : 'Needs Authentication'}
              </div>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {isEligible && onSync && (
              <Button
                size="sm"
                variant="secondary"
                onClick={onSync}
                disabled={isSyncing}
              >
                <div className="inline-flex items-center">
                  <RefreshCcw className={clsx(
                    "h-3.5 w-3.5",
                    isSyncing && "animate-spin"
                  )} />
                  <span className="ml-1.5">
                    {isSyncing ? 'Syncing...' : 'Sync Tools'}
                  </span>
                </div>
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={onManageTools}
            >
              <div className="inline-flex items-center">
                <Info className="h-4 w-4" />
                <span className="ml-1.5">{isEligible ? 'Manage Tools' : 'Tools'}</span>
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
  if (!server) return null;

  const isEligible = server.serverType === 'custom' || 
    (server.isActive && (!server.authNeeded || server.isAuthenticated));

  return (
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
              />
            ))}
          </div>
        </div>
      </div>
    </SlidePanel>
  );
} 