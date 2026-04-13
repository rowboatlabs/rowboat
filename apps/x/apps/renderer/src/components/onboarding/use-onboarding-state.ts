import { useState, useEffect, useCallback } from "react"
import { setGoogleCredentials } from "@/lib/google-credentials-store"
import { toast } from "sonner"

export interface ProviderState {
  isConnected: boolean
  isLoading: boolean
  isConnecting: boolean
}

export type Step = 0 | 1 | 2 | 3

export type OnboardingPath = 'rowboat' | 'byok' | null

export type LlmProviderFlavor = "openai" | "anthropic" | "google" | "openrouter" | "aigateway" | "ollama" | "openai-compatible"

export interface LlmModelOption {
  id: string
  name?: string
  release_date?: string
}

export function useOnboardingState(open: boolean, onComplete: () => void) {
  const [currentStep, setCurrentStep] = useState<Step>(0)
  const [onboardingPath, setOnboardingPath] = useState<OnboardingPath>(null)

  // LLM setup state
  const [llmProvider, setLlmProvider] = useState<LlmProviderFlavor>("openai")
  const [modelsCatalog, setModelsCatalog] = useState<Record<string, LlmModelOption[]>>({})
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [providerConfigs, setProviderConfigs] = useState<Record<LlmProviderFlavor, { apiKey: string; baseURL: string; model: string; knowledgeGraphModel: string }>>({
    openai: { apiKey: "", baseURL: "", model: "", knowledgeGraphModel: "" },
    anthropic: { apiKey: "", baseURL: "", model: "", knowledgeGraphModel: "" },
    google: { apiKey: "", baseURL: "", model: "", knowledgeGraphModel: "" },
    openrouter: { apiKey: "", baseURL: "", model: "", knowledgeGraphModel: "" },
    aigateway: { apiKey: "", baseURL: "", model: "", knowledgeGraphModel: "" },
    ollama: { apiKey: "", baseURL: "http://localhost:11434", model: "", knowledgeGraphModel: "" },
    "openai-compatible": { apiKey: "", baseURL: "http://localhost:1234/v1", model: "", knowledgeGraphModel: "" },
  })
  const [testState, setTestState] = useState<{ status: "idle" | "testing" | "success" | "error"; error?: string }>({
    status: "idle",
  })
  const [showMoreProviders, setShowMoreProviders] = useState(false)

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

  // Inline upsell callout dismissed
  const [upsellDismissed, setUpsellDismissed] = useState(false)

  // Composio/Gmail state (used when signed in with Rowboat account)
  const [useComposioForGoogle, setUseComposioForGoogle] = useState(false)
  const [gmailConnected, setGmailConnected] = useState(false)
  const [gmailLoading, setGmailLoading] = useState(true)
  const [gmailConnecting, setGmailConnecting] = useState(false)
  const [composioApiKeyOpen, setComposioApiKeyOpen] = useState(false)
  const [composioApiKeyTarget, setComposioApiKeyTarget] = useState<'slack' | 'gmail'>('gmail')

  // Composio/Google Calendar state
  const [useComposioForGoogleCalendar, setUseComposioForGoogleCalendar] = useState(false)
  const [googleCalendarConnected, setGoogleCalendarConnected] = useState(false)
  const [googleCalendarLoading, setGoogleCalendarLoading] = useState(true)
  const [googleCalendarConnecting, setGoogleCalendarConnecting] = useState(false)

  const updateProviderConfig = useCallback(
    (provider: LlmProviderFlavor, updates: Partial<{ apiKey: string; baseURL: string; model: string; knowledgeGraphModel: string }>) => {
      setProviderConfigs(prev => ({
        ...prev,
        [provider]: { ...prev[provider], ...updates },
      }))
      setTestState({ status: "idle" })
    },
    []
  )

  const activeConfig = providerConfigs[llmProvider]
  const showApiKey = llmProvider === "openai" || llmProvider === "anthropic" || llmProvider === "google" || llmProvider === "openrouter" || llmProvider === "aigateway" || llmProvider === "openai-compatible"
  const requiresApiKey = llmProvider === "openai" || llmProvider === "anthropic" || llmProvider === "google" || llmProvider === "openrouter" || llmProvider === "aigateway"
  const requiresBaseURL = llmProvider === "ollama" || llmProvider === "openai-compatible"
  const showBaseURL = llmProvider === "ollama" || llmProvider === "openai-compatible" || llmProvider === "aigateway"
  const isLocalProvider = llmProvider === "ollama" || llmProvider === "openai-compatible"
  const canTest =
    activeConfig.model.trim().length > 0 &&
    (!requiresApiKey || activeConfig.apiKey.trim().length > 0) &&
    (!requiresBaseURL || activeConfig.baseURL.trim().length > 0)

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
    async function loadComposioForGoogleFlag() {
      try {
        const result = await window.ipc.invoke('composio:use-composio-for-google', null)
        setUseComposioForGoogle(result.enabled)
      } catch (error) {
        console.error('Failed to check composio-for-google flag:', error)
      }
    }
    async function loadComposioForGoogleCalendarFlag() {
      try {
        const result = await window.ipc.invoke('composio:use-composio-for-google-calendar', null)
        setUseComposioForGoogleCalendar(result.enabled)
      } catch (error) {
        console.error('Failed to check composio-for-google-calendar flag:', error)
      }
    }
    loadProviders()
    loadComposioForGoogleFlag()
    loadComposioForGoogleCalendarFlag()
  }, [open])

  // Load LLM models catalog on open
  useEffect(() => {
    if (!open) return

    async function loadModels() {
      try {
        setModelsLoading(true)
        setModelsError(null)
        const result = await window.ipc.invoke("models:list", null)
        const catalog: Record<string, LlmModelOption[]> = {}
        for (const provider of result.providers || []) {
          catalog[provider.id] = provider.models || []
        }
        setModelsCatalog(catalog)
      } catch (error) {
        console.error("Failed to load models catalog:", error)
        setModelsError("Failed to load models list")
        setModelsCatalog({})
      } finally {
        setModelsLoading(false)
      }
    }

    loadModels()
  }, [open])

  // Preferred default models for each provider
  const preferredDefaults: Partial<Record<LlmProviderFlavor, string>> = {
    openai: "gpt-5.2",
    anthropic: "claude-opus-4-6-20260202",
  }

  // Initialize default models from catalog
  useEffect(() => {
    if (Object.keys(modelsCatalog).length === 0) return
    setProviderConfigs(prev => {
      const next = { ...prev }
      const cloudProviders: LlmProviderFlavor[] = ["openai", "anthropic", "google"]
      for (const provider of cloudProviders) {
        const models = modelsCatalog[provider]
        if (models?.length && !next[provider].model) {
          const preferredModel = preferredDefaults[provider]
          const hasPreferred = preferredModel && models.some(m => m.id === preferredModel)
          next[provider] = { ...next[provider], model: hasPreferred ? preferredModel : (models[0]?.id || "") }
        }
      }
      return next
    })
  }, [modelsCatalog])

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
  // Rowboat path: 0 (welcome) → 2 (connect) → 3 (done)
  // BYOK path: 0 (welcome) → 1 (llm setup) → 2 (connect) → 3 (done)
  const handleNext = useCallback(() => {
    if (currentStep === 0) {
      if (onboardingPath === 'byok') {
        setCurrentStep(1)
      } else {
        setCurrentStep(2)
      }
    } else if (currentStep === 1) {
      setCurrentStep(2)
    } else if (currentStep === 2) {
      setCurrentStep(3)
    }
  }, [currentStep, onboardingPath])

  const handleBack = useCallback(() => {
    if (currentStep === 1) {
      setCurrentStep(0)
      setOnboardingPath(null)
    } else if (currentStep === 2) {
      if (onboardingPath === 'rowboat') {
        setCurrentStep(0)
      } else {
        setCurrentStep(1)
      }
    }
  }, [currentStep, onboardingPath])

  const handleComplete = useCallback(() => {
    onComplete()
  }, [onComplete])

  const handleTestAndSaveLlmConfig = useCallback(async () => {
    if (!canTest) return
    setTestState({ status: "testing" })
    try {
      const apiKey = activeConfig.apiKey.trim() || undefined
      const baseURL = activeConfig.baseURL.trim() || undefined
      const model = activeConfig.model.trim()
      const knowledgeGraphModel = activeConfig.knowledgeGraphModel.trim() || undefined
      const providerConfig = {
        provider: {
          flavor: llmProvider,
          apiKey,
          baseURL,
        },
        model,
        knowledgeGraphModel,
      }
      const result = await window.ipc.invoke("models:test", providerConfig)
      if (result.success) {
        setTestState({ status: "success" })
        await window.ipc.invoke("models:saveConfig", providerConfig)
        window.dispatchEvent(new Event('models-config-changed'))
        handleNext()
      } else {
        setTestState({ status: "error", error: result.error })
        toast.error(result.error || "Connection test failed")
      }
    } catch (error) {
      console.error("Connection test failed:", error)
      setTestState({ status: "error", error: "Connection test failed" })
      toast.error("Connection test failed")
    }
  }, [activeConfig.apiKey, activeConfig.baseURL, activeConfig.model, activeConfig.knowledgeGraphModel, canTest, llmProvider, handleNext])

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
        // Re-check composio flags now that the account is connected
        try {
          const [googleResult, calendarResult] = await Promise.all([
            window.ipc.invoke('composio:use-composio-for-google', null),
            window.ipc.invoke('composio:use-composio-for-google-calendar', null),
          ])
          setUseComposioForGoogle(googleResult.enabled)
          setUseComposioForGoogleCalendar(calendarResult.enabled)
        } catch (error) {
          console.error('Failed to re-check composio flags:', error)
        }
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
      setGoogleClientIdOpen(true)
      return
    }

    await startConnect(provider)
  }, [startConnect])

  const handleGoogleClientIdSubmit = useCallback((clientId: string, clientSecret: string) => {
    setGoogleCredentials(clientId, clientSecret)
    setGoogleClientIdOpen(false)
    startConnect('google', { clientId, clientSecret })
  }, [startConnect])

  // Switch to rowboat path from BYOK inline callout
  const handleSwitchToRowboat = useCallback(() => {
    setOnboardingPath('rowboat')
    setCurrentStep(0)
  }, [])

  return {
    // Step state
    currentStep,
    setCurrentStep,
    onboardingPath,
    setOnboardingPath,

    // LLM state
    llmProvider,
    setLlmProvider,
    modelsCatalog,
    modelsLoading,
    modelsError,
    providerConfigs,
    activeConfig,
    testState,
    setTestState,
    showApiKey,
    requiresApiKey,
    requiresBaseURL,
    showBaseURL,
    isLocalProvider,
    canTest,
    showMoreProviders,
    setShowMoreProviders,
    updateProviderConfig,
    handleTestAndSaveLlmConfig,

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

    // Upsell
    upsellDismissed,
    setUpsellDismissed,

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
    handleSwitchToRowboat,
  }
}

export type OnboardingState = ReturnType<typeof useOnboardingState>
