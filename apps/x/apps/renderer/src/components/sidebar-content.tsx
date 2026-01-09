"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import {
  ArrowDownAZ,
  CalendarDays,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Database,
  File,
  FilePlus,
  Folder,
  FolderPlus,
  Loader2,
  Mail,
  MessageSquare,
  MessageSquarePlus,
  Microscope,
  Network,
  Plug,
  Plus,
} from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarRail,
} from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { useSidebarSection } from "@/contexts/sidebar-context"
import { useOAuth, useAvailableProviders } from "@/hooks/useOAuth"
import { toast } from "@/lib/toast"

interface TreeNode {
  path: string
  name: string
  kind: "file" | "dir"
  children?: TreeNode[]
  loaded?: boolean
}

type SidebarContentPanelProps = {
  tree: TreeNode[]
  selectedPath: string | null
  expandedPaths: Set<string>
  onSelectFile: (path: string, kind: "file" | "dir") => void
  chats: { id: string; title: string; preview: string; time: string }[]
} & React.ComponentProps<typeof Sidebar>

const sectionTitles = {
  "ask-ai": "Ask AI",
  knowledge: "Knowledge",
  agents: "Agents",
}

const quickActions = [
  { icon: FilePlus, label: "New Note", action: () => console.log("New note") },
  { icon: FolderPlus, label: "New Folder", action: () => console.log("New folder") },
  { icon: Network, label: "Graph View", action: () => console.log("Graph view") },
  { icon: ArrowDownAZ, label: "Sort", action: () => console.log("Sort") },
]

const agentPresets = [
  {
    name: "Email Assistant",
    description: "Draft replies, summarize threads.",
    icon: Mail,
  },
  {
    name: "Meeting Prep",
    description: "Build briefs and talking points.",
    icon: CalendarDays,
  },
  {
    name: "Research",
    description: "Gather sources, outline findings.",
    icon: Microscope,
  },
]

/**
 * Hook for managing Granola sync config
 */
