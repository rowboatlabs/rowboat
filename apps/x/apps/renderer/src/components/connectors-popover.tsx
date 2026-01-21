"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { Loader2, Mic, Mail } from "lucide-react"

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
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"

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
      toast.success(enabled ? 'Granola sync enabled' : 'Granola sync disabled')
    } catch (error) {
      console.error('Failed to update Granola config:', error)
      toast.error('Failed to update Granola sync settings')
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

  // Listen for OAuth completion events
  useEffect(() => {
    const cleanup = window.ipc.on('oauth:didConnect', (event) => {
      const { provider, success, error } = event
      
      setProviderStates(prev => ({
        ...prev,
        [provider]: {
          isConnected: success,
          isLoading: false,
          isConnecting: false,
        }
      }))

      if (success) {
        const displayName = provider === 'fireflies-ai' ? 'Fireflies' : provider.charAt(0).toUpperCase() + provider.slice(1)
        // Show detailed message for Google and Fireflies (includes sync info)
        if (provider === 'google' || provider === 'fireflies-ai') {
          toast.success(`Connected to ${displayName}`, {
            description: 'Syncing your data in the background. This may take a few minutes before changes appear.',
            duration: 8000,
          })
        } else {
          toast.success(`Connected to ${displayName}`)
        }
        // Refresh status to ensure consistency
        refreshAllStatuses()
      } else {
        toast.error(error || `Failed to connect to ${provider}`)
      }
    })

    return cleanup
  }, [refreshAllStatuses])

  // Connect to a provider
  const handleConnect = useCallback(async (provider: string) => {
    setProviderStates(prev => ({
      ...prev,
      [provider]: { ...prev[provider], isConnecting: true }
    }))

    try {
      const result = await window.ipc.invoke('oauth:connect', { provider })

      if (result.success) {
        // OAuth flow started - keep isConnecting state, wait for event
        // Event listener will handle the actual completion
      } else {
        // Immediate failure (e.g., couldn't start flow)
        toast.error(result.error || `Failed to connect to ${provider}`)
        setProviderStates(prev => ({
          ...prev,
          [provider]: { ...prev[provider], isConnecting: false }
        }))
      }
    } catch (error) {
      console.error('Failed to connect:', error)
      toast.error(`Failed to connect to ${provider}`)
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
        const displayName = provider === 'fireflies-ai' ? 'Fireflies' : provider.charAt(0).toUpperCase() + provider.slice(1)
        toast.success(`Disconnected from ${displayName}`)
        setProviderStates(prev => ({
          ...prev,
          [provider]: {
            isConnected: false,
            isLoading: false,
            isConnecting: false,
          }
        }))
      } else {
        toast.error(`Failed to disconnect from ${provider}`)
        setProviderStates(prev => ({
          ...prev,
          [provider]: { ...prev[provider], isLoading: false }
        }))
      }
    } catch (error) {
      console.error('Failed to disconnect:', error)
      toast.error(`Failed to disconnect from ${provider}`)
      setProviderStates(prev => ({
        ...prev,
        [provider]: { ...prev[provider], isLoading: false }
      }))
    }
  }, [])

  // Helper to render an OAuth provider row
  const renderOAuthProvider = (provider: string, displayName: string, icon: React.ReactNode, description: string) => {
    const state = providerStates[provider] || {
      isConnected: false,
      isLoading: true,
      isConnecting: false,
    }

    return (
      <div
        key={provider}
        className="flex items-center justify-between gap-3 rounded-md px-3 py-2 hover:bg-accent"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex size-8 items-center justify-center rounded-md bg-muted">
            {icon}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium truncate">{displayName}</span>
            {state.isLoading ? (
              <span className="text-xs text-muted-foreground">Checking...</span>
            ) : (
              <span className="text-xs text-muted-foreground truncate">{description}</span>
            )}
          </div>
        </div>
        <div className="shrink-0">
          {state.isLoading ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : state.isConnected ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDisconnect(provider)}
              className="h-7 px-2 text-xs"
            >
              Disconnect
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={() => handleConnect(provider)}
              disabled={state.isConnecting}
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
  }

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
          {providersLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Email & Calendar Section - Google */}
              {providers.includes('google') && (
                <>
                  <div className="px-2 py-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Email & Calendar</span>
                  </div>
                  {renderOAuthProvider('google', 'Google', <Mail className="size-4" />, 'Sync emails and calendar')}
                  <Separator className="my-2" />
                </>
              )}

              {/* Meeting Notes Section - Granola & Fireflies */}
              <div className="px-2 py-1.5">
                <span className="text-xs font-medium text-muted-foreground">Meeting Notes</span>
              </div>

              {/* Granola */}
              <div className="flex items-center justify-between gap-3 rounded-md px-3 py-2 hover:bg-accent">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex size-8 items-center justify-center rounded-md bg-muted">
                    <Mic className="size-4" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium truncate">Granola</span>
                    <span className="text-xs text-muted-foreground truncate">
                      Local meeting notes
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

              {/* Fireflies */}
              {providers.includes('fireflies-ai') && renderOAuthProvider('fireflies-ai', 'Fireflies', <Mic className="size-4" />, 'AI meeting transcripts')}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
