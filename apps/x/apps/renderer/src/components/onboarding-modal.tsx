"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { Loader2, Mic, Mail, CheckCircle2, Sailboat, MessageSquare } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { ComposioApiKeyModal } from "@/components/composio-api-key-modal"
import { toast } from "sonner"

interface ProviderState {
  isConnected: boolean
  isLoading: boolean
  isConnecting: boolean
}

interface OnboardingModalProps {
  open: boolean
  onComplete: () => void
}

type Step = 0 | 1 | 2

export function OnboardingModal({ open, onComplete }: OnboardingModalProps) {
  const [currentStep, setCurrentStep] = useState<Step>(0)

  // OAuth provider states
  const [providers, setProviders] = useState<string[]>([])
  const [providersLoading, setProvidersLoading] = useState(true)
  const [providerStates, setProviderStates] = useState<Record<string, ProviderState>>({})

  // Granola state
  const [granolaEnabled, setGranolaEnabled] = useState(false)
  const [granolaLoading, setGranolaLoading] = useState(true)

  // Composio state (Gmail + Slack)
  const [composioApiKeyOpen, setComposioApiKeyOpen] = useState(false)
  const [composioApiKeyTarget, setComposioApiKeyTarget] = useState<'gmail' | 'slack'>('gmail')
  const [gmailConnected, setGmailConnected] = useState(false)
  const [gmailLoading, setGmailLoading] = useState(true)
  const [gmailConnecting, setGmailConnecting] = useState(false)
  const [slackConnected, setSlackConnected] = useState(false)
  const [slackLoading, setSlackLoading] = useState(true)
  const [slackConnecting, setSlackConnecting] = useState(false)

  // Track connected providers for the completion step
  const connectedProviders = Object.entries(providerStates)
    .filter(([, state]) => state.isConnected)
    .map(([provider]) => provider)

  // Load available providers on mount
  useEffect(() => {
    if (!open) return

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
  }, [open])

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

  // Load Gmail connection status
  const refreshGmailStatus = useCallback(async () => {
    try {
      setGmailLoading(true)
      const result = await window.ipc.invoke('composio:get-connection-status', { toolkitSlug: 'gmail' })
      setGmailConnected(result.isConnected)
    } catch (error) {
      console.error('Failed to load Gmail status:', error)
      setGmailConnected(false)
    } finally {
      setGmailLoading(false)
    }
  }, [])

  // Connect to Gmail via Composio
  const startGmailConnect = useCallback(async () => {
    try {
      setGmailConnecting(true)
      const result = await window.ipc.invoke('composio:initiate-connection', { toolkitSlug: 'gmail' })
      if (!result.success) {
        toast.error(result.error || 'Failed to connect to Gmail')
        setGmailConnecting(false)
      }
    } catch (error) {
      console.error('Failed to connect to Gmail:', error)
      toast.error('Failed to connect to Gmail')
      setGmailConnecting(false)
    }
  }, [])

  // Handle Gmail connect button click
  const handleConnectGmail = useCallback(async () => {
    const configResult = await window.ipc.invoke('composio:is-configured', null)
    if (!configResult.configured) {
      setComposioApiKeyTarget('gmail')
      setComposioApiKeyOpen(true)
      return
    }
    await startGmailConnect()
  }, [startGmailConnect])

  // Load Slack connection status
  const refreshSlackStatus = useCallback(async () => {
    try {
      setSlackLoading(true)
      const result = await window.ipc.invoke('composio:get-connection-status', { toolkitSlug: 'slack' })
      setSlackConnected(result.isConnected)
    } catch (error) {
      console.error('Failed to load Slack status:', error)
      setSlackConnected(false)
    } finally {
      setSlackLoading(false)
    }
  }, [])

  // Start Slack connection
  const startSlackConnect = useCallback(async () => {
    try {
      setSlackConnecting(true)
      const result = await window.ipc.invoke('composio:initiate-connection', { toolkitSlug: 'slack' })
      if (!result.success) {
        toast.error(result.error || 'Failed to connect to Slack')
        setSlackConnecting(false)
      }
      // Success will be handled by composio:didConnect event
    } catch (error) {
      console.error('Failed to connect to Slack:', error)
      toast.error('Failed to connect to Slack')
      setSlackConnecting(false)
    }
  }, [])

  // Connect to Slack via Composio (checks if configured first)
  const handleConnectSlack = useCallback(async () => {
    const configResult = await window.ipc.invoke('composio:is-configured', null)
    if (!configResult.configured) {
      setComposioApiKeyTarget('slack')
      setComposioApiKeyOpen(true)
      return
    }
    await startSlackConnect()
  }, [startSlackConnect])

  // Handle Composio API key submission
  const handleComposioApiKeySubmit = useCallback(async (apiKey: string) => {
    try {
      await window.ipc.invoke('composio:set-api-key', { apiKey })
      setComposioApiKeyOpen(false)
      toast.success('Composio API key saved')
      if (composioApiKeyTarget === 'gmail') {
        await startGmailConnect()
      } else {
        await startSlackConnect()
      }
    } catch (error) {
      console.error('Failed to save Composio API key:', error)
      toast.error('Failed to save API key')
    }
  }, [composioApiKeyTarget, startGmailConnect, startSlackConnect])

  // Check connection status for all providers
  const refreshAllStatuses = useCallback(async () => {
    // Refresh Granola
    refreshGranolaConfig()

    // Refresh Composio connections
    refreshGmailStatus()
    refreshSlackStatus()

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
  }, [providers, refreshGranolaConfig, refreshGmailStatus, refreshSlackStatus])

  // Refresh statuses when modal opens or providers list changes
  useEffect(() => {
    if (open && providers.length > 0) {
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
        toast.success(`Connected to ${displayName}`)
      } else {
        toast.error(error || `Failed to connect to ${provider}`)
      }
    })

    return cleanup
  }, [])

  // Listen for Composio connection events
  useEffect(() => {
    const cleanup = window.ipc.on('composio:didConnect', (event) => {
      const { toolkitSlug, success, error } = event

      if (toolkitSlug === 'gmail') {
        setGmailConnected(success)
        setGmailConnecting(false)

        if (success) {
          toast.success('Connected to Gmail')
        } else {
          toast.error(error || 'Failed to connect to Gmail')
        }
      } else if (toolkitSlug === 'slack') {
        setSlackConnected(success)
        setSlackConnecting(false)

        if (success) {
          toast.success('Connected to Slack')
        } else {
          toast.error(error || 'Failed to connect to Slack')
        }
      }
    })

    return cleanup
  }, [])

  // Connect to a provider
  const handleConnect = useCallback(async (provider: string) => {
    setProviderStates(prev => ({
      ...prev,
      [provider]: { ...prev[provider], isConnecting: true }
    }))

    try {
      const result = await window.ipc.invoke('oauth:connect', { provider })

      if (!result.success) {
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

  const handleNext = () => {
    if (currentStep < 2) {
      setCurrentStep((prev) => (prev + 1) as Step)
    }
  }

  const handleComplete = () => {
    onComplete()
  }

  // Step indicator component
  const StepIndicator = () => (
    <div className="flex gap-2 justify-center mb-6">
      {[0, 1, 2].map((step) => (
        <div
          key={step}
          className={cn(
            "w-2 h-2 rounded-full transition-colors",
            currentStep >= step ? "bg-primary" : "bg-muted"
          )}
        />
      ))}
    </div>
  )

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
        className="flex items-center justify-between gap-3 rounded-md px-3 py-3 hover:bg-accent"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex size-10 items-center justify-center rounded-md bg-muted">
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
            <div className="flex items-center gap-1.5 text-sm text-green-600">
              <CheckCircle2 className="size-4" />
              <span>Connected</span>
            </div>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={() => handleConnect(provider)}
              disabled={state.isConnecting}
            >
              {state.isConnecting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Connect"
              )}
            </Button>
          )}
        </div>
      </div>
    )
  }

  // Render Granola row
  const renderGranolaRow = () => (
    <div className="flex items-center justify-between gap-3 rounded-md px-3 py-3 hover:bg-accent">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex size-10 items-center justify-center rounded-md bg-muted">
          <Mic className="size-5" />
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
  )

  // Render Gmail row (Composio)
  const renderGmailRow = () => (
    <div className="flex items-center justify-between gap-3 rounded-md px-3 py-3 hover:bg-accent">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex size-10 items-center justify-center rounded-md bg-muted">
          <Mail className="size-5" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium truncate">Gmail</span>
          {gmailLoading ? (
            <span className="text-xs text-muted-foreground">Checking...</span>
          ) : (
            <span className="text-xs text-muted-foreground truncate">Sync emails</span>
          )}
        </div>
      </div>
      <div className="shrink-0">
        {gmailLoading ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : gmailConnected ? (
          <div className="flex items-center gap-1.5 text-sm text-green-600">
            <CheckCircle2 className="size-4" />
            <span>Connected</span>
          </div>
        ) : (
          <Button
            variant="default"
            size="sm"
            onClick={handleConnectGmail}
            disabled={gmailConnecting}
          >
            {gmailConnecting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Connect"
            )}
          </Button>
        )}
      </div>
    </div>
  )

  // Render Slack row
  const renderSlackRow = () => (
    <div className="flex items-center justify-between gap-3 rounded-md px-3 py-3 hover:bg-accent">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex size-10 items-center justify-center rounded-md bg-muted">
          <MessageSquare className="size-5" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium truncate">Slack</span>
          {slackLoading ? (
            <span className="text-xs text-muted-foreground">Checking...</span>
          ) : (
            <span className="text-xs text-muted-foreground truncate">
              Send messages and view channels
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0">
        {slackLoading ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : slackConnected ? (
          <div className="flex items-center gap-1.5 text-sm text-green-600">
            <CheckCircle2 className="size-4" />
            <span>Connected</span>
          </div>
        ) : (
          <Button
            variant="default"
            size="sm"
            onClick={handleConnectSlack}
            disabled={slackConnecting}
          >
            {slackConnecting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Connect"
            )}
          </Button>
        )}
      </div>
    </div>
  )

  // Step 0: Welcome
  const WelcomeStep = () => (
    <div className="flex flex-col items-center text-center">
      <div className="flex size-20 items-center justify-center rounded-full bg-primary/10 mb-6">
        <Sailboat className="size-10 text-primary" />
      </div>
      <DialogHeader className="space-y-3">
        <DialogTitle className="text-2xl">Your AI coworker, with memory</DialogTitle>
        <DialogDescription className="text-base max-w-md mx-auto">
          Rowboat connects to your email, calendar, and meetings to help you stay on top of your work.
        </DialogDescription>
      </DialogHeader>
      <div className="mt-8 space-y-3 text-left w-full max-w-sm">
        <div className="flex gap-3">
          <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium">1</div>
          <p className="text-sm text-muted-foreground">Syncs with your email, calendar, and meetings</p>
        </div>
        <div className="flex gap-3">
          <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium">2</div>
          <p className="text-sm text-muted-foreground">Remembers the people and context from your conversations</p>
        </div>
        <div className="flex gap-3">
          <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium">3</div>
          <p className="text-sm text-muted-foreground">Helps you follow up and never miss what matters</p>
        </div>
      </div>
      <Button onClick={handleNext} size="lg" className="mt-8 w-full max-w-xs">
        Get Started
      </Button>
    </div>
  )

  // Step 1: Connect Accounts
  const AccountConnectionStep = () => (
    <div className="flex flex-col">
      <DialogHeader className="text-center mb-6">
        <DialogTitle className="text-2xl">Connect Your Accounts</DialogTitle>
        <DialogDescription className="text-base">
          Connect your accounts to start syncing your data. You can always add more later.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {providersLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Email Section - Gmail via Composio */}
            <div className="space-y-2">
              <div className="px-3">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email</span>
              </div>
              {renderGmailRow()}
            </div>

            {/* Meeting Notes Section */}
            <div className="space-y-2">
              <div className="px-3">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Meeting Notes</span>
              </div>
              {renderGranolaRow()}
              {providers.includes('fireflies-ai') && renderOAuthProvider('fireflies-ai', 'Fireflies', <Mic className="size-5" />, 'AI meeting transcripts')}
            </div>

            {/* Team Communication Section */}
            <div className="space-y-2">
              <div className="px-3">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Team Communication</span>
              </div>
              {renderSlackRow()}
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-3 mt-8">
        <Button onClick={handleNext} size="lg">
          Continue
        </Button>
        <Button variant="ghost" onClick={handleNext} className="text-muted-foreground">
          Skip for now
        </Button>
      </div>
    </div>
  )

  // Step 2: Completion
  const CompletionStep = () => {
    const hasConnections = connectedProviders.length > 0 || gmailConnected || granolaEnabled || slackConnected

    return (
      <div className="flex flex-col items-center text-center">
        <div className="flex size-20 items-center justify-center rounded-full bg-green-100 mb-6">
          <CheckCircle2 className="size-10 text-green-600" />
        </div>
        <DialogHeader className="space-y-3">
          <DialogTitle className="text-2xl">You're All Set!</DialogTitle>
          <DialogDescription className="text-base max-w-md mx-auto">
            {hasConnections ? (
              <>Your workspace will populate over the next ~30 minutes as we sync your data.</>
            ) : (
              <>You can connect your accounts anytime from the sidebar to start syncing data.</>
            )}
          </DialogDescription>
        </DialogHeader>

        {hasConnections && (
          <div className="mt-6 w-full max-w-sm">
            <div className="rounded-lg border bg-muted/50 p-4">
              <p className="text-sm font-medium mb-2">Connected accounts:</p>
              <div className="space-y-1">
                {gmailConnected && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="size-4 text-green-600" />
                    <span>Gmail (Email)</span>
                  </div>
                )}
                {connectedProviders.includes('fireflies-ai') && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="size-4 text-green-600" />
                    <span>Fireflies (Meeting transcripts)</span>
                  </div>
                )}
                {granolaEnabled && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="size-4 text-green-600" />
                    <span>Granola (Local meeting notes)</span>
                  </div>
                )}
                {slackConnected && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="size-4 text-green-600" />
                    <span>Slack (Team communication)</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <Button onClick={handleComplete} size="lg" className="mt-8 w-full max-w-xs">
          Start Using Rowboat
        </Button>
      </div>
    )
  }

  return (
    <>
    <ComposioApiKeyModal
      open={composioApiKeyOpen}
      onOpenChange={setComposioApiKeyOpen}
      onSubmit={handleComposioApiKeySubmit}
      isSubmitting={gmailConnecting || slackConnecting}
    />
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="w-[60vw] max-w-3xl max-h-[80vh] overflow-y-auto"
        showCloseButton={false}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <StepIndicator />
        {currentStep === 0 && <WelcomeStep />}
        {currentStep === 1 && <AccountConnectionStep />}
        {currentStep === 2 && <CompletionStep />}
      </DialogContent>
    </Dialog>
    </>
  )
}
