import { useState, useEffect, useCallback } from "react"
import { setGoogleCredentials } from "@/lib/google-credentials-store"
import { toast } from "sonner"

export interface ProviderState {
  isConnected: boolean
  isLoading: boolean
  isConnecting: boolean
}

export type Step = 0 | 1 | 2 | 3 | 4

export type OnboardingPath = 'rowboat' | 'byok' | null

export function useOnboardingState(open: boolean, onComplete: (opts?: { startTour?: boolean }) => void) {
  const [currentStep, setCurrentStep] = useState<Step>(0)
  const [onboardingPath, setOnboardingPath] = useState<OnboardingPath>(null)

  // OAuth provider states
  const [providers, setProviders] = useState<string[]>([])
  const [providersLoading, setProvidersLoading] = useState(true)
  const [providerStates, setProviderStates] = useState<Record<string, ProviderState>>({})
  const [googleClientIdOpen, setGoogleClientIdOpen] = useState(false)

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

  // Composio Gmail/Calendar sync was removed — flags are seeded false and
  // never flipped. Kept here so legacy gating expressions still type-check.
  const [useComposioForGoogle] = useState(false)
  const [gmailConnected, setGmailConnected] = useState(false)
  const [gmailLoading, setGmailLoading] = useState(true)
  const [gmailConnecting, setGmailConnecting] = useState(false)
  const [composioApiKeyOpen, setComposioApiKeyOpen] = useState(false)
  const [composioApiKeyTarget, setComposioApiKeyTarget] = useState<'slack' | 'gmail'>('gmail')

  const [useComposioForGoogleCalendar] = useState(false)
  const [googleCalendarConnected, setGoogleCalendarConnected] = useState(false)
  const [googleCalendarLoading, setGoogleCalendarLoading] = useState(true)
  const [googleCalendarConnecting, setGoogleCalendarConnecting] = useState(false)

  // Track connected providers for the completion step
  const connectedProviders = Object.entries(providerStates)
    .filter(([, state]) => state.isConnected)
    .map(([provider]) => provider)

  // Load available providers and composio-for-google flag on mount
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
    // (Composio Gmail/Calendar flag fetches removed — sync was deleted; flags stay false.)
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

  // Load Gmail connection status (Composio)
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

  // Handle Gmail connect button click (checks Composio config first)
  const handleConnectGmail = useCallback(async () => {
    const configResult = await window.ipc.invoke('composio:is-configured', null)
    if (!configResult.configured) {
      setComposioApiKeyTarget('gmail')
      setComposioApiKeyOpen(true)
      return
    }
    await startGmailConnect()
  }, [startGmailConnect])

  // Handle Composio API key submission
  const handleComposioApiKeySubmit = useCallback(async (apiKey: string) => {
    try {
      await window.ipc.invoke('composio:set-api-key', { apiKey })
      setComposioApiKeyOpen(false)
      toast.success('Composio API key saved')
      await startGmailConnect()
    } catch (error) {
      console.error('Failed to save Composio API key:', error)
      toast.error('Failed to save API key')
    }
  }, [startGmailConnect])

  // Load Google Calendar connection status (Composio)
  const refreshGoogleCalendarStatus = useCallback(async () => {
    try {
      setGoogleCalendarLoading(true)
      const result = await window.ipc.invoke('composio:get-connection-status', { toolkitSlug: 'googlecalendar' })
      setGoogleCalendarConnected(result.isConnected)
    } catch (error) {
      console.error('Failed to load Google Calendar status:', error)
      setGoogleCalendarConnected(false)
    } finally {
      setGoogleCalendarLoading(false)
    }
  }, [])

  // Connect to Google Calendar via Composio
  const startGoogleCalendarConnect = useCallback(async () => {
    try {
      setGoogleCalendarConnecting(true)
      const result = await window.ipc.invoke('composio:initiate-connection', { toolkitSlug: 'googlecalendar' })
      if (!result.success) {
        toast.error(result.error || 'Failed to connect to Google Calendar')
        setGoogleCalendarConnecting(false)
      }
    } catch (error) {
      console.error('Failed to connect to Google Calendar:', error)
      toast.error('Failed to connect to Google Calendar')
      setGoogleCalendarConnecting(false)
    }
  }, [])

  // Handle Google Calendar connect button click
  const handleConnectGoogleCalendar = useCallback(async () => {
    const configResult = await window.ipc.invoke('composio:is-configured', null)
    if (!configResult.configured) {
      setComposioApiKeyTarget('gmail')
      setComposioApiKeyOpen(true)
      return
    }
    await startGoogleCalendarConnect()
  }, [startGoogleCalendarConnect])

  // New step flow:
  // Rowboat path: 0 (welcome) → 2 (connect) → 3 (code mode) → 4 (done)
  // BYOK path: 0 (welcome) → 1 (llm setup) → 2 (connect) → 3 (code mode) → 4 (done)
  const handleNext = useCallback(() => {
    if (currentStep === 0) {
      setCurrentStep(1)
    } else if (currentStep === 1) {
      setCurrentStep(2)
    } else if (currentStep === 2) {
      setCurrentStep(3)
    } else if (currentStep === 3) {
      setCurrentStep(4)
    }
  }, [currentStep, onboardingPath])

  const handleBack = useCallback(() => {
    if (currentStep === 1) {
      setCurrentStep(0)
      setOnboardingPath(null)
    } else if (currentStep === 2) {
      setCurrentStep(1)
    } else if (currentStep === 3) {
      setCurrentStep(2)
    }
  }, [currentStep, onboardingPath])

  // Kept as no-arg handlers (rather than one that takes options) so the
  // completion step can pass them straight to onClick without the mouse
  // event leaking in as the options object.
  const handleComplete = useCallback(() => {
    onComplete()
  }, [onComplete])

  const handleCompleteWithTour = useCallback(() => {
    onComplete({ startTour: true })
  }, [onComplete])

  // Check connection status for all providers
  const refreshAllStatuses = useCallback(async () => {
    refreshGranolaConfig()
    refreshSlackConfig()

    // Refresh Gmail Composio status if enabled
    if (useComposioForGoogle) {
      refreshGmailStatus()
    }

    // Refresh Google Calendar Composio status if enabled
    if (useComposioForGoogleCalendar) {
      refreshGoogleCalendarStatus()
    }

    if (providers.length === 0) return

    const newStates: Record<string, ProviderState> = {}

    try {
      const result = await window.ipc.invoke('oauth:getState', null)
      const config = result.config || {}
      for (const provider of providers) {
        newStates[provider] = {
          isConnected: config[provider]?.connected ?? false,
          isLoading: false,
          isConnecting: false,
        }
      }
    } catch (error) {
      console.error('Failed to check connection status for providers:', error)
      for (const provider of providers) {
        newStates[provider] = {
          isConnected: false,
          isLoading: false,
          isConnecting: false,
        }
      }
    }

    setProviderStates(newStates)
  }, [providers, refreshGranolaConfig, refreshSlackConfig, refreshGmailStatus, useComposioForGoogle, refreshGoogleCalendarStatus, useComposioForGoogleCalendar])

  // Refresh statuses when modal opens or providers list changes
  useEffect(() => {
    if (open && providers.length > 0) {
      refreshAllStatuses()
    }
  }, [open, providers, refreshAllStatuses])

  // Listen for OAuth completion events (state updates only — toasts handled by ConnectorsPopover)
  useEffect(() => {
    const cleanup = window.ipc.on('oauth:didConnect', (event) => {
      const { provider, success } = event

      setProviderStates(prev => ({
        ...prev,
        [provider]: {
          isConnected: success,
          isLoading: false,
          isConnecting: false,
        }
      }))
    })

    return cleanup
  }, [])

  // Auto-advance from Rowboat sign-in step when OAuth completes
  useEffect(() => {
    if (onboardingPath !== 'rowboat' || currentStep !== 0) return

    const cleanup = window.ipc.on('oauth:didConnect', async (event) => {
      if (event.provider === 'rowboat' && event.success) {
        // (Composio Gmail/Calendar flag re-check removed — sync was deleted.)
        setCurrentStep(2) // Go to Connect Accounts
      }
    })

    return cleanup
  }, [onboardingPath, currentStep])

  // Listen for Composio connection events (state updates only — toasts handled by ConnectorsPopover)
  useEffect(() => {
    const cleanup = window.ipc.on('composio:didConnect', (event) => {
      const { toolkitSlug, success } = event

      if (toolkitSlug === 'slack') {
        setSlackEnabled(success)
      }

      if (toolkitSlug === 'gmail') {
        setGmailConnected(success)
        setGmailConnecting(false)
      }

      if (toolkitSlug === 'googlecalendar') {
        setGoogleCalendarConnected(success)
        setGoogleCalendarConnecting(false)
      }
    })

    return cleanup
  }, [])

  const startConnect = useCallback(async (provider: string, credentials?: { clientId: string; clientSecret: string }) => {
    setProviderStates(prev => ({
      ...prev,
      [provider]: { ...prev[provider], isConnecting: true }
    }))

    try {
      const result = await window.ipc.invoke('oauth:connect', { provider, clientId: credentials?.clientId, clientSecret: credentials?.clientSecret })

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

  // Connect to a provider
  const handleConnect = useCallback(async (provider: string) => {
    if (provider === 'google') {
      // Signed-in users use the rowboat (managed-credentials) flow: opens
      // the webapp in the browser, no BYOK modal. Falls back to BYOK modal
      // for not-signed-in users. (Mirrors useConnectors.handleConnect.)
      const isSignedIntoRowboat = providerStates.rowboat?.isConnected ?? false
      if (isSignedIntoRowboat) {
        await startConnect('google')
        return
      }
      setGoogleClientIdOpen(true)
      return
    }

    await startConnect(provider)
  }, [startConnect, providerStates])

  const handleGoogleClientIdSubmit = useCallback((clientId: string, clientSecret: string) => {
    setGoogleCredentials(clientId, clientSecret)
    setGoogleClientIdOpen(false)
    startConnect('google', { clientId, clientSecret })
  }, [startConnect])

  return {
    // Step state
    currentStep,
    setCurrentStep,
    onboardingPath,
    setOnboardingPath,

    // OAuth state
    providers,
    providersLoading,
    providerStates,
    googleClientIdOpen,
    setGoogleClientIdOpen,
    connectedProviders,
    handleConnect,
    handleGoogleClientIdSubmit,
    startConnect,

    // Granola state
    granolaEnabled,
    granolaLoading,
    handleGranolaToggle,

    // Slack state
    slackEnabled,
    slackLoading,
    slackWorkspaces,
    slackAvailableWorkspaces,
    slackSelectedUrls,
    setSlackSelectedUrls,
    slackPickerOpen,
    slackDiscovering,
    slackDiscoverError,
    handleSlackEnable,
    handleSlackSaveWorkspaces,
    handleSlackDisable,

    // Composio/Gmail state
    useComposioForGoogle,
    gmailConnected,
    gmailLoading,
    gmailConnecting,
    composioApiKeyOpen,
    setComposioApiKeyOpen,
    composioApiKeyTarget,
    handleConnectGmail,
    handleComposioApiKeySubmit,

    // Composio/Google Calendar state
    useComposioForGoogleCalendar,
    googleCalendarConnected,
    googleCalendarLoading,
    googleCalendarConnecting,
    handleConnectGoogleCalendar,

    // Navigation
    handleNext,
    handleBack,
    handleComplete,
    handleCompleteWithTour,
  }
}

export type OnboardingState = ReturnType<typeof useOnboardingState>
