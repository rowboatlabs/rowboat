"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { AlertTriangle, Loader2, Mic, Mail, MessageSquare } from "lucide-react"

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
import { GoogleClientIdModal } from "@/components/google-client-id-modal"
import { getGoogleClientId, setGoogleClientId, clearGoogleClientId } from "@/lib/google-client-id-store"
import { toast } from "sonner"

interface ProviderState {
  isConnected: boolean
  isLoading: boolean
  isConnecting: boolean
}

interface ProviderStatus {
  error?: string
}

interface ConnectorsPopoverProps {
  children: React.ReactNode
  tooltip?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function ConnectorsPopover({ children, tooltip, open: openProp, onOpenChange }: ConnectorsPopoverProps) {
  const [openInternal, setOpenInternal] = useState(false)
  const isControlled = typeof openProp === "boolean"
  const open = isControlled ? openProp : openInternal
  const setOpen = onOpenChange ?? setOpenInternal
  const [providers, setProviders] = useState<string[]>([])
  const [providersLoading, setProvidersLoading] = useState(true)
  const [providerStates, setProviderStates] = useState<Record<string, ProviderState>>({})
  const [providerStatus, setProviderStatus] = useState<Record<string, ProviderStatus>>({})
  const [googleClientIdOpen, setGoogleClientIdOpen] = useState(false)
  const [googleClientIdDescription, setGoogleClientIdDescription] = useState<string | undefined>(undefined)

  // Granola state
  const [granolaEnabled, setGranolaEnabled] = useState(false)
  const [granolaLoading, setGranolaLoading] = useState(true)

  // Slack state (agent-slack CLI)
  const [slackEnabled, setSlackEnabled] = useState(false)
  const [slackLoading, setSlackLoading] = useState(true)
  const [slackWorkspaces, setSlackWorkspaces] = useState<Array<{ url: string; name: string }>>([])
  const [slackAvailableWorkspaces, setSlackAvailableWorkspaces] = useState<Array<{ url: string; name: string }>>([])
  const [slackSelectedUrls, setSlackSelectedUrls] = useState<Set<string>>(new Set())
  const [slackPickerOpen, setSlackPickerOpen] = useState(false)
  const [slackDiscovering, setSlackDiscovering] = useState(false)
  const [slackDiscoverError, setSlackDiscoverError] = useState<string | null>(null)

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

  // Load Slack config
  const refreshSlackConfig = useCallback(async () => {
    try {
      setSlackLoading(true)
      const result = await window.ipc.invoke('slack:getConfig', null)
      setSlackEnabled(result.enabled)
      setSlackWorkspaces(result.workspaces || [])
    } catch (error) {
      console.error('Failed to load Slack config:', error)
      setSlackEnabled(false)
      setSlackWorkspaces([])
    } finally {
      setSlackLoading(false)
    }
  }, [])

  // Enable Slack: discover workspaces
  const handleSlackEnable = useCallback(async () => {
    setSlackDiscovering(true)
    setSlackDiscoverError(null)
    try {
      const result = await window.ipc.invoke('slack:listWorkspaces', null)
      if (result.error || result.workspaces.length === 0) {
        setSlackDiscoverError(result.error || 'No Slack workspaces found. Set up with: agent-slack auth import-desktop')
        setSlackAvailableWorkspaces([])
        setSlackPickerOpen(true)
      } else {
        setSlackAvailableWorkspaces(result.workspaces)
        setSlackSelectedUrls(new Set(result.workspaces.map((w: { url: string }) => w.url)))
        setSlackPickerOpen(true)
      }
    } catch (error) {
      console.error('Failed to discover Slack workspaces:', error)
      setSlackDiscoverError('Failed to discover Slack workspaces')
      setSlackPickerOpen(true)
    } finally {
      setSlackDiscovering(false)
    }
  }, [])

  // Save selected Slack workspaces
  const handleSlackSaveWorkspaces = useCallback(async () => {
    const selected = slackAvailableWorkspaces.filter(w => slackSelectedUrls.has(w.url))
    try {
      setSlackLoading(true)
      await window.ipc.invoke('slack:setConfig', { enabled: true, workspaces: selected })
      setSlackEnabled(true)
      setSlackWorkspaces(selected)
      setSlackPickerOpen(false)
      toast.success('Slack enabled')
    } catch (error) {
      console.error('Failed to save Slack config:', error)
      toast.error('Failed to save Slack settings')
    } finally {
      setSlackLoading(false)
    }
  }, [slackAvailableWorkspaces, slackSelectedUrls])

  // Disable Slack
  const handleSlackDisable = useCallback(async () => {
    try {
      setSlackLoading(true)
      await window.ipc.invoke('slack:setConfig', { enabled: false, workspaces: [] })
      setSlackEnabled(false)
      setSlackWorkspaces([])
      setSlackPickerOpen(false)
      toast.success('Slack disabled')
    } catch (error) {
      console.error('Failed to update Slack config:', error)
      toast.error('Failed to update Slack settings')
    } finally {
      setSlackLoading(false)
    }
  }, [])

  // Check connection status for all providers
  const refreshAllStatuses = useCallback(async () => {
    // Refresh Granola
    refreshGranolaConfig()

    // Refresh Slack config
    refreshSlackConfig()

    // Refresh OAuth providers
    if (providers.length === 0) return

    const newStates: Record<string, ProviderState> = {}

    try {
      const result = await window.ipc.invoke('oauth:getState', null)
      const config = result.config || {}
      const statusMap: Record<string, ProviderStatus> = {}

      for (const provider of providers) {
        const providerConfig = config[provider]
        newStates[provider] = {
          isConnected: providerConfig?.connected ?? false,
          isLoading: false,
          isConnecting: false,
        }
        if (providerConfig?.error) {
          statusMap[provider] = { error: providerConfig.error }
        }
      }

      setProviderStatus(statusMap)
    } catch (error) {
      console.error('Failed to check connection statuses:', error)
      for (const provider of providers) {
        newStates[provider] = {
          isConnected: false,
          isLoading: false,
          isConnecting: false,
        }
      }
      setProviderStatus({})
    }

    setProviderStates(newStates)
  }, [providers, refreshGranolaConfig, refreshSlackConfig])

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

  const startConnect = useCallback(async (provider: string, clientId?: string) => {
    setProviderStates(prev => ({
      ...prev,
      [provider]: { ...prev[provider], isConnecting: true }
    }))

    try {
      const result = await window.ipc.invoke('oauth:connect', { provider, clientId })

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

  // Connect to a provider
  const handleConnect = useCallback(async (provider: string) => {
    if (provider === 'google') {
      setGoogleClientIdDescription(undefined)
      const existingClientId = getGoogleClientId()
      if (!existingClientId) {
        setGoogleClientIdOpen(true)
        return
      }
      await startConnect(provider, existingClientId)
      return
    }

    await startConnect(provider)
  }, [startConnect])

  const handleGoogleClientIdSubmit = useCallback((clientId: string) => {
    setGoogleClientId(clientId)
    setGoogleClientIdOpen(false)
    setGoogleClientIdDescription(undefined)
    startConnect('google', clientId)
  }, [startConnect])

  // Disconnect from a provider
  const handleDisconnect = useCallback(async (provider: string) => {
    setProviderStates(prev => ({
      ...prev,
      [provider]: { ...prev[provider], isLoading: true }
    }))

    try {
      const result = await window.ipc.invoke('oauth:disconnect', { provider })

      if (result.success) {
        if (provider === 'google') {
          clearGoogleClientId()
        }
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

  const hasProviderError = Object.values(providerStatus).some(
    (status) => Boolean(status?.error)
  )

  // Helper to render an OAuth provider row
  const renderOAuthProvider = (provider: string, displayName: string, icon: React.ReactNode, description: string) => {
    const state = providerStates[provider] || {
      isConnected: false,
      isLoading: true,
      isConnecting: false,
    }
    const needsReconnect = Boolean(providerStatus[provider]?.error)

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
            ) : needsReconnect ? (
              <span className="text-xs text-amber-600">Needs reconnect</span>
            ) : (
              <span className="text-xs text-muted-foreground truncate">{description}</span>
            )}
          </div>
        </div>
        <div className="shrink-0">
          {state.isLoading ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : needsReconnect ? (
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                if (provider === 'google') {
                  setGoogleClientIdDescription(
                    "To keep your Google account connected, please re-enter your client ID. You only need to do this once."
                  )
                  setGoogleClientIdOpen(true)
                  return
                }
                startConnect(provider)
              }}
              className="h-7 px-2 text-xs"
            >
              Reconnect
            </Button>
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
    <>
    <GoogleClientIdModal
      open={googleClientIdOpen}
      onOpenChange={(nextOpen) => {
        setGoogleClientIdOpen(nextOpen)
        if (!nextOpen) {
          setGoogleClientIdDescription(undefined)
        }
      }}
      onSubmit={handleGoogleClientIdSubmit}
      isSubmitting={providerStates.google?.isConnecting ?? false}
      description={googleClientIdDescription}
    />
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
        sideOffset={4}
        className="w-80 p-0"
      >
        <div className="p-4 border-b">
          <h4 className="font-semibold text-sm flex items-center gap-1.5">
            Connected accounts
            {hasProviderError && (
              <AlertTriangle className="size-3 text-amber-500/80 animate-pulse" />
            )}
          </h4>
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

              <Separator className="my-2" />

              {/* Team Communication Section - Slack */}
              <div className="px-2 py-1.5">
                <span className="text-xs font-medium text-muted-foreground">Team Communication</span>
              </div>

              {/* Slack */}
              <div className="rounded-md px-3 py-2 hover:bg-accent">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex size-8 items-center justify-center rounded-md bg-muted">
                      <MessageSquare className="size-4" />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium truncate">Slack</span>
                      {slackEnabled && slackWorkspaces.length > 0 ? (
                        <span className="text-xs text-muted-foreground truncate">
                          {slackWorkspaces.map(w => w.name).join(', ')}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground truncate">
                          Send messages and view channels
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {(slackLoading || slackDiscovering) && (
                      <Loader2 className="size-3 animate-spin" />
                    )}
                    {slackEnabled ? (
                      <Switch
                        checked={true}
                        onCheckedChange={() => handleSlackDisable()}
                        disabled={slackLoading}
                      />
                    ) : (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={handleSlackEnable}
                        disabled={slackLoading || slackDiscovering}
                        className="h-7 px-2 text-xs"
                      >
                        Enable
                      </Button>
                    )}
                  </div>
                </div>
                {slackPickerOpen && (
                  <div className="mt-2 ml-11 space-y-2">
                    {slackDiscoverError ? (
                      <p className="text-xs text-muted-foreground">{slackDiscoverError}</p>
                    ) : (
                      <>
                        {slackAvailableWorkspaces.map(w => (
                          <label key={w.url} className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              checked={slackSelectedUrls.has(w.url)}
                              onChange={(e) => {
                                setSlackSelectedUrls(prev => {
                                  const next = new Set(prev)
                                  if (e.target.checked) next.add(w.url)
                                  else next.delete(w.url)
                                  return next
                                })
                              }}
                              className="rounded border-border"
                            />
                            <span className="truncate">{w.name}</span>
                          </label>
                        ))}
                        <Button
                          size="sm"
                          onClick={handleSlackSaveWorkspaces}
                          disabled={slackSelectedUrls.size === 0 || slackLoading}
                          className="h-7 px-3 text-xs"
                        >
                          Save
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
    </>
  )
}
