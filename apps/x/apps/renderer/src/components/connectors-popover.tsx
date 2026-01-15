"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { Database, Loader2, Plug } from "lucide-react"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { toast } from "@/lib/toast"

interface ProviderState {
  isConnected: boolean
  isLoading: boolean
  isConnecting: boolean
}

interface ConnectorsPopoverProps {
  children: React.ReactNode
  tooltip?: string
}

export function ConnectorsPopover({ children, tooltip }: ConnectorsPopoverProps) {
  const [open, setOpen] = useState(false)
  const [providers, setProviders] = useState<string[]>([])
  const [providersLoading, setProvidersLoading] = useState(true)
  const [providerStates, setProviderStates] = useState<Record<string, ProviderState>>({})

  // Granola state
  const [granolaEnabled, setGranolaEnabled] = useState(false)
  const [granolaLoading, setGranolaLoading] = useState(true)

  // Load available providers on mount
  useEffect(() => {
    async function loadProviders() {
      try {
        setProvidersLoading(true)
        const result = await window.ipc.invoke('oauth:list-providers', null)
        setProviders(result.providers || [])
      } catch (error) {
        console.error('Failed to get available providers:', error)
        setProviders([])
      } finally {
        setProvidersLoading(false)
      }
    }
    loadProviders()
  }, [])

  // Load Granola config
  const refreshGranolaConfig = useCallback(async () => {
    try {
      setGranolaLoading(true)
      const result = await window.ipc.invoke('granola:getConfig', null)
      setGranolaEnabled(result.enabled)
    } catch (error) {
      console.error('Failed to load Granola config:', error)
      setGranolaEnabled(false)
    } finally {
      setGranolaLoading(false)
    }
  }, [])

  // Update Granola config
  const handleGranolaToggle = useCallback(async (enabled: boolean) => {
    try {
      setGranolaLoading(true)
      await window.ipc.invoke('granola:setConfig', { enabled })
      setGranolaEnabled(enabled)
      toast(enabled ? 'Granola sync enabled' : 'Granola sync disabled', 'success')
    } catch (error) {
      console.error('Failed to update Granola config:', error)
      toast('Failed to update Granola sync settings', 'error')
    } finally {
      setGranolaLoading(false)
    }
  }, [])

  // Check connection status for all providers
  const refreshAllStatuses = useCallback(async () => {
    // Refresh Granola
    refreshGranolaConfig()

    // Refresh OAuth providers
    if (providers.length === 0) return

    const newStates: Record<string, ProviderState> = {}

    await Promise.all(
      providers.map(async (provider) => {
        try {
          const result = await window.ipc.invoke('oauth:is-connected', { provider })
          newStates[provider] = {
            isConnected: result.isConnected,
            isLoading: false,
            isConnecting: false,
          }
        } catch (error) {
          console.error(`Failed to check connection status for ${provider}:`, error)
          newStates[provider] = {
            isConnected: false,
            isLoading: false,
            isConnecting: false,
          }
        }
      })
    )

    setProviderStates(newStates)
  }, [providers, refreshGranolaConfig])

  // Refresh statuses when popover opens or providers list changes
  useEffect(() => {
    if (open) {
      refreshAllStatuses()
    }
  }, [open, providers, refreshAllStatuses])

  // Connect to a provider
  const handleConnect = useCallback(async (provider: string) => {
    setProviderStates(prev => ({
      ...prev,
      [provider]: { ...prev[provider], isConnecting: true }
    }))

    try {
      const result = await window.ipc.invoke('oauth:connect', { provider })

      if (result.success) {
        toast(`Successfully connected to ${provider}`, 'success')
        // Refresh the status after successful connection
        const checkResult = await window.ipc.invoke('oauth:is-connected', { provider })
        setProviderStates(prev => ({
          ...prev,
          [provider]: {
            isConnected: checkResult.isConnected,
            isLoading: false,
            isConnecting: false,
          }
        }))
      } else {
        toast(result.error || `Failed to connect to ${provider}`, 'error')
        setProviderStates(prev => ({
          ...prev,
          [provider]: { ...prev[provider], isConnecting: false }
        }))
      }
    } catch (error) {
      console.error('Failed to connect:', error)
      toast(`Failed to connect to ${provider}`, 'error')
      setProviderStates(prev => ({
        ...prev,
        [provider]: { ...prev[provider], isConnecting: false }
      }))
    }
  }, [])

  // Disconnect from a provider
  const handleDisconnect = useCallback(async (provider: string) => {
    setProviderStates(prev => ({
      ...prev,
      [provider]: { ...prev[provider], isLoading: true }
    }))

    try {
      const result = await window.ipc.invoke('oauth:disconnect', { provider })

      if (result.success) {
        toast(`Disconnected from ${provider}`, 'success')
        setProviderStates(prev => ({
          ...prev,
          [provider]: {
            isConnected: false,
            isLoading: false,
            isConnecting: false,
          }
        }))
      } else {
        toast(`Failed to disconnect from ${provider}`, 'error')
        setProviderStates(prev => ({
          ...prev,
          [provider]: { ...prev[provider], isLoading: false }
        }))
      }
    } catch (error) {
      console.error('Failed to disconnect:', error)
      toast(`Failed to disconnect from ${provider}`, 'error')
      setProviderStates(prev => ({
        ...prev,
        [provider]: { ...prev[provider], isLoading: false }
      }))
    }
  }, [])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {tooltip ? (
        <Tooltip open={open ? false : undefined}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              {children}
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {tooltip}
          </TooltipContent>
        </Tooltip>
      ) : (
        <PopoverTrigger asChild>
          {children}
        </PopoverTrigger>
      )}
      <PopoverContent
        side="right"
        align="end"
        sideOffset={8}
        className="w-80 p-0"
      >
        <div className="p-4 border-b">
          <h4 className="font-semibold text-sm">Connectors</h4>
          <p className="text-xs text-muted-foreground mt-1">
            Connect accounts to sync data
          </p>
        </div>
        <div className="p-2">
          {/* Data Sources Section */}
          <div className="px-2 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">Data Sources</span>
          </div>

          {/* Granola */}
          <div className="flex items-center justify-between gap-3 rounded-md px-3 py-2 hover:bg-accent">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex size-8 items-center justify-center rounded-md bg-muted">
                <Database className="size-4" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium truncate">Granola</span>
                <span className="text-xs text-muted-foreground truncate">
                  Sync meeting notes
                </span>
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              {granolaLoading && (
                <Loader2 className="size-3 animate-spin" />
              )}
              <Switch
                checked={granolaEnabled}
                onCheckedChange={handleGranolaToggle}
                disabled={granolaLoading}
              />
            </div>
          </div>

          <Separator className="my-2" />

          {/* OAuth Connectors Section */}
          <div className="px-2 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">Accounts</span>
          </div>

          {providersLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : providers.length === 0 ? (
            <div className="text-center py-4 text-xs text-muted-foreground">
              No account connectors available
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {providers.map((provider) => {
                const state = providerStates[provider] || {
                  isConnected: false,
                  isLoading: true,
                  isConnecting: false,
                }
                const displayName = provider.charAt(0).toUpperCase() + provider.slice(1)

                return (
                  <div
                    key={provider}
                    className="flex items-center justify-between gap-3 rounded-md px-3 py-2 hover:bg-accent"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex size-8 items-center justify-center rounded-md bg-muted">
                        <Plug className="size-4" />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium truncate">
                          {displayName}
                        </span>
                        {state.isLoading ? (
                          <span className="text-xs text-muted-foreground">
                            Checking...
                          </span>
                        ) : (
                          <Badge
                            variant={state.isConnected ? "default" : "outline"}
                            className="w-fit text-xs mt-0.5"
                          >
                            {state.isConnected ? "Connected" : "Not Connected"}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0">
                      {state.isConnected ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDisconnect(provider)}
                          disabled={state.isLoading}
                          className="h-7 px-2 text-xs"
                        >
                          {state.isLoading ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            "Disconnect"
                          )}
                        </Button>
                      ) : (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => handleConnect(provider)}
                          disabled={state.isConnecting || state.isLoading}
                          className="h-7 px-2 text-xs"
                        >
                          {state.isConnecting ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            "Connect"
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