function useGranolaConfig() {
  const [enabled, setEnabled] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState<boolean>(true)

  const loadConfig = useCallback(async () => {
    try {
      setIsLoading(true)
      const result = await window.ipc.invoke('granola:getConfig', null)
      setEnabled(result.enabled)
    } catch (error) {
      console.error('Failed to load Granola config:', error)
      setEnabled(false)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  const updateConfig = useCallback(async (newEnabled: boolean) => {
    try {
      setIsLoading(true)
      await window.ipc.invoke('granola:setConfig', { enabled: newEnabled })
      setEnabled(newEnabled)
      toast(
        newEnabled ? 'Granola sync enabled' : 'Granola sync disabled',
        'success'
      )
    } catch (error) {
      console.error('Failed to update Granola config:', error)
      toast('Failed to update Granola sync settings', 'error')
    } finally {
      setIsLoading(false)
    }
  }, [])

  return { enabled, isLoading, updateConfig }
}

export function SidebarContentPanel({
  tree,
  selectedPath,
  expandedPaths,
  onSelectFile,
  chats,
  ...props
}: SidebarContentPanelProps) {
  const { activeSection } = useSidebarSection()
  const [allExpanded, setAllExpanded] = React.useState(false)

  const toggleExpandAll = () => {
    setAllExpanded(!allExpanded)
  }

  return (
    <Sidebar className="border-r-0" {...props}>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <span className="font-semibold text-lg">{sectionTitles[activeSection]}</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {activeSection === "ask-ai" && (
          <ChatSection chats={chats} />
        )}
        {activeSection === "knowledge" && (
          <KnowledgeSection
            tree={tree}
            selectedPath={selectedPath}
            expandedPaths={expandedPaths}
            onSelectFile={onSelectFile}
            allExpanded={allExpanded}
            onToggleExpandAll={toggleExpandAll}
          />
        )}
        {activeSection === "agents" && (
          <AgentsSection />
        )}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}

// Chat Section
function ChatSection({ chats }: { chats: { id: string; title: string; preview: string; time: string }[] }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="flex items-center justify-between">
        <span>Recent Chats</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded p-1 transition-colors">
              <MessageSquarePlus className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">New Chat</TooltipContent>
        </Tooltip>
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {chats.map((chat) => (
            <SidebarMenuItem key={chat.id}>
              <SidebarMenuButton className="h-auto items-start gap-2 py-2">
                <MessageSquare className="mt-0.5 size-4" />
                <div className="flex flex-1 flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{chat.title}</span>
                    <span className="text-xs text-muted-foreground">{chat.time}</span>
                  </div>
                  <span className="truncate text-xs text-muted-foreground">{chat.preview}</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

// Knowledge Section
function KnowledgeSection({
  tree,
  selectedPath,
  expandedPaths,
  onSelectFile,
  allExpanded,
  onToggleExpandAll,
}: {
  tree: TreeNode[]
  selectedPath: string | null
  expandedPaths: Set<string>
  onSelectFile: (path: string, kind: "file" | "dir") => void
  allExpanded: boolean
  onToggleExpandAll: () => void
}) {
  return (
    <SidebarGroup>
      <div className="flex items-center justify-center gap-1 py-1">
        {quickActions.map((action) => (
          <Tooltip key={action.label}>
            <TooltipTrigger asChild>
              <button
                onClick={action.action}
                className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded p-1.5 transition-colors"
              >
                <action.icon className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{action.label}</TooltipContent>
          </Tooltip>
        ))}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onToggleExpandAll}
              className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded p-1.5 transition-colors"
            >
              {allExpanded ? (
                <ChevronsDownUp className="size-4" />
              ) : (
                <ChevronsUpDown className="size-4" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {allExpanded ? "Collapse All" : "Expand All"}
          </TooltipContent>
        </Tooltip>
      </div>
      <SidebarGroupContent>
        <SidebarMenu>
          {tree.map((item, index) => (
            <Tree
              key={index}
              item={item}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onSelect={onSelectFile}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

// Tree component for file browser
function Tree({
  item,
  selectedPath,
  expandedPaths,
  onSelect,
}: {
  item: TreeNode
  selectedPath: string | null
  expandedPaths: Set<string>
  onSelect: (path: string, kind: "file" | "dir") => void
}) {
  const hasChildren = item.children && item.children.length > 0
  const isExpanded = expandedPaths.has(item.path)
  const isSelected = selectedPath === item.path

  if (!hasChildren) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive={isSelected}
          onClick={() => onSelect(item.path, item.kind)}
        >
          <File className="size-4" />
          <span>{item.name}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  return (
    <SidebarMenuItem>
      <Collapsible
        open={isExpanded}
        onOpenChange={() => onSelect(item.path, item.kind)}
        className="group/collapsible [&[data-state=open]>button>svg:first-child]:rotate-90"
      >
        <CollapsibleTrigger asChild>
          <SidebarMenuButton>
            <ChevronRight className="transition-transform size-4" />
            <Folder className="size-4" />
            <span>{item.name}</span>
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.children!.map((subItem, index) => (
              <Tree
                key={index}
                item={subItem}
                selectedPath={selectedPath}
                expandedPaths={expandedPaths}
                onSelect={onSelect}
              />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  )
}

// Agents Section with Connected Accounts
function AgentsSection() {
  return (
    <>
      {/* Agent Presets */}
      <SidebarGroup>
        <SidebarGroupLabel className="flex items-center justify-between">
          <span>Agent Presets</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded p-1 transition-colors">
                <Plus className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">New Agent</TooltipContent>
          </Tooltip>
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {agentPresets.map((agent) => (
              <SidebarMenuItem key={agent.name}>
                <SidebarMenuButton className="h-auto items-start gap-2 py-2">
                  <agent.icon className="mt-0.5 size-4" />
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">{agent.name}</span>
                    <span className="text-xs text-muted-foreground">{agent.description}</span>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {/* Connectors (Connected Accounts) */}
      <ConnectorsSection />

      {/* Data Sources */}
      <DataSourcesSection />
    </>
  )
}

// Data Sources Section (Granola sync, etc.)
function DataSourcesSection() {
  const { enabled: granolaEnabled, isLoading: granolaLoading, updateConfig: updateGranolaConfig } = useGranolaConfig()

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Data Sources</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-2 px-2 py-1.5 w-full">
              <Switch
                checked={granolaEnabled}
                onCheckedChange={updateGranolaConfig}
                disabled={granolaLoading}
                className="shrink-0"
              />
              <Database className="size-4 shrink-0" />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="truncate text-sm">Granola Sync</span>
                <span className="text-xs text-muted-foreground truncate">
                  Sync notes from Granola
                </span>
              </div>
              {granolaLoading && (
                <Loader2 className="size-3 animate-spin shrink-0" />
              )}
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

// Connectors Section (formerly Connected Accounts)
function ConnectorsSection() {
  const { providers, isLoading: providersLoading } = useAvailableProviders()

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Connectors</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {providersLoading ? (
            <SidebarMenuItem>
              <SidebarMenuButton disabled>
                <Loader2 className="animate-spin size-4" />
                <span>Loading...</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : providers.length === 0 ? (
            <SidebarMenuItem>
              <SidebarMenuButton disabled>
                <span className="text-muted-foreground">No connectors available</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : (
            providers.map((provider) => (
              <ProviderItem key={provider} provider={provider} />
            ))
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function ProviderItem({ provider }: { provider: string }) {
  const { isConnected, isLoading, isConnecting, connect, disconnect } = useOAuth(provider)
  const providerDisplayName = provider.charAt(0).toUpperCase() + provider.slice(1)

  return (
    <SidebarMenuItem>
      <div className="flex items-center justify-between w-full gap-2 px-2 py-1.5">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Plug className="size-4 shrink-0" />
          <span className="truncate text-sm">{providerDisplayName}</span>
          {isLoading ? (
            <Loader2 className="size-3 animate-spin shrink-0" />
          ) : (
            <Badge
              variant={isConnected ? "default" : "outline"}
              className="shrink-0 text-xs"
            >
              {isConnected ? "Connected" : "Not Connected"}
            </Badge>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          {isConnected ? (
            <Button
              variant="outline"
              size="sm"
              onClick={disconnect}
              disabled={isLoading}
              className="h-6 px-2 text-xs"
            >
              Disconnect
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={connect}
              disabled={isConnecting || isLoading}
              className="h-6 px-2 text-xs"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                </>
              ) : (
                "Connect"
              )}
            </Button>
          )}
        </div>
      </div>
    </SidebarMenuItem>
  )
}
