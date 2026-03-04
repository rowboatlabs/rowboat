"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { Loader2, Mic, Mail, CheckCircle2 } from "lucide-react"
// import { MessageSquare } from "lucide-react"

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
import { ComposioApiKeyModal } from "@/components/composio-api-key-modal"
import { GoogleClientIdModal } from "@/components/google-client-id-modal"
import { getGoogleClientId, setGoogleClientId } from "@/lib/google-client-id-store"
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

type LlmProviderFlavor = "openai" | "anthropic" | "google" | "openrouter" | "aigateway" | "ollama" | "openai-compatible"

interface LlmModelOption {
  id: string
  name?: string
  release_date?: string
}

export function OnboardingModal({ open, onComplete }: OnboardingModalProps) {
  const [currentStep, setCurrentStep] = useState<Step>(0)

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

  // Composio/Slack state
  const [composioApiKeyOpen, setComposioApiKeyOpen] = useState(false)
  const [slackConnected, setSlackConnected] = useState(false)
  // const [slackLoading, setSlackLoading] = useState(true)
  const [slackConnecting, setSlackConnecting] = useState(false)

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

  // Load Slack connection status
  const refreshSlackStatus = useCallback(async () => {
    try {
      // setSlackLoading(true)
      const result = await window.ipc.invoke('composio:get-connection-status', { toolkitSlug: 'slack' })
      setSlackConnected(result.isConnected)
    } catch (error) {
      console.error('Failed to load Slack status:', error)
      setSlackConnected(false)
    } finally {
      // setSlackLoading(false)
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
  /*
  const handleConnectSlack = useCallback(async () => {
    // Check if Composio is configured
    const configResult = await window.ipc.invoke('composio:is-configured', null)
    if (!configResult.configured) {
      setComposioApiKeyOpen(true)
      return
    }
    await startSlackConnect()
  }, [startSlackConnect])
  */

  // Handle Composio API key submission
  const handleComposioApiKeySubmit = useCallback(async (apiKey: string) => {
    try {
      await window.ipc.invoke('composio:set-api-key', { apiKey })
      setComposioApiKeyOpen(false)
      toast.success('Composio API key saved')
      // Now start the Slack connection
      await startSlackConnect()
    } catch (error) {
      console.error('Failed to save Composio API key:', error)
      toast.error('Failed to save API key')
    }
  }, [startSlackConnect])

  const handleNext = () => {
    if (currentStep < 2) {
      setCurrentStep((prev) => (prev + 1) as Step)
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

    // Refresh Slack status
    refreshSlackStatus()

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
  }, [providers, refreshGranolaConfig, refreshSlackStatus])

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

      if (toolkitSlug === 'slack') {
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

  const startConnect = useCallback(async (provider: string, clientId?: string) => {
    setProviderStates(prev => ({
      ...prev,
      [provider]: { ...prev[provider], isConnecting: true }
    }))

    try {
      const result = await window.ipc.invoke('oauth:connect', { provider, clientId })

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
    startConnect('google', clientId)
  }, [startConnect])

  // Step indicator
  const renderStepIndicator = () => (
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

  // Render Slack row
  /*
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
  */

  // Step 0: LLM Setup
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

        <div className="flex flex-col gap-3 mt-4">
          <Button
            onClick={handleTestAndSaveLlmConfig}
            size="lg"
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

  // Step 1: Connect Accounts
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
            {/* Email & Calendar Section */}
            {providers.includes('google') && (
              <div className="space-y-2">
                <div className="px-3">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email & Calendar</span>
                </div>
                {renderOAuthProvider('google', 'Google', <Mail className="size-5" />, 'Sync emails and calendar events')}
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
  const renderCompletionStep = () => {
    const hasConnections = connectedProviders.length > 0 || granolaEnabled || slackConnected

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
      isSubmitting={slackConnecting}
    />
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="w-[60vw] max-w-3xl max-h-[80vh] overflow-y-auto"
        showCloseButton={false}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {renderStepIndicator()}
        {currentStep === 0 && renderLlmSetupStep()}
        {currentStep === 1 && renderAccountConnectionStep()}
        {currentStep === 2 && renderCompletionStep()}
      </DialogContent>
    </Dialog>
    </>
  )
}
