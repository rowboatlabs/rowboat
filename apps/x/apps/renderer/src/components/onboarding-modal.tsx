"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { Loader2, Mic, Mail, Calendar, CheckCircle2, ArrowLeft, MessageSquare } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { GoogleClientIdModal } from "@/components/google-client-id-modal"
import { setGoogleCredentials } from "@/lib/google-credentials-store"
import { toast } from "sonner"
import { ComposioApiKeyModal } from "@/components/composio-api-key-modal"

interface ProviderState {
  isConnected: boolean
  isLoading: boolean
  isConnecting: boolean
}

interface OnboardingModalProps {
  open: boolean
  onComplete: () => void
}

type Step = 0 | 1 | 2 | 3 | 4

type OnboardingPath = 'rowboat' | 'byok' | null

type LlmProviderFlavor = "openai" | "anthropic" | "google" | "openrouter" | "aigateway" | "ollama" | "openai-compatible"

interface LlmModelOption {
  id: string
  name?: string
  release_date?: string
}

export function OnboardingModal({ open, onComplete }: OnboardingModalProps) {
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
  // OAuth provider states
  const [providers, setProviders] = useState<string[]>([])
  const [providersLoading, setProvidersLoading] = useState(true)
  const [providerStates, setProviderStates] = useState<Record<string, ProviderState>>({})
  const [googleClientIdOpen, setGoogleClientIdOpen] = useState(false)

  // Granola state
  const [granolaEnabled, setGranolaEnabled] = useState(false)
  const [granolaLoading, setGranolaLoading] = useState(true)
  const [showMoreProviders, setShowMoreProviders] = useState(false)

  // Composio API key state
  const [composioApiKeyOpen, setComposioApiKeyOpen] = useState(false)
  const [, setComposioApiKeyTarget] = useState<'slack' | 'gmail'>('gmail')

  // Slack state (agent-slack CLI)
  const [slackEnabled, setSlackEnabled] = useState(false)
  const [slackLoading, setSlackLoading] = useState(true)
  const [slackWorkspaces, setSlackWorkspaces] = useState<Array<{ url: string; name: string }>>([])
  const [slackAvailableWorkspaces, setSlackAvailableWorkspaces] = useState<Array<{ url: string; name: string }>>([])
  const [slackSelectedUrls, setSlackSelectedUrls] = useState<Set<string>>(new Set())
  const [slackPickerOpen, setSlackPickerOpen] = useState(false)
  const [slackDiscovering, setSlackDiscovering] = useState(false)
  const [slackDiscoverError, setSlackDiscoverError] = useState<string | null>(null)

  // Composio/Gmail state
  const [useComposioForGoogle, setUseComposioForGoogle] = useState(false)
  const [gmailConnected, setGmailConnected] = useState(false)
  const [gmailLoading, setGmailLoading] = useState(true)
  const [gmailConnecting, setGmailConnecting] = useState(false)

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
          // Check if preferred default exists in the catalog
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

  // Load Google Calendar connection status
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

  const handleNext = () => {
    if (currentStep < 4) {
      setCurrentStep((prev) => (prev + 1) as Step)
    }
  }

  const handleBack = () => {
    if (currentStep === 1) {
      // BYOK upsell → back to sign-in page
      setOnboardingPath(null)
      setCurrentStep(0 as Step)
    } else if (currentStep === 2) {
      // LLM setup → back to BYOK upsell
      setCurrentStep(1 as Step)
    } else if (currentStep === 3) {
      // Connect accounts → back depends on path
      if (onboardingPath === 'rowboat') {
        setCurrentStep(0 as Step)
      } else {
        setCurrentStep(2 as Step)
      }
    }
  }

  const handleComplete = () => {
    onComplete()
  }

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
        // Save and continue
        await window.ipc.invoke("models:saveConfig", providerConfig)
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
  }, [activeConfig.apiKey, activeConfig.baseURL, activeConfig.model, canTest, llmProvider, handleNext])

  // Check connection status for all providers
  const refreshAllStatuses = useCallback(async () => {
    // Refresh Granola
    refreshGranolaConfig()

    // Refresh Slack config
    refreshSlackConfig()

    // Refresh Gmail Composio status if enabled
    if (useComposioForGoogle) {
      refreshGmailStatus()
    }

    // Refresh Google Calendar Composio status if enabled
    if (useComposioForGoogleCalendar) {
      refreshGoogleCalendarStatus()
    }

    // Refresh OAuth providers
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

    const cleanup = window.ipc.on('oauth:didConnect', (event) => {
      if (event.provider === 'rowboat' && event.success) {
        setCurrentStep(3 as Step)
      }
    })

    return cleanup
  }, [onboardingPath, currentStep])

  // Listen for Composio connection events (state updates only — toasts handled by ConnectorsPopover)
  useEffect(() => {
    const cleanup = window.ipc.on('composio:didConnect', (event) => {
      const { toolkitSlug, success } = event

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

  // Step indicator - dynamic based on path
  const renderStepIndicator = () => {
    // Rowboat path: Sign In (0), Connect (3), Done (4) = 3 dots
    // BYOK path: Sign In (0), Upsell (1), Model (2), Connect (3), Done (4) = 5 dots
    // Before path is chosen: show 3 dots (minimal)
    const rowboatSteps = [0, 3, 4]
    const byokSteps = [0, 1, 2, 3, 4]
    const steps = onboardingPath === 'byok' ? byokSteps : rowboatSteps
    const currentIndex = steps.indexOf(currentStep)

    return (
      <div className="flex gap-2 justify-center mb-6">
        {steps.map((_, i) => (
          <div
            key={i}
            className={cn(
              "w-2 h-2 rounded-full transition-colors",
              currentIndex >= i ? "bg-primary" : "bg-muted"
            )}
          />
        ))}
      </div>
    )
  }

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

  // Render Gmail Composio row
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
            <span className="text-xs text-muted-foreground truncate">
              Sync emails
            </span>
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

  // Render Google Calendar Composio row
  const renderGoogleCalendarRow = () => (
    <div className="flex items-center justify-between gap-3 rounded-md px-3 py-3 hover:bg-accent">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex size-10 items-center justify-center rounded-md bg-muted">
          <Calendar className="size-5" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium truncate">Google Calendar</span>
          {googleCalendarLoading ? (
            <span className="text-xs text-muted-foreground">Checking...</span>
          ) : (
            <span className="text-xs text-muted-foreground truncate">
              Sync calendar events
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0">
        {googleCalendarLoading ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : googleCalendarConnected ? (
          <div className="flex items-center gap-1.5 text-sm text-green-600">
            <CheckCircle2 className="size-4" />
            <span>Connected</span>
          </div>
        ) : (
          <Button
            variant="default"
            size="sm"
            onClick={handleConnectGoogleCalendar}
            disabled={googleCalendarConnecting}
          >
            {googleCalendarConnecting ? (
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
    <div className="rounded-md px-3 py-3 hover:bg-accent">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex size-10 items-center justify-center rounded-md bg-muted">
            <MessageSquare className="size-5" />
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
            >
              Enable
            </Button>
          )}
        </div>
      </div>
      {slackPickerOpen && (
        <div className="mt-2 ml-13 space-y-2">
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
              >
                Save
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )

  // Step 0: Sign in to Rowboat (with BYOK option)
  const renderSignInStep = () => {
    const rowboatState = providerStates['rowboat'] || { isConnected: false, isLoading: false, isConnecting: false }

    return (
      <div className="flex flex-col items-center text-center">
        <div className="flex items-center justify-center gap-3 mb-3">
          <span className="text-lg font-medium text-muted-foreground">Your AI coworker, with memory</span>
        </div>
        <DialogHeader className="space-y-3 mb-8">
          <DialogTitle className="text-2xl">Sign in to Rowboat</DialogTitle>
          <DialogDescription className="text-base max-w-md mx-auto">
            Connect your Rowboat account for instant access to all models through our gateway — no API keys needed.
          </DialogDescription>
        </DialogHeader>

        {rowboatState.isConnected ? (
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="size-5" />
              <span className="text-sm font-medium">Connected to Rowboat</span>
            </div>
            <Button onClick={() => setCurrentStep(3 as Step)} size="lg" className="w-full max-w-xs">
              Continue
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 w-full max-w-xs">
            <Button
              onClick={() => {
                setOnboardingPath('rowboat')
                startConnect('rowboat')
              }}
              size="lg"
              className="w-full"
              disabled={rowboatState.isConnecting}
            >
              {rowboatState.isConnecting ? (
                <><Loader2 className="size-4 animate-spin mr-2" />Waiting for sign in...</>
              ) : (
                "Sign in with Rowboat"
              )}
            </Button>
            {rowboatState.isConnecting && (
              <p className="text-xs text-muted-foreground">
                Complete sign in in your browser, then return here.
              </p>
            )}
          </div>
        )}

        <div className="w-full flex justify-end mt-8">
          <button
            onClick={() => {
              setOnboardingPath('byok')
              setCurrentStep(1 as Step)
            }}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Bring your own key
          </button>
        </div>
      </div>
    )
  }

  // Step 1: BYOK upsell — explain benefits of Rowboat before continuing with BYOK
  const renderByokUpsellStep = () => (
    <div className="flex flex-col">
      <DialogHeader className="text-center mb-6">
        <DialogTitle className="text-2xl">Before you continue</DialogTitle>
        <DialogDescription className="text-base max-w-md mx-auto">
          With a Rowboat account, you get:
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 mb-8">
        <div className="flex items-start gap-3 rounded-md border px-4 py-3">
          <CheckCircle2 className="size-5 text-green-600 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-medium">Instant access to all models</div>
            <div className="text-xs text-muted-foreground">GPT, Claude, Gemini, and more — no separate API keys needed</div>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-md border px-4 py-3">
          <CheckCircle2 className="size-5 text-green-600 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-medium">Simplified billing</div>
            <div className="text-xs text-muted-foreground">One account for everything — no juggling multiple provider subscriptions</div>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-md border px-4 py-3">
          <CheckCircle2 className="size-5 text-green-600 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-medium">Automatic updates</div>
            <div className="text-xs text-muted-foreground">New models are available as soon as they launch, with no configuration changes</div>
          </div>
        </div>
      </div>

      <p className="text-sm text-muted-foreground text-center mb-6">
        By continuing, you'll set up your own API keys instead of using Rowboat's managed gateway.
      </p>

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={handleBack} className="gap-1">
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <Button onClick={handleNext}>
          I understand
        </Button>
      </div>
    </div>
  )

  // Step 2 (BYOK path): LLM Setup
  const renderLlmSetupStep = () => {
    const primaryProviders: Array<{ id: LlmProviderFlavor; name: string; description: string }> = [
      { id: "openai", name: "OpenAI", description: "Use your OpenAI API key" },
      { id: "anthropic", name: "Anthropic", description: "Use your Anthropic API key" },
      { id: "google", name: "Gemini", description: "Use your Google AI Studio key" },
      { id: "ollama", name: "Ollama (Local)", description: "Run a local model via Ollama" },
    ]

    const moreProviders: Array<{ id: LlmProviderFlavor; name: string; description: string }> = [
      { id: "openrouter", name: "OpenRouter", description: "Access multiple models with one key" },
      { id: "aigateway", name: "AI Gateway (Vercel)", description: "Use Vercel's AI Gateway" },
      { id: "openai-compatible", name: "OpenAI-Compatible", description: "Local or hosted OpenAI-compatible API" },
    ]

    const isMoreProvider = moreProviders.some(p => p.id === llmProvider)

    const modelsForProvider = modelsCatalog[llmProvider] || []
    const showModelInput = isLocalProvider || modelsForProvider.length === 0

    const renderProviderCard = (provider: { id: LlmProviderFlavor; name: string; description: string }) => (
      <button
        key={provider.id}
        onClick={() => {
          setLlmProvider(provider.id)
          setTestState({ status: "idle" })
        }}
        className={cn(
          "rounded-md border px-3 py-3 text-left transition-colors",
          llmProvider === provider.id
            ? "border-primary bg-primary/5"
            : "border-border hover:bg-accent"
        )}
      >
        <div className="text-sm font-medium">{provider.name}</div>
        <div className="text-xs text-muted-foreground mt-1">{provider.description}</div>
      </button>
    )

    return (
      <div className="flex flex-col">
        <div className="flex items-center justify-center gap-3 mb-3">
          <span className="text-lg font-medium text-muted-foreground">Your AI coworker, with memory</span>
        </div>
        <DialogHeader className="text-center mb-3">
          <DialogTitle className="text-2xl">Choose your model</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Provider</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {primaryProviders.map(renderProviderCard)}
            </div>
            {(showMoreProviders || isMoreProvider) ? (
              <div className="grid gap-2 sm:grid-cols-2 mt-2">
                {moreProviders.map(renderProviderCard)}
              </div>
            ) : (
              <button
                onClick={() => setShowMoreProviders(true)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
              >
                More providers...
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Assistant model</span>
              {modelsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading...
                </div>
              ) : showModelInput ? (
                <Input
                  value={activeConfig.model}
                  onChange={(e) => updateProviderConfig(llmProvider, { model: e.target.value })}
                  placeholder="Enter model"
                />
              ) : (
                <Select
                  value={activeConfig.model}
                  onValueChange={(value) => updateProviderConfig(llmProvider, { model: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                  <SelectContent>
                    {modelsForProvider.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name || model.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {modelsError && (
                <div className="text-xs text-destructive">{modelsError}</div>
              )}
            </div>

            <div className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Knowledge graph model</span>
              {modelsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading...
                </div>
              ) : showModelInput ? (
                <Input
                  value={activeConfig.knowledgeGraphModel}
                  onChange={(e) => updateProviderConfig(llmProvider, { knowledgeGraphModel: e.target.value })}
                  placeholder={activeConfig.model || "Enter model"}
                />
              ) : (
                <Select
                  value={activeConfig.knowledgeGraphModel || "__same__"}
                  onValueChange={(value) => updateProviderConfig(llmProvider, { knowledgeGraphModel: value === "__same__" ? "" : value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__same__">Same as assistant</SelectItem>
                    {modelsForProvider.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name || model.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {showApiKey && (
            <div className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {llmProvider === "openai-compatible" ? "API Key (optional)" : "API Key"}
              </span>
              <Input
                type="password"
                value={activeConfig.apiKey}
                onChange={(e) => updateProviderConfig(llmProvider, { apiKey: e.target.value })}
                placeholder="Paste your API key"
              />
            </div>
          )}

          {showBaseURL && (
            <div className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Base URL</span>
              <Input
                value={activeConfig.baseURL}
                onChange={(e) => updateProviderConfig(llmProvider, { baseURL: e.target.value })}
                placeholder={
                  llmProvider === "ollama"
                    ? "http://localhost:11434"
                    : llmProvider === "openai-compatible"
                      ? "http://localhost:1234/v1"
                      : "https://ai-gateway.vercel.sh/v1"
                }
              />
            </div>
          )}
        </div>

        {testState.status === "error" && (
          <div className="mt-4 text-sm text-destructive">
            {testState.error || "Connection test failed"}
          </div>
        )}

        <div className="flex items-center justify-between mt-4">
          <Button variant="ghost" onClick={handleBack} className="gap-1">
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <Button
            onClick={handleTestAndSaveLlmConfig}
            disabled={!canTest || testState.status === "testing"}
          >
            {testState.status === "testing" ? (
              <><Loader2 className="size-4 animate-spin mr-2" />Testing connection...</>
            ) : (
              "Continue"
            )}
          </Button>
        </div>
      </div>
    )
  }

  // Step 3: Connect Accounts
  const renderAccountConnectionStep = () => (
    <div className="flex flex-col">
      <DialogHeader className="text-center mb-6">
        <DialogTitle className="text-2xl">Connect Your Accounts</DialogTitle>
        <DialogDescription className="text-base">
          Connect your accounts to start syncing your data locally. You can always add more later.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {providersLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Email / Email & Calendar Section */}
            {(useComposioForGoogle || useComposioForGoogleCalendar || providers.includes('google')) && (
              <div className="space-y-2">
                <div className="px-3">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {(useComposioForGoogle || useComposioForGoogleCalendar) ? 'Email & Calendar' : 'Email & Calendar'}
                  </span>
                </div>
                {useComposioForGoogle
                  ? renderGmailRow()
                  : renderOAuthProvider('google', 'Google', <Mail className="size-5" />, 'Sync emails and calendar events')
                }
                {useComposioForGoogleCalendar && renderGoogleCalendarRow()}
              </div>
            )}

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
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={handleBack} className="gap-1">
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <Button variant="ghost" onClick={handleNext} className="text-muted-foreground">
            Skip for now
          </Button>
        </div>
      </div>
    </div>
  )

  // Step 4: Completion
  const renderCompletionStep = () => {
    const hasConnections = connectedProviders.length > 0 || granolaEnabled || slackEnabled || gmailConnected || googleCalendarConnected

    return (
      <div className="flex flex-col items-center text-center">
        <div className="flex size-20 items-center justify-center rounded-full bg-green-100 mb-6">
          <CheckCircle2 className="size-10 text-green-600" />
        </div>
        <DialogHeader className="space-y-3">
          <DialogTitle className="text-2xl">You're All Set!</DialogTitle>
          <DialogDescription className="text-base max-w-md mx-auto">
            {hasConnections ? (
              <>Give me 30 minutes to build your context graph.<br />I can still help with other things on your computer.</>
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
                {googleCalendarConnected && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="size-4 text-green-600" />
                    <span>Google Calendar</span>
                  </div>
                )}
                {connectedProviders.includes('google') && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="size-4 text-green-600" />
                    <span>Google (Email & Calendar)</span>
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
                {slackEnabled && (
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
    <GoogleClientIdModal
      open={googleClientIdOpen}
      onOpenChange={setGoogleClientIdOpen}
      onSubmit={handleGoogleClientIdSubmit}
      isSubmitting={providerStates.google?.isConnecting ?? false}
    />
    <ComposioApiKeyModal
      open={composioApiKeyOpen}
      onOpenChange={setComposioApiKeyOpen}
      onSubmit={handleComposioApiKeySubmit}
      isSubmitting={gmailConnecting}
    />
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="w-[60vw] max-w-3xl max-h-[80vh] overflow-y-auto"
        showCloseButton={false}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {renderStepIndicator()}
        {currentStep === 0 && renderSignInStep()}
        {currentStep === 1 && renderByokUpsellStep()}
        {currentStep === 2 && renderLlmSetupStep()}
        {currentStep === 3 && renderAccountConnectionStep()}
        {currentStep === 4 && renderCompletionStep()}
      </DialogContent>
    </Dialog>
    </>
  )
}
