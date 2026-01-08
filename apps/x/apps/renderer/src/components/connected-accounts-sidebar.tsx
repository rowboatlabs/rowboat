"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { Loader2, Plug, Database } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { useOAuth, useAvailableProviders } from "@/hooks/useOAuth"
import { toast } from "@/lib/toast"

type ConnectedAccountsSidebarProps = React.ComponentProps<typeof Sidebar>

/**
 * Hook for managing Granola sync config
 */
function useGranolaConfig() {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const loadConfig = useCallback(async () => {
    try {
      setIsLoading(true);
      const result = await window.ipc.invoke('granola:getConfig', null);
      setEnabled(result.enabled);
    } catch (error) {
      console.error('Failed to load Granola config:', error);
      setEnabled(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const updateConfig = useCallback(async (newEnabled: boolean) => {
    try {
      setIsLoading(true);
      await window.ipc.invoke('granola:setConfig', { enabled: newEnabled });
      setEnabled(newEnabled);
      toast(
        newEnabled ? 'Granola sync enabled' : 'Granola sync disabled',
        'success'
      );
    } catch (error) {
      console.error('Failed to update Granola config:', error);
      toast('Failed to update Granola sync settings', 'error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { enabled, isLoading, updateConfig };
}

export function ConnectedAccountsSidebar({ ...props }: ConnectedAccountsSidebarProps) {
  const { providers, isLoading: providersLoading } = useAvailableProviders()
  const { enabled: granolaEnabled, isLoading: granolaLoading, updateConfig: updateGranolaConfig } = useGranolaConfig()

  return (
    <Sidebar collapsible="none" className="hidden flex-1 md:flex" {...props}>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Connected Accounts</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {providersLoading ? (
                <SidebarMenuItem>
                  <SidebarMenuButton disabled>
                    <Loader2 className="animate-spin" />
                    <span>Loading...</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : providers.length === 0 ? (
                <SidebarMenuItem>
                  <SidebarMenuButton disabled>
                    <span className="text-muted-foreground">No providers available</span>
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
      </SidebarContent>
    </Sidebar>
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
          <span className="truncate">{providerDisplayName}</span>
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
              className="h-7 px-2 text-xs"
            >
              Disconnect
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={connect}
              disabled={isConnecting || isLoading}
              className="h-7 px-2 text-xs"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Connecting...
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

