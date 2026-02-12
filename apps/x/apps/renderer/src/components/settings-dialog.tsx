"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { Server, Key, Shield, Palette, Monitor, Sun, Moon, Loader2, CheckCircle2 } from "lucide-react"

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

type ConfigTab = "models" | "mcp" | "security" | "appearance"

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
  const [providerConfigs, setProviderConfigs] = useState<Record<LlmProviderFlavor, { apiKey: string; baseURL: string; model: string }>>({
    openai: { apiKey: "", baseURL: "", model: "" },
    anthropic: { apiKey: "", baseURL: "", model: "" },
    google: { apiKey: "", baseURL: "", model: "" },
    openrouter: { apiKey: "", baseURL: "", model: "" },
    aigateway: { apiKey: "", baseURL: "", model: "" },
    ollama: { apiKey: "", baseURL: "http://localhost:11434", model: "" },
    "openai-compatible": { apiKey: "", baseURL: "http://localhost:1234/v1", model: "" },
  })
  const [modelsCatalog, setModelsCatalog] = useState<Record<string, LlmModelOption[]>>({})
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [testState, setTestState] = useState<{ status: "idle" | "testing" | "success" | "error"; error?: string }>({ status: "idle" })
  const [configLoading, setConfigLoading] = useState(true)
  const [showMoreProviders, setShowMoreProviders] = useState(false)

  const activeConfig = providerConfigs[provider]
  const requiresApiKey = provider === "openai" || provider === "anthropic" || provider === "google" || provider === "openrouter" || provider === "aigateway"
  const showBaseURL = provider === "ollama" || provider === "openai-compatible" || provider === "aigateway"
  const requiresBaseURL = provider === "ollama" || provider === "openai-compatible"
  const isLocalProvider = provider === "ollama" || provider === "openai-compatible"
  const modelsForProvider = modelsCatalog[provider] || []
  const showModelInput = isLocalProvider || modelsForProvider.length === 0
  const isMoreProvider = moreProviders.some(p => p.id === provider)

  const canTest =
    activeConfig.model.trim().length > 0 &&
    (!requiresApiKey || activeConfig.apiKey.trim().length > 0) &&
    (!requiresBaseURL || activeConfig.baseURL.trim().length > 0)

  const updateConfig = useCallback(
    (prov: LlmProviderFlavor, updates: Partial<{ apiKey: string; baseURL: string; model: string }>) => {
      setProviderConfigs(prev => ({
        ...prev,
        [prov]: { ...prev[prov], ...updates },
      }))
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
          setProviderConfigs(prev => ({
            ...prev,
            [flavor]: {
              apiKey: parsed.provider.apiKey || "",
              baseURL: parsed.provider.baseURL || (defaultBaseURLs[flavor] || ""),
              model: parsed.model,
            },
          }))
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
        const models = modelsCatalog[prov]
        if (models?.length && !next[prov].model) {
          const preferred = preferredDefaults[prov]
          const hasPreferred = preferred && models.some(m => m.id === preferred)
          next[prov] = { ...next[prov], model: hasPreferred ? preferred : (models[0]?.id || "") }
        }
      }
      return next
    })
  }, [modelsCatalog])

  const handleTestAndSave = useCallback(async () => {
    if (!canTest) return
    setTestState({ status: "testing" })
    try {
      const providerConfig = {
        provider: {
          flavor: provider,
          apiKey: activeConfig.apiKey.trim() || undefined,
          baseURL: activeConfig.baseURL.trim() || undefined,
        },
        model: activeConfig.model.trim(),
      }
      const result = await window.ipc.invoke("models:test", providerConfig)
      if (result.success) {
        await window.ipc.invoke("models:saveConfig", providerConfig)
        setTestState({ status: "success" })
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

  const renderProviderCard = (p: { id: LlmProviderFlavor; name: string; description: string }) => (
    <button
      key={p.id}
      onClick={() => {
        setProvider(p.id)
        setTestState({ status: "idle" })
      }}
      className={cn(
        "rounded-md border px-3 py-2.5 text-left transition-colors",
        provider === p.id
          ? "border-primary bg-primary/5"
          : "border-border hover:bg-accent"
      )}
    >
      <div className="text-sm font-medium">{p.name}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{p.description}</div>
    </button>
  )

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

      {/* Model selection */}
      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Model</span>
        {modelsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading models...
          </div>
        ) : showModelInput ? (
          <Input
            value={activeConfig.model}
            onChange={(e) => updateConfig(provider, { model: e.target.value })}
            placeholder="Enter model ID"
          />
        ) : (
          <Select
            value={activeConfig.model}
            onValueChange={(value) => updateConfig(provider, { model: value })}
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

      {/* API Key */}
      {requiresApiKey && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">API Key</span>
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
            <div className={cn("flex-1 p-4 min-h-0", activeTab === "models" ? "overflow-y-auto" : "overflow-hidden")}>
              {activeTab === "models" ? (
                <ModelSettings dialogOpen={open} />
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
