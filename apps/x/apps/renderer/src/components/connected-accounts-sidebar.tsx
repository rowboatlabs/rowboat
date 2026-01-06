"use client"

import * as React from "react"
import { Loader2, Plug } from "lucide-react"
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
import { useOAuth, useAvailableProviders } from "@/hooks/useOAuth"

type ConnectedAccountsSidebarProps = React.ComponentProps<typeof Sidebar>

export function ConnectedAccountsSidebar({ ...props }: ConnectedAccountsSidebarProps) {
  const { providers, isLoading: providersLoading } = useAvailableProviders()

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

