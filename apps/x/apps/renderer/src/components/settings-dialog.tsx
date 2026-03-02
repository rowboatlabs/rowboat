"use client"

import * as React from "react"
import { useState, useEffect, useCallback, useMemo } from "react"
import { Server, Key, Shield, Palette, Monitor, Sun, Moon, Loader2, CheckCircle2, Tags, ChevronRight, Plus, X } from "lucide-react"

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

type ConfigTab = "models" | "mcp" | "security" | "appearance" | "note-tagging"

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
    id: "note-tagging",
    label: "Note Tagging",
    icon: Tags,
    path: "config/tags.json",
    description: "Configure tags for notes and emails",
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

// --- Note Tagging Settings ---

interface TagDef {
  tag: string
  type: string
  applicability: "email" | "notes" | "both"
  description: string
  example?: string
}

const TAG_TYPE_ORDER = [
  "relationship", "relationship-sub", "topic", "email-type",
  "filter", "action", "status", "source",
]

const TAG_TYPE_LABELS: Record<string, string> = {
  "relationship": "Relationship",
  "relationship-sub": "Relationship Sub-Tags",
  "topic": "Topic",
  "email-type": "Email Type",
  "filter": "Filter",
  "action": "Action",
  "status": "Status",
  "source": "Source",
}

