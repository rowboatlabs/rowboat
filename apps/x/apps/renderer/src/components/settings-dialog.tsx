"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { Server, Key, Shield, Palette, Monitor, Sun, Moon, Loader2, CheckCircle2, Plus, X, Wrench, Search, ChevronDown, ChevronRight, Check, Link2, Unlink } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { useTheme } from "@/contexts/theme-context"
import { toast } from "sonner"

type ConfigTab = "models" | "mcp" | "security" | "appearance" | "tools"

interface TabConfig {
  id: ConfigTab
  label: string
  icon: React.ElementType
  path?: string
  description: string
}

const tabs: TabConfig[] = [
  {
    id: "models",
    label: "Models",
    icon: Key,
    path: "config/models.json",
    description: "Configure LLM providers and API keys",
  },
  {
    id: "mcp",
    label: "MCP Servers",
    icon: Server,
    path: "config/mcp.json",
    description: "Configure MCP server connections",
  },
  {
    id: "security",
    label: "Security",
    icon: Shield,
    path: "config/security.json",
    description: "Configure allowed shell commands",
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: Palette,
    description: "Customize the look and feel",
  },
  {
    id: "tools",
    label: "Tools Library",
    icon: Wrench,
    description: "Browse and enable Composio toolkits",
  },
]

interface SettingsDialogProps {
  children: React.ReactNode
}

// --- Theme option for Appearance tab ---

function ThemeOption({
  label,
  icon: Icon,
  isSelected,
  onClick,
}: {
  label: string
  icon: React.ElementType
  isSelected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all",
        isSelected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/50 hover:bg-muted/50"
      )}
    >
      <Icon className={cn("size-6", isSelected ? "text-primary" : "text-muted-foreground")} />
      <span className={cn("text-sm font-medium", isSelected ? "text-primary" : "text-foreground")}>
        {label}
      </span>
    </button>
  )
}

function AppearanceSettings() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-medium mb-3">Theme</h4>
        <p className="text-xs text-muted-foreground mb-4">
          Select your preferred color scheme
        </p>
        <div className="grid grid-cols-3 gap-3">
          <ThemeOption
            label="Light"
            icon={Sun}
            isSelected={theme === "light"}
            onClick={() => setTheme("light")}
          />
          <ThemeOption
            label="Dark"
            icon={Moon}
            isSelected={theme === "dark"}
            onClick={() => setTheme("dark")}
          />
          <ThemeOption
            label="System"
            icon={Monitor}
            isSelected={theme === "system"}
            onClick={() => setTheme("system")}
          />
        </div>
      </div>
    </div>
  )
}

// --- Model Settings UI ---

type LlmProviderFlavor = "openai" | "anthropic" | "google" | "openrouter" | "aigateway" | "ollama" | "openai-compatible"

interface LlmModelOption {
  id: string
  name?: string
  release_date?: string
}

const primaryProviders: Array<{ id: LlmProviderFlavor; name: string; description: string }> = [
  { id: "openai", name: "OpenAI", description: "GPT models" },
  { id: "anthropic", name: "Anthropic", description: "Claude models" },
  { id: "google", name: "Gemini", description: "Google AI Studio" },
  { id: "ollama", name: "Ollama (Local)", description: "Run models locally" },
]

const moreProviders: Array<{ id: LlmProviderFlavor; name: string; description: string }> = [
  { id: "openrouter", name: "OpenRouter", description: "Multiple models, one key" },
  { id: "aigateway", name: "AI Gateway (Vercel)", description: "Vercel's AI Gateway" },
  { id: "openai-compatible", name: "OpenAI-Compatible", description: "Custom OpenAI-compatible API" },
]

const preferredDefaults: Partial<Record<LlmProviderFlavor, string>> = {
  openai: "gpt-5.2",
  anthropic: "claude-opus-4-6-20260202",
}

const defaultBaseURLs: Partial<Record<LlmProviderFlavor, string>> = {
  ollama: "http://localhost:11434",
  "openai-compatible": "http://localhost:1234/v1",
}

function ModelSettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [provider, setProvider] = useState<LlmProviderFlavor>("openai")
  const [defaultProvider, setDefaultProvider] = useState<LlmProviderFlavor | null>(null)
  const [providerConfigs, setProviderConfigs] = useState<Record<LlmProviderFlavor, { apiKey: string; baseURL: string; models: string[]; knowledgeGraphModel: string }>>({
    openai: { apiKey: "", baseURL: "", models: [""], knowledgeGraphModel: "" },
    anthropic: { apiKey: "", baseURL: "", models: [""], knowledgeGraphModel: "" },
    google: { apiKey: "", baseURL: "", models: [""], knowledgeGraphModel: "" },
    openrouter: { apiKey: "", baseURL: "", models: [""], knowledgeGraphModel: "" },
    aigateway: { apiKey: "", baseURL: "", models: [""], knowledgeGraphModel: "" },
    ollama: { apiKey: "", baseURL: "http://localhost:11434", models: [""], knowledgeGraphModel: "" },
    "openai-compatible": { apiKey: "", baseURL: "http://localhost:1234/v1", models: [""], knowledgeGraphModel: "" },
  })
  const [modelsCatalog, setModelsCatalog] = useState<Record<string, LlmModelOption[]>>({})
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [testState, setTestState] = useState<{ status: "idle" | "testing" | "success" | "error"; error?: string }>({ status: "idle" })
  const [configLoading, setConfigLoading] = useState(true)
  const [showMoreProviders, setShowMoreProviders] = useState(false)

  const activeConfig = providerConfigs[provider]
  const showApiKey = provider === "openai" || provider === "anthropic" || provider === "google" || provider === "openrouter" || provider === "aigateway" || provider === "openai-compatible"
  const requiresApiKey = provider === "openai" || provider === "anthropic" || provider === "google" || provider === "openrouter" || provider === "aigateway"
  const showBaseURL = provider === "ollama" || provider === "openai-compatible" || provider === "aigateway"
  const requiresBaseURL = provider === "ollama" || provider === "openai-compatible"
  const isLocalProvider = provider === "ollama" || provider === "openai-compatible"
  const modelsForProvider = modelsCatalog[provider] || []
  const showModelInput = isLocalProvider || modelsForProvider.length === 0
  const isMoreProvider = moreProviders.some(p => p.id === provider)

  const primaryModel = activeConfig.models[0] || ""
  const canTest =
    primaryModel.trim().length > 0 &&
    (!requiresApiKey || activeConfig.apiKey.trim().length > 0) &&
    (!requiresBaseURL || activeConfig.baseURL.trim().length > 0)

  const updateConfig = useCallback(
    (prov: LlmProviderFlavor, updates: Partial<{ apiKey: string; baseURL: string; models: string[]; knowledgeGraphModel: string }>) => {
      setProviderConfigs(prev => ({
        ...prev,
        [prov]: { ...prev[prov], ...updates },
      }))
      setTestState({ status: "idle" })
    },
    []
  )

  const updateModelAt = useCallback(
    (prov: LlmProviderFlavor, index: number, value: string) => {
      setProviderConfigs(prev => {
        const models = [...prev[prov].models]
        models[index] = value
        return { ...prev, [prov]: { ...prev[prov], models } }
      })
      setTestState({ status: "idle" })
    },
    []
  )

  const addModel = useCallback(
    (prov: LlmProviderFlavor) => {
      setProviderConfigs(prev => ({
        ...prev,
        [prov]: { ...prev[prov], models: [...prev[prov].models, ""] },
      }))
    },
    []
  )

  const removeModel = useCallback(
    (prov: LlmProviderFlavor, index: number) => {
      setProviderConfigs(prev => {
        const models = prev[prov].models.filter((_, i) => i !== index)
        return { ...prev, [prov]: { ...prev[prov], models: models.length > 0 ? models : [""] } }
      })
      setTestState({ status: "idle" })
    },
    []
  )

  // Load current config from file
  useEffect(() => {
    if (!dialogOpen) return

    async function loadCurrentConfig() {
      try {
        setConfigLoading(true)
        const result = await window.ipc.invoke("workspace:readFile", {
          path: "config/models.json",
        })
        const parsed = JSON.parse(result.data)
        if (parsed?.provider?.flavor && parsed?.model) {
          const flavor = parsed.provider.flavor as LlmProviderFlavor
          setProvider(flavor)
          setDefaultProvider(flavor)
          setProviderConfigs(prev => {
            const next = { ...prev };
            // Hydrate all saved providers from the providers map
            if (parsed.providers) {
              for (const [key, entry] of Object.entries(parsed.providers)) {
                if (key in next) {
                  const e = entry as any;
                  const savedModels: string[] = Array.isArray(e.models) && e.models.length > 0
                    ? e.models
                    : e.model ? [e.model] : [""];
                  next[key as LlmProviderFlavor] = {
                    apiKey: e.apiKey || "",
                    baseURL: e.baseURL || (defaultBaseURLs[key as LlmProviderFlavor] || ""),
                    models: savedModels,
                    knowledgeGraphModel: e.knowledgeGraphModel || "",
                  };
                }
              }
            }
            // Active provider takes precedence from top-level config,
            // but only if it exists in the providers map (wasn't deleted)
            if (parsed.providers?.[flavor]) {
              const existingModels = next[flavor].models;
              const activeModels = existingModels[0] === parsed.model
                ? existingModels
                : [parsed.model, ...existingModels.filter((m: string) => m && m !== parsed.model)];
              next[flavor] = {
                apiKey: parsed.provider.apiKey || "",
                baseURL: parsed.provider.baseURL || (defaultBaseURLs[flavor] || ""),
                models: activeModels.length > 0 ? activeModels : [""],
                knowledgeGraphModel: parsed.knowledgeGraphModel || "",
              };
            }
            return next;
          })
        }
      } catch {
        // No existing config or parse error - use defaults
      } finally {
        setConfigLoading(false)
      }
    }

    loadCurrentConfig()
  }, [dialogOpen])

  // Load models catalog
  useEffect(() => {
    if (!dialogOpen) return

    async function loadModels() {
      try {
        setModelsLoading(true)
        setModelsError(null)
        const result = await window.ipc.invoke("models:list", null)
        const catalog: Record<string, LlmModelOption[]> = {}
        for (const p of result.providers || []) {
          catalog[p.id] = p.models || []
        }
        setModelsCatalog(catalog)
      } catch {
        setModelsError("Failed to load models list")
        setModelsCatalog({})
      } finally {
        setModelsLoading(false)
      }
    }

    loadModels()
  }, [dialogOpen])

  // Set default models from catalog when catalog loads
  useEffect(() => {
    if (Object.keys(modelsCatalog).length === 0) return
    setProviderConfigs(prev => {
      const next = { ...prev }
      const cloudProviders: LlmProviderFlavor[] = ["openai", "anthropic", "google"]
      for (const prov of cloudProviders) {
        const catalog = modelsCatalog[prov]
        if (catalog?.length && !next[prov].models[0]) {
          const preferred = preferredDefaults[prov]
          const hasPreferred = preferred && catalog.some(m => m.id === preferred)
          const defaultModel = hasPreferred ? preferred! : (catalog[0]?.id || "")
          next[prov] = { ...next[prov], models: [defaultModel] }
        }
      }
      return next
    })
  }, [modelsCatalog])

  const handleTestAndSave = useCallback(async () => {
    if (!canTest) return
    setTestState({ status: "testing" })
    try {
      const allModels = activeConfig.models.map(m => m.trim()).filter(Boolean)
      const providerConfig = {
        provider: {
          flavor: provider,
          apiKey: activeConfig.apiKey.trim() || undefined,
          baseURL: activeConfig.baseURL.trim() || undefined,
        },
        model: allModels[0] || "",
        models: allModels,
        knowledgeGraphModel: activeConfig.knowledgeGraphModel.trim() || undefined,
      }
      const result = await window.ipc.invoke("models:test", providerConfig)
      if (result.success) {
        await window.ipc.invoke("models:saveConfig", providerConfig)
        setDefaultProvider(provider)
        setTestState({ status: "success" })
        window.dispatchEvent(new Event('models-config-changed'))
        toast.success("Model configuration saved")
      } else {
        setTestState({ status: "error", error: result.error })
        toast.error(result.error || "Connection test failed")
      }
    } catch {
      setTestState({ status: "error", error: "Connection test failed" })
      toast.error("Connection test failed")
    }
  }, [canTest, provider, activeConfig])

  const handleSetDefault = useCallback(async (prov: LlmProviderFlavor) => {
    const config = providerConfigs[prov]
    const allModels = config.models.map(m => m.trim()).filter(Boolean)
    if (!allModels[0]) return
    try {
      await window.ipc.invoke("models:saveConfig", {
        provider: {
          flavor: prov,
          apiKey: config.apiKey.trim() || undefined,
          baseURL: config.baseURL.trim() || undefined,
        },
        model: allModels[0],
        models: allModels,
        knowledgeGraphModel: config.knowledgeGraphModel.trim() || undefined,
      })
      setDefaultProvider(prov)
      window.dispatchEvent(new Event('models-config-changed'))
      toast.success("Default provider updated")
    } catch {
      toast.error("Failed to set default provider")
    }
  }, [providerConfigs])

  const handleDeleteProvider = useCallback(async (prov: LlmProviderFlavor) => {
    try {
      const result = await window.ipc.invoke("workspace:readFile", { path: "config/models.json" })
      const parsed = JSON.parse(result.data)
      if (parsed?.providers?.[prov]) {
        delete parsed.providers[prov]
      }
      // If the deleted provider is the current top-level active one,
      // switch top-level config to the current default provider
      if (parsed?.provider?.flavor === prov && defaultProvider && defaultProvider !== prov) {
        const defConfig = providerConfigs[defaultProvider]
        const defModels = defConfig.models.map(m => m.trim()).filter(Boolean)
        parsed.provider = {
          flavor: defaultProvider,
          apiKey: defConfig.apiKey.trim() || undefined,
          baseURL: defConfig.baseURL.trim() || undefined,
        }
        parsed.model = defModels[0] || ""
        parsed.models = defModels
        parsed.knowledgeGraphModel = defConfig.knowledgeGraphModel.trim() || undefined
      }
      await window.ipc.invoke("workspace:writeFile", {
        path: "config/models.json",
        data: JSON.stringify(parsed, null, 2),
      })
      setProviderConfigs(prev => ({
        ...prev,
        [prov]: { apiKey: "", baseURL: defaultBaseURLs[prov] || "", models: [""], knowledgeGraphModel: "" },
      }))
      setTestState({ status: "idle" })
      window.dispatchEvent(new Event('models-config-changed'))
      toast.success("Provider configuration removed")
    } catch {
      toast.error("Failed to remove provider")
    }
  }, [defaultProvider, providerConfigs])

  const renderProviderCard = (p: { id: LlmProviderFlavor; name: string; description: string }) => {
    const isDefault = defaultProvider === p.id
    const isSelected = provider === p.id
    const hasModel = providerConfigs[p.id].models[0]?.trim().length > 0
    return (
      <button
        key={p.id}
        onClick={() => {
          setProvider(p.id)
          setTestState({ status: "idle" })
        }}
        className={cn(
          "rounded-md border px-3 py-2.5 text-left transition-colors relative",
          isSelected
            ? "border-primary bg-primary/5"
            : "border-border hover:bg-accent"
        )}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{p.name}</span>
          {isDefault && (
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-primary">
              Default
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">{p.description}</div>
        {!isDefault && hasModel && isSelected && (
          <div className="mt-1.5 flex items-center gap-3">
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation()
                handleSetDefault(p.id)
              }}
              className="inline-flex text-[11px] text-muted-foreground hover:text-primary transition-colors cursor-pointer"
            >
              Set as default
            </span>
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation()
                handleDeleteProvider(p.id)
              }}
              className="inline-flex text-[11px] text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
            >
              Remove
            </span>
          </div>
        )}
      </button>
    )
  }

  if (configLoading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="size-4 animate-spin mr-2" />
        Loading...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Provider selection */}
      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Provider</span>
        <div className="grid gap-2 grid-cols-2">
          {primaryProviders.map(renderProviderCard)}
        </div>
        {(showMoreProviders || isMoreProvider) ? (
          <div className="grid gap-2 grid-cols-2 mt-2">
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

      {/* Model selection - side by side */}
      <div className="grid grid-cols-2 gap-3">
        {/* Assistant models (left column) */}
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Assistant model</span>
          {modelsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading...
            </div>
          ) : (
            <div className="space-y-2">
              {activeConfig.models.map((model, index) => (
                <div key={index} className="group/model relative">
                  {showModelInput ? (
                    <Input
                      value={model}
                      onChange={(e) => updateModelAt(provider, index, e.target.value)}
                      placeholder="Enter model"
                    />
                  ) : (
                    <Select
                      value={model}
                      onValueChange={(value) => updateModelAt(provider, index, value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a model" />
                      </SelectTrigger>
                      <SelectContent>
                        {modelsForProvider.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name || m.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {activeConfig.models.length > 1 && (
                    <button
                      onClick={() => removeModel(provider, index)}
                      className="absolute right-8 top-1/2 -translate-y-1/2 flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/model:opacity-100"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={() => addModel(provider)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus className="size-3.5" />
                Add assistant model
              </button>
            </div>
          )}
          {modelsError && (
            <div className="text-xs text-destructive">{modelsError}</div>
          )}
        </div>

        {/* Knowledge graph model (right column) */}
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
              onChange={(e) => updateConfig(provider, { knowledgeGraphModel: e.target.value })}
              placeholder={primaryModel || "Enter model"}
            />
          ) : (
            <Select
              value={activeConfig.knowledgeGraphModel || "__same__"}
              onValueChange={(value) => updateConfig(provider, { knowledgeGraphModel: value === "__same__" ? "" : value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__same__">Same as assistant</SelectItem>
                {modelsForProvider.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name || m.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* API Key */}
      {showApiKey && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {provider === "openai-compatible" ? "API Key (optional)" : "API Key"}
          </span>
          <Input
            type="password"
            value={activeConfig.apiKey}
            onChange={(e) => updateConfig(provider, { apiKey: e.target.value })}
            placeholder="Paste your API key"
          />
        </div>
      )}

      {/* Base URL */}
      {showBaseURL && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Base URL</span>
          <Input
            value={activeConfig.baseURL}
            onChange={(e) => updateConfig(provider, { baseURL: e.target.value })}
            placeholder={
              provider === "ollama"
                ? "http://localhost:11434"
                : provider === "openai-compatible"
                  ? "http://localhost:1234/v1"
                  : "https://ai-gateway.vercel.sh/v1"
            }
          />
        </div>
      )}

      {/* Test status */}
      {testState.status === "error" && (
        <div className="text-sm text-destructive">
          {testState.error || "Connection test failed"}
        </div>
      )}
      {testState.status === "success" && (
        <div className="flex items-center gap-1.5 text-sm text-green-600">
          <CheckCircle2 className="size-4" />
          Connected and saved
        </div>
      )}

      {/* Test & Save button */}
      <Button
        onClick={handleTestAndSave}
        disabled={!canTest || testState.status === "testing"}
        className="w-full"
      >
        {testState.status === "testing" ? (
          <><Loader2 className="size-4 animate-spin mr-2" />Testing connection...</>
        ) : (
          "Test & Save"
        )}
      </Button>
    </div>
  )
}

// --- Tools Library Settings ---

interface ToolkitInfo {
  slug: string
  name: string
  meta: { description: string; logo: string; tools_count: number; triggers_count: number }
  no_auth: boolean
  auth_schemes: string[]
  composio_managed_auth_schemes: string[]
}

interface ToolInfo {
  slug: string
  name: string
  description: string
  toolkitSlug: string
  inputParameters?: { type?: string; properties?: Record<string, unknown>; required?: string[] }
}

function ToolsLibrarySettings({ dialogOpen }: { dialogOpen: boolean }) {
  // API key state
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState("")
  const [apiKeySaving, setApiKeySaving] = useState(false)
  const [showApiKeyInput, setShowApiKeyInput] = useState(false)

  // Toolkit browsing state
  const [toolkits, setToolkits] = useState<ToolkitInfo[]>([])
  const [toolkitsLoading, setToolkitsLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")

  // Connection state
  const [connectedToolkits, setConnectedToolkits] = useState<Set<string>>(new Set())
  const [connectingToolkit, setConnectingToolkit] = useState<string | null>(null)

  // Tool selection state
  const [expandedToolkit, setExpandedToolkit] = useState<string | null>(null)
  const [toolkitTools, setToolkitTools] = useState<Record<string, ToolInfo[]>>({})
  const [toolsLoading, setToolsLoading] = useState<string | null>(null)
  const [enabledToolSlugs, setEnabledToolSlugs] = useState<Set<string>>(new Set())

  // Check API key configuration
  const checkApiKey = useCallback(async () => {
    try {
      const result = await window.ipc.invoke("composio:is-configured", null)
      setApiKeyConfigured(result.configured)
      if (!result.configured) {
        setShowApiKeyInput(true)
      }
    } catch {
      setApiKeyConfigured(false)
    }
  }, [])

  // Load connected toolkits
  const loadConnected = useCallback(async () => {
    try {
      const result = await window.ipc.invoke("composio:list-connected", null)
      setConnectedToolkits(new Set(result.toolkits))
    } catch {
      // ignore
    }
  }, [])

  // Load enabled tools
  const loadEnabledTools = useCallback(async () => {
    try {
      const result = await window.ipc.invoke("composio:get-enabled-tools", null)
      setEnabledToolSlugs(new Set(Object.keys(result.tools)))
    } catch {
      // ignore
    }
  }, [])

  // Load toolkits
  const loadToolkits = useCallback(async () => {
    setToolkitsLoading(true)
    try {
      const result = await window.ipc.invoke("composio:list-toolkits", {})
      setToolkits(result.items)
    } catch {
      toast.error("Failed to load toolkits")
    } finally {
      setToolkitsLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    if (!dialogOpen) return
    checkApiKey()
    loadConnected()
    loadEnabledTools()
  }, [dialogOpen, checkApiKey, loadConnected, loadEnabledTools])

  // Load toolkits when API key is configured
  useEffect(() => {
    if (dialogOpen && apiKeyConfigured) {
      loadToolkits()
    }
  }, [dialogOpen, apiKeyConfigured, loadToolkits])

  // Listen for composio connection events
  useEffect(() => {
    const cleanup = window.ipc.on('composio:didConnect', (event) => {
      const { toolkitSlug, success, error } = event
      setConnectingToolkit(null)
      if (success) {
        setConnectedToolkits(prev => new Set([...prev, toolkitSlug]))
        toast.success(`Connected to ${toolkitSlug}`)
      } else {
        toast.error(error || `Failed to connect to ${toolkitSlug}`)
      }
    })
    return cleanup
  }, [])

  // Save API key
  const handleSaveApiKey = async () => {
    const trimmed = apiKeyInput.trim()
    if (!trimmed) return
    setApiKeySaving(true)
    try {
      const result = await window.ipc.invoke("composio:set-api-key", { apiKey: trimmed })
      if (result.success) {
        setApiKeyConfigured(true)
        setShowApiKeyInput(false)
        setApiKeyInput("")
        toast.success("Composio API key saved")
      } else {
        toast.error(result.error || "Failed to save API key")
      }
    } catch {
      toast.error("Failed to save API key")
    } finally {
      setApiKeySaving(false)
    }
  }

  // Connect a toolkit
  const handleConnect = async (toolkitSlug: string) => {
    setConnectingToolkit(toolkitSlug)
    try {
      const result = await window.ipc.invoke("composio:initiate-connection", { toolkitSlug })
      if (!result.success) {
        toast.error(result.error || "Failed to connect")
        setConnectingToolkit(null)
      }
      // Success will be handled by composio:didConnect event
    } catch {
      toast.error("Failed to connect")
      setConnectingToolkit(null)
    }
  }

  // Disconnect a toolkit
  const handleDisconnect = async (toolkitSlug: string) => {
    try {
      await window.ipc.invoke("composio:disconnect", { toolkitSlug })
      setConnectedToolkits(prev => {
        const next = new Set(prev)
        next.delete(toolkitSlug)
        return next
      })
      // Remove enabled tools for this toolkit from local state
      setEnabledToolSlugs(prev => {
        const toolsForToolkit = toolkitTools[toolkitSlug] || []
        const next = new Set(prev)
        for (const t of toolsForToolkit) {
          next.delete(t.slug)
        }
        return next
      })
      if (expandedToolkit === toolkitSlug) {
        setExpandedToolkit(null)
      }
      toast.success(`Disconnected from ${toolkitSlug}`)
    } catch {
      toast.error("Failed to disconnect")
    }
  }

  // Load tools for a toolkit
  const loadToolsForToolkit = async (toolkitSlug: string) => {
    if (toolkitTools[toolkitSlug]) return // Already loaded
    setToolsLoading(toolkitSlug)
    try {
      const result = await window.ipc.invoke("composio:list-toolkit-tools", { toolkitSlug })
      setToolkitTools(prev => ({ ...prev, [toolkitSlug]: result.items }))
    } catch {
      toast.error("Failed to load tools")
    } finally {
      setToolsLoading(null)
    }
  }

  // Toggle toolkit expansion
  const handleToggleToolkit = (toolkitSlug: string) => {
    if (expandedToolkit === toolkitSlug) {
      setExpandedToolkit(null)
    } else {
      setExpandedToolkit(toolkitSlug)
      if (connectedToolkits.has(toolkitSlug)) {
        loadToolsForToolkit(toolkitSlug)
      }
    }
  }

  // Enable/disable a tool
  const handleToggleTool = async (tool: ToolInfo, enable: boolean) => {
    try {
      if (enable) {
        await window.ipc.invoke("composio:enable-tools", { tools: [tool] })
        setEnabledToolSlugs(prev => new Set([...prev, tool.slug]))
      } else {
        await window.ipc.invoke("composio:disable-tools", { toolSlugs: [tool.slug] })
        setEnabledToolSlugs(prev => {
          const next = new Set(prev)
          next.delete(tool.slug)
          return next
        })
      }
    } catch {
      toast.error("Failed to update tool")
    }
  }

  // Enable/disable all tools for a toolkit
  const handleToggleAllTools = async (toolkitSlug: string, enable: boolean) => {
    const tools = toolkitTools[toolkitSlug] || []
    if (tools.length === 0) return

    try {
      if (enable) {
        await window.ipc.invoke("composio:enable-tools", { tools })
        setEnabledToolSlugs(prev => {
          const next = new Set(prev)
          for (const t of tools) next.add(t.slug)
          return next
        })
      } else {
        await window.ipc.invoke("composio:disable-tools", { toolSlugs: tools.map(t => t.slug) })
        setEnabledToolSlugs(prev => {
          const next = new Set(prev)
          for (const t of tools) next.delete(t.slug)
          return next
        })
      }
    } catch {
      toast.error("Failed to update tools")
    }
  }

  // Filter toolkits by search
  const filteredToolkits = searchQuery.trim()
    ? toolkits.filter(t =>
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.meta.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : toolkits

  return (
    <div className="space-y-4">
      {/* Section A: API Key */}
      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Composio API Key</span>
        {apiKeyConfigured && !showApiKeyInput ? (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-sm text-green-600">
              <CheckCircle2 className="size-4" />
              API key configured
            </div>
            <button
              onClick={() => setShowApiKeyInput(true)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Change
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Enter your Composio API key to browse and enable tool integrations.
              Get your key from{" "}
              <a
                href="https://app.composio.dev/settings"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                app.composio.dev/settings
              </a>
            </p>
            <div className="flex gap-2">
              <Input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="Paste your Composio API key"
                onKeyDown={(e) => e.key === "Enter" && handleSaveApiKey()}
                className="flex-1"
              />
              <Button
                onClick={handleSaveApiKey}
                disabled={!apiKeyInput.trim() || apiKeySaving}
                size="sm"
              >
                {apiKeySaving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
              </Button>
              {apiKeyConfigured && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setShowApiKeyInput(false); setApiKeyInput("") }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Section B: Toolkit Browser (only when API key configured) */}
      {apiKeyConfigured && (
        <>
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Available Toolkits</span>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search toolkits..."
                className="pl-8"
              />
            </div>
          </div>

          {toolkitsLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <Loader2 className="size-4 animate-spin mr-2" />
              Loading toolkits...
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[340px] overflow-y-auto pr-1">
              {filteredToolkits.map((toolkit) => {
                const isConnected = connectedToolkits.has(toolkit.slug)
                const isConnecting = connectingToolkit === toolkit.slug
                const isExpanded = expandedToolkit === toolkit.slug
                const tools = toolkitTools[toolkit.slug] || []
                const isLoadingTools = toolsLoading === toolkit.slug
                const enabledCount = tools.filter(t => enabledToolSlugs.has(t.slug)).length
                const allEnabled = tools.length > 0 && enabledCount === tools.length

                return (
                  <div key={toolkit.slug} className="border rounded-md overflow-hidden">
                    {/* Toolkit card header */}
                    <button
                      onClick={() => handleToggleToolkit(toolkit.slug)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/50",
                        isExpanded && "bg-accent/30"
                      )}
                    >
                      {/* Logo */}
                      {toolkit.meta.logo ? (
                        <img
                          src={toolkit.meta.logo}
                          alt=""
                          className="size-7 rounded object-contain flex-shrink-0"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                      ) : (
                        <div className="size-7 rounded bg-muted flex items-center justify-center flex-shrink-0">
                          <Wrench className="size-3.5 text-muted-foreground" />
                        </div>
                      )}

                      {/* Name & description */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate">{toolkit.name}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {toolkit.meta.tools_count} tools
                          </span>
                          {isConnected && (
                            <span className="rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-green-600">
                              Connected
                            </span>
                          )}
                          {enabledCount > 0 && (
                            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-primary">
                              {enabledCount} enabled
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {toolkit.meta.description}
                        </p>
                      </div>

                      {/* Expand icon */}
                      {isExpanded ? (
                        <ChevronDown className="size-4 text-muted-foreground flex-shrink-0" />
                      ) : (
                        <ChevronRight className="size-4 text-muted-foreground flex-shrink-0" />
                      )}
                    </button>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="border-t px-3 py-2.5 space-y-2 bg-muted/20">
                        {/* Connection controls */}
                        <div className="flex items-center gap-2">
                          {isConnected ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => { e.stopPropagation(); handleDisconnect(toolkit.slug) }}
                              className="text-xs h-7"
                            >
                              <Unlink className="size-3 mr-1" />
                              Disconnect
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              onClick={(e) => { e.stopPropagation(); handleConnect(toolkit.slug) }}
                              disabled={isConnecting}
                              className="text-xs h-7"
                            >
                              {isConnecting ? (
                                <><Loader2 className="size-3 animate-spin mr-1" />Connecting...</>
                              ) : (
                                <><Link2 className="size-3 mr-1" />Connect</>
                              )}
                            </Button>
                          )}

                          {/* Enable/Disable all (only if connected and tools loaded) */}
                          {isConnected && tools.length > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleToggleAllTools(toolkit.slug, !allEnabled)
                              }}
                              className="text-xs h-7 ml-auto"
                            >
                              {allEnabled ? "Disable All" : "Enable All"}
                            </Button>
                          )}
                        </div>

                        {/* Tools list (only if connected) */}
                        {isConnected && (
                          <div className="space-y-0.5">
                            {isLoadingTools ? (
                              <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                                <Loader2 className="size-3 animate-spin" />
                                Loading tools...
                              </div>
                            ) : tools.length === 0 ? (
                              <p className="text-xs text-muted-foreground py-1">No tools found</p>
                            ) : (
                              <div className="max-h-[200px] overflow-y-auto space-y-0.5">
                                {tools.map((tool) => {
                                  const isEnabled = enabledToolSlugs.has(tool.slug)
                                  return (
                                    <label
                                      key={tool.slug}
                                      className={cn(
                                        "flex items-start gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors",
                                        isEnabled ? "bg-primary/5" : "hover:bg-accent/50"
                                      )}
                                    >
                                      <div className="pt-0.5">
                                        <div
                                          onClick={(e) => {
                                            e.preventDefault()
                                            handleToggleTool(tool, !isEnabled)
                                          }}
                                          className={cn(
                                            "size-4 rounded border flex items-center justify-center transition-colors cursor-pointer",
                                            isEnabled
                                              ? "bg-primary border-primary"
                                              : "border-border"
                                          )}
                                        >
                                          {isEnabled && <Check className="size-3 text-primary-foreground" />}
                                        </div>
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium">{tool.name}</div>
                                        <div className="text-[11px] text-muted-foreground line-clamp-1">
                                          {tool.description}
                                        </div>
                                      </div>
                                    </label>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Not connected hint */}
                        {!isConnected && (
                          <p className="text-xs text-muted-foreground">
                            Connect this toolkit to browse and enable its tools.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              {filteredToolkits.length === 0 && !toolkitsLoading && (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  {searchQuery ? "No toolkits match your search" : "No toolkits available"}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// --- Main Settings Dialog ---

export function SettingsDialog({ children }: SettingsDialogProps) {
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<ConfigTab>("models")
  const [content, setContent] = useState("")
  const [originalContent, setOriginalContent] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeTabConfig = tabs.find((t) => t.id === activeTab)!
  const isJsonTab = activeTab === "mcp" || activeTab === "security"

  const formatJson = (jsonString: string): string => {
    try {
      return JSON.stringify(JSON.parse(jsonString), null, 2)
    } catch {
      return jsonString
    }
  }

  const loadConfig = useCallback(async (tab: ConfigTab) => {
    if (tab === "appearance" || tab === "models") return
    const tabConfig = tabs.find((t) => t.id === tab)!
    if (!tabConfig.path) return
    setLoading(true)
    setError(null)
    try {
      const result = await window.ipc.invoke("workspace:readFile", {
        path: tabConfig.path,
      })
      const formattedContent = formatJson(result.data)
      setContent(formattedContent)
      setOriginalContent(formattedContent)
    } catch {
      setError(`Failed to load ${tabConfig.label} config`)
      setContent("")
      setOriginalContent("")
    } finally {
      setLoading(false)
    }
  }, [])

  const saveConfig = async () => {
    if (!isJsonTab || !activeTabConfig.path) return
    setSaving(true)
    setError(null)
    try {
      JSON.parse(content)
      await window.ipc.invoke("workspace:writeFile", {
        path: activeTabConfig.path,
        data: content,
      })
      setOriginalContent(content)
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError("Invalid JSON syntax")
      } else {
        setError(`Failed to save ${activeTabConfig.label} config`)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleFormat = () => {
    setContent(formatJson(content))
  }

  const hasChanges = content !== originalContent

  useEffect(() => {
    if (open && isJsonTab) {
      loadConfig(activeTab)
    }
  }, [open, activeTab, isJsonTab, loadConfig])

  const handleTabChange = (tab: ConfigTab) => {
    if (isJsonTab && hasChanges) {
      if (!confirm("You have unsaved changes. Discard them?")) {
        return
      }
    }
    setActiveTab(tab)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="max-w-[900px]! w-[900px] h-[600px] p-0 gap-0 overflow-hidden"
      >
        <div className="flex h-full overflow-hidden">
          {/* Sidebar */}
          <div className="w-48 border-r bg-muted/30 p-2 flex flex-col">
            <div className="px-2 py-3 mb-2">
              <h2 className="font-semibold text-sm">Settings</h2>
            </div>
            <nav className="flex flex-col gap-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={cn(
                    "flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors text-left",
                    activeTab === tab.id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                  )}
                >
                  <tab.icon className="size-4" />
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Main content */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {/* Header */}
            <div className="px-4 py-3 border-b">
              <h3 className="font-medium text-sm">{activeTabConfig.label}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {activeTabConfig.description}
              </p>
            </div>

            {/* Content */}
            <div className={cn("flex-1 p-4 min-h-0", (activeTab === "models" || activeTab === "tools") ? "overflow-y-auto" : "overflow-hidden")}>
              {activeTab === "models" ? (
                <ModelSettings dialogOpen={open} />
              ) : activeTab === "appearance" ? (
                <AppearanceSettings />
              ) : activeTab === "tools" ? (
                <ToolsLibrarySettings dialogOpen={open} />
              ) : loading ? (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  Loading...
                </div>
              ) : (
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="w-full h-full resize-none bg-muted/50 rounded-md p-3 font-mono text-sm border-0 focus:outline-none focus:ring-1 focus:ring-ring"
                  spellCheck={false}
                  placeholder="Loading configuration..."
                />
              )}
            </div>

            {/* Footer - only show for JSON config tabs */}
            {isJsonTab && (
              <div className="px-4 py-3 border-t flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {error && (
                    <span className="text-xs text-destructive">{error}</span>
                  )}
                  {hasChanges && !error && (
                    <span className="text-xs text-muted-foreground">
                      Unsaved changes
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleFormat}
                    disabled={loading || saving}
                  >
                    Format
                  </Button>
                  <Button
                    size="sm"
                    onClick={saveConfig}
                    disabled={loading || saving || !hasChanges}
                  >
                    {saving ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