const DEFAULT_TAGS: TagDef[] = [
  { tag: "investor", type: "relationship", applicability: "both", description: "Investors, VCs, or angels", example: "Following up on our meeting — we'd like to move forward with the Series A term sheet." },
  { tag: "customer", type: "relationship", applicability: "both", description: "Paying customers", example: "We're seeing great results with Rowboat. Can we discuss expanding to more teams?" },
  { tag: "prospect", type: "relationship", applicability: "both", description: "Potential customers", example: "Thanks for the demo yesterday. We're interested in starting a pilot." },
  { tag: "partner", type: "relationship", applicability: "both", description: "Business partners", example: "Let's discuss how we can promote the integration to both our user bases." },
  { tag: "vendor", type: "relationship", applicability: "both", description: "Service providers you work with", example: "Here are the updated employment agreements you requested." },
  { tag: "product", type: "relationship", applicability: "both", description: "Products or services you use (automated)", example: "Your AWS bill for January 2025 is now available." },
  { tag: "candidate", type: "relationship", applicability: "both", description: "Job applicants", example: "Thanks for reaching out. I'd love to learn more about the engineering role." },
  { tag: "team", type: "relationship", applicability: "both", description: "Internal team members", example: "Here's the updated roadmap for Q2. Let's discuss in our sync." },
  { tag: "advisor", type: "relationship", applicability: "both", description: "Advisors, mentors, or board members", example: "I've reviewed the deck. Here are my thoughts on the GTM strategy." },
  { tag: "personal", type: "relationship", applicability: "both", description: "Family or friends", example: "Are you coming to Thanksgiving this year? Let me know your travel dates." },
  { tag: "press", type: "relationship", applicability: "both", description: "Journalists or media", example: "I'm writing a piece on AI agents. Would you be available for an interview?" },
  { tag: "community", type: "relationship", applicability: "both", description: "Users, peers, or open source contributors", example: "Love what you're building with Rowboat. Here's a bug I found..." },
  { tag: "government", type: "relationship", applicability: "both", description: "Government agencies", example: "Your Delaware franchise tax is due by March 1, 2025." },
  { tag: "primary", type: "relationship-sub", applicability: "notes", description: "Main contact or decision maker", example: "Sarah Chen — VP Engineering, your main point of contact at Acme." },
  { tag: "secondary", type: "relationship-sub", applicability: "notes", description: "Supporting contact, involved but not the lead", example: "David Kim — Engineer CC'd on customer emails." },
  { tag: "executive-assistant", type: "relationship-sub", applicability: "notes", description: "EA or admin handling scheduling and logistics", example: "Lisa — Sarah's EA who schedules all her meetings." },
  { tag: "cc", type: "relationship-sub", applicability: "notes", description: "Person who's CC'd but not actively engaged", example: "Manager looped in for visibility on deal." },
  { tag: "referred-by", type: "relationship-sub", applicability: "notes", description: "Person who made an introduction or referral", example: "David Park — Investor who intro'd you to Sarah." },
  { tag: "former", type: "relationship-sub", applicability: "notes", description: "Previously held this relationship, no longer active", example: "John — Former customer who churned last year." },
  { tag: "champion", type: "relationship-sub", applicability: "notes", description: "Internal advocate pushing for you", example: "Engineer who loves your product and is selling internally." },
  { tag: "blocker", type: "relationship-sub", applicability: "notes", description: "Person opposing or blocking progress", example: "CFO resistant to spending on new tools." },
  { tag: "sales", type: "topic", applicability: "both", description: "Sales conversations, deals, and revenue", example: "Here's the pricing proposal we discussed. Let me know if you have questions." },
  { tag: "support", type: "topic", applicability: "both", description: "Help requests, issues, and customer support", example: "We're seeing an error when trying to export. Can you help?" },
  { tag: "legal", type: "topic", applicability: "both", description: "Contracts, terms, compliance, and legal matters", example: "Legal has reviewed the MSA. Attached are our requested changes." },
  { tag: "finance", type: "topic", applicability: "both", description: "Money, invoices, payments, banking, and taxes", example: "Your invoice #1234 for $5,000 is attached. Payment due in 30 days." },
  { tag: "hiring", type: "topic", applicability: "both", description: "Recruiting, interviews, and employment", example: "We'd like to move forward with a final round interview. Are you available Thursday?" },
  { tag: "fundraising", type: "topic", applicability: "both", description: "Raising money and investor relations", example: "Thanks for sending the deck. We'd like to schedule a partner meeting." },
  { tag: "travel", type: "topic", applicability: "both", description: "Flights, hotels, trips, and travel logistics", example: "Your flight to Tokyo on March 15 is confirmed. Confirmation #ABC123." },
  { tag: "event", type: "topic", applicability: "both", description: "Conferences, meetups, and gatherings", example: "You're invited to speak at TechCrunch Disrupt. Can you confirm your availability?" },
  { tag: "shopping", type: "topic", applicability: "both", description: "Purchases, orders, and returns", example: "Your order #12345 has shipped. Track it here." },
  { tag: "health", type: "topic", applicability: "both", description: "Medical, wellness, and health-related matters", example: "Your appointment with Dr. Smith is confirmed for Monday at 2pm." },
  { tag: "learning", type: "topic", applicability: "both", description: "Courses, education, and skill-building", example: "Welcome to the Advanced Python course. Here's your access link." },
  { tag: "research", type: "topic", applicability: "both", description: "Research requests and information gathering", example: "Here's the market analysis you requested on the AI agent space." },
  { tag: "intro", type: "email-type", applicability: "both", description: "Warm introduction from someone you know", example: "I'd like to introduce you to Sarah Chen, VP Engineering at Acme." },
  { tag: "followup", type: "email-type", applicability: "both", description: "Following up on a previous conversation", example: "Following up on our call last week. Have you had a chance to review the proposal?" },
  { tag: "scheduling", type: "email-type", applicability: "email", description: "Meeting and calendar scheduling", example: "Are you available for a call next Tuesday at 2pm?" },
  { tag: "cold-outreach", type: "email-type", applicability: "email", description: "Unsolicited contact from someone you don't know", example: "Hi, I noticed your company is growing fast. I'd love to show you how we can help with..." },
  { tag: "newsletter", type: "email-type", applicability: "email", description: "Newsletters, marketing emails, and subscriptions", example: "This week in AI: The latest developments in agent frameworks..." },
  { tag: "notification", type: "email-type", applicability: "email", description: "Automated alerts, receipts, and system notifications", example: "Your password was changed successfully. If this wasn't you, contact support." },
  { tag: "spam", type: "filter", applicability: "email", description: "Junk and unwanted email", example: "Congratulations! You've won $1,000,000..." },
  { tag: "promotion", type: "filter", applicability: "email", description: "Marketing offers and sales pitches", example: "50% off all items this weekend only!" },
  { tag: "social", type: "filter", applicability: "email", description: "Social media notifications", example: "John Smith commented on your post." },
  { tag: "forums", type: "filter", applicability: "email", description: "Mailing lists and group discussions", example: "Re: [dev-list] Question about API design" },
  { tag: "action-required", type: "action", applicability: "both", description: "Needs a response or action from you", example: "Can you send me the pricing by Friday?" },
  { tag: "fyi", type: "action", applicability: "email", description: "Informational only, no action needed", example: "Just wanted to let you know the deal closed. Thanks for your help!" },
  { tag: "urgent", type: "action", applicability: "both", description: "Time-sensitive, needs immediate attention", example: "We need your signature on the contract by EOD today or we lose the deal." },
  { tag: "waiting", type: "action", applicability: "both", description: "Waiting on a response from them" },
  { tag: "unread", type: "status", applicability: "email", description: "Not yet processed" },
  { tag: "to-reply", type: "status", applicability: "email", description: "Need to respond" },
  { tag: "done", type: "status", applicability: "email", description: "Handled, can be archived" },
  { tag: "active", type: "status", applicability: "notes", description: "Currently relevant, recent activity" },
  { tag: "archived", type: "status", applicability: "notes", description: "No longer active, kept for reference" },
  { tag: "stale", type: "status", applicability: "notes", description: "No activity in 60+ days, needs attention or archive" },
  { tag: "email", type: "source", applicability: "notes", description: "Created or updated from email" },
  { tag: "meeting", type: "source", applicability: "notes", description: "Created or updated from meeting transcript" },
  { tag: "browser", type: "source", applicability: "notes", description: "Content captured from web browsing" },
  { tag: "web-search", type: "source", applicability: "notes", description: "Information from web search" },
  { tag: "manual", type: "source", applicability: "notes", description: "Manually entered by user" },
  { tag: "import", type: "source", applicability: "notes", description: "Imported from another system" },
]

function NoteTaggingSettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [tags, setTags] = useState<TagDef[]>([])
  const [originalTags, setOriginalTags] = useState<TagDef[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const hasChanges = JSON.stringify(tags) !== JSON.stringify(originalTags)

  useEffect(() => {
    if (!dialogOpen) return
    async function load() {
      setLoading(true)
      try {
        const result = await window.ipc.invoke("workspace:readFile", { path: "config/tags.json" })
        const parsed = JSON.parse(result.data)
        setTags(parsed)
        setOriginalTags(parsed)
      } catch {
        setTags([...DEFAULT_TAGS])
        setOriginalTags([...DEFAULT_TAGS])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [dialogOpen])

  const groups = useMemo(() => {
    const map = new Map<string, TagDef[]>()
    for (const tag of tags) {
      const list = map.get(tag.type) ?? []
      list.push(tag)
      map.set(tag.type, list)
    }
    return TAG_TYPE_ORDER.map(type => ({
      type,
      label: TAG_TYPE_LABELS[type],
      tags: map.get(type) ?? [],
    }))
  }, [tags])

  const getGlobalIndex = useCallback((type: string, localIndex: number) => {
    let count = 0
    for (let i = 0; i < tags.length; i++) {
      if (tags[i].type === type) {
        if (count === localIndex) return i
        count++
      }
    }
    return -1
  }, [tags])

  const updateTag = useCallback((index: number, field: keyof TagDef, value: string) => {
    setTags(prev => prev.map((t, i) => i === index ? { ...t, [field]: value } : t))
  }, [])

  const removeTag = useCallback((index: number) => {
    setTags(prev => prev.filter((_, i) => i !== index))
  }, [])

  const addTag = useCallback((type: string) => {
    const newTag: TagDef = { tag: "", type, applicability: "both", description: "" }
    const lastIndex = tags.reduce((acc, t, i) => t.type === type ? i : acc, -1)
    if (lastIndex === -1) {
      setTags(prev => [...prev, newTag])
    } else {
      setTags(prev => [...prev.slice(0, lastIndex + 1), newTag, ...prev.slice(lastIndex + 1)])
    }
  }, [tags])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await window.ipc.invoke("workspace:writeFile", {
        path: "config/tags.json",
        data: JSON.stringify(tags, null, 2),
      })
      setOriginalTags([...tags])
      toast.success("Tag configuration saved")
    } catch {
      toast.error("Failed to save tag configuration")
    } finally {
      setSaving(false)
    }
  }, [tags])

  const handleReset = useCallback(() => {
    if (!confirm("Reset all tags to defaults? This will discard your changes.")) return
    setTags([...DEFAULT_TAGS])
  }, [])

  const toggleGroup = useCallback((type: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="size-4 animate-spin mr-2" />
        Loading...
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
        {groups.map(group => (
          <div key={group.type}>
            <div className="flex items-center justify-between mb-1.5">
              <button
                onClick={() => toggleGroup(group.type)}
                className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronRight className={cn("size-3.5 transition-transform", !collapsedGroups.has(group.type) && "rotate-90")} />
                {group.label}
                <span className="text-[10px] ml-0.5">({group.tags.length})</span>
              </button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => addTag(group.type)}
              >
                <Plus className="size-3 mr-1" />
                Add
              </Button>
            </div>
            {!collapsedGroups.has(group.type) && group.tags.length > 0 && (
              <div className="border rounded-md overflow-hidden">
                <div className="grid grid-cols-[100px_1fr_1fr_80px_24px] gap-1 bg-muted/50 px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  <div>Tag</div>
                  <div>Description</div>
                  <div>Example</div>
                  <div>Applies to</div>
                  <div />
                </div>
                {group.tags.map((tag, localIdx) => {
                  const globalIdx = getGlobalIndex(group.type, localIdx)
                  return (
                    <div key={globalIdx} className="grid grid-cols-[100px_1fr_1fr_80px_24px] gap-1 border-t px-2 py-0.5 items-center">
                      <Input
                        value={tag.tag}
                        onChange={e => updateTag(globalIdx, "tag", e.target.value)}
                        className="h-7 text-xs"
                        placeholder="tag-name"
                        title={tag.tag}
                      />
                      <Input
                        value={tag.description}
                        onChange={e => updateTag(globalIdx, "description", e.target.value)}
                        className="h-7 text-xs"
                        placeholder="Description"
                        title={tag.description}
                      />
                      <Input
                        value={tag.example || ""}
                        onChange={e => updateTag(globalIdx, "example", e.target.value)}
                        className="h-7 text-xs"
                        placeholder="Example"
                        title={tag.example || ""}
                      />
                      <Select
                        value={tag.applicability}
                        onValueChange={v => updateTag(globalIdx, "applicability", v)}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="both">Both</SelectItem>
                          <SelectItem value="email">Email</SelectItem>
                          <SelectItem value="notes">Notes</SelectItem>
                        </SelectContent>
                      </Select>
                      <button
                        onClick={() => removeTag(globalIdx)}
                        className="flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            {!collapsedGroups.has(group.type) && group.tags.length === 0 && (
              <div className="text-xs text-muted-foreground italic px-2">No tags in this group</div>
            )}
          </div>
        ))}
      </div>
      <div className="pt-3 border-t mt-3 flex items-center justify-between">
        <div>
          {hasChanges && (
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleReset}>
            Reset to defaults
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !hasChanges}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
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
    if (tab === "appearance" || tab === "models" || tab === "note-tagging") return
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
            <div className={cn("flex-1 p-4 min-h-0", activeTab === "models" ? "overflow-y-auto" : activeTab === "note-tagging" ? "overflow-hidden flex flex-col" : "overflow-hidden")}>
              {activeTab === "models" ? (
                <ModelSettings dialogOpen={open} />
              ) : activeTab === "note-tagging" ? (
                <NoteTaggingSettings dialogOpen={open} />
              ) : activeTab === "appearance" ? (
                <AppearanceSettings />
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
