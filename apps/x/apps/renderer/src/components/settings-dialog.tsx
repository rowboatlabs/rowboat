"use client"

import * as React from "react"
import { useState, useEffect, useCallback, useMemo } from "react"
import { Server, Key, Shield, Palette, Monitor, Sun, Moon, Loader2, CheckCircle2, Plus, X, Wrench, Search, ChevronRight, Link2, Tags, Mail, BookOpen, User, Plug, HelpCircle, MessageCircle, Bug, Terminal, AlertTriangle, RefreshCw, PanelRight, Bell, Smartphone } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { useTheme } from "@/contexts/theme-context"
import { toast } from "sonner"
import { AccountSettings } from "@/components/settings/account-settings"
import { ConnectedAccountsSettings } from "@/components/settings/connected-accounts-settings"
import { MobileChannelsSettings } from "@/components/settings/mobile-channels-settings"
import type { ApprovalPolicy } from "@x/shared/src/code-mode.js"
import type { ipc as ipcShared } from "@x/shared"
import { startProvisioning, useProvisioning, enabledOptimistic, type AgentStatus, type CodeModeAgentStatus } from "@/lib/code-mode-provisioning"

type ConfigTab = "account" | "connections" | "mobile" | "models" | "mcp" | "security" | "code-mode" | "appearance" | "notifications" | "note-tagging" | "help"

interface TabConfig {
  id: ConfigTab
  label: string
  icon: React.ElementType
  path?: string
  description: string
}

const tabs: TabConfig[] = [
  {
    id: "account",
    label: "Account",
    icon: User,
    description: "Manage your Rowboat account",
  },
  {
    id: "connections",
    label: "Connections",
    icon: Plug,
    description: "Manage accounts and tools",
  },
  {
    id: "mobile",
    label: "Mobile",
    icon: Smartphone,
    description: "Chat with Rowboat from WhatsApp or Telegram",
  },
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
    id: "code-mode",
    label: "Code Mode",
    icon: Terminal,
    description: "Delegate coding tasks to Claude Code or Codex",
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: Palette,
    description: "Customize the look and feel",
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
    description: "Choose which notifications you receive",
  },
  {
    id: "note-tagging",
    label: "Note Tagging",
    icon: Tags,
    path: "config/tags.json",
    description: "Configure tags for notes and emails",
  },
  {
    id: "help",
    label: "Help",
    icon: HelpCircle,
    description: "Get help and support",
  },
]

interface SettingsDialogProps {
  /** Optional trigger element. Omit when controlling `open` externally. */
  children?: React.ReactNode
  /** Tab to open on when the dialog is shown. Defaults to "account". */
  defaultTab?: ConfigTab
  /** Controlled open state. When provided, the dialog is fully controlled. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

// --- Updates section (Help tab) ---

type UpdaterStatus = ipcShared.IPCChannels['updater:status']['req']

function UpdateSettings() {
  const [status, setStatus] = useState<UpdaterStatus | null>(null)

  useEffect(() => {
    void window.ipc.invoke('updater:getStatus', null).then(setStatus)
    return window.ipc.on('updater:status', setStatus)
  }, [])

  if (!status) return null

  const checkNow = () => {
    // Progress arrives via updater:status pushes; using the invoke's snapshot
    // here could stomp a newer pushed state.
    void window.ipc.invoke('updater:check', null)
  }

  let body: React.ReactNode
  switch (status.state) {
    case 'disabled':
      body = (
        <p className="text-xs text-muted-foreground">
          Automatic updates are disabled in development builds.
        </p>
      )
      break
    case 'unsupported':
      body = status.reason === 'not-in-applications' ? (
        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
          <AlertTriangle className="size-3.5 shrink-0 mt-0.5 text-amber-500" />
          Quit Rowboat and move it to the Applications folder to enable automatic updates.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {"Automatic updates aren't available on this platform. "}
          <a
            href="https://github.com/rowboatlabs/rowboat/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground transition-colors"
          >
            Get the latest release
          </a>
        </p>
      )
      break
    case 'checking':
    case 'downloading':
      body = (
        <Button size="sm" variant="outline" disabled>
          <Loader2 className="size-3.5 animate-spin" />
          {status.state === 'checking' ? 'Checking for updates…' : 'Downloading update…'}
        </Button>
      )
      break
    case 'ready':
      body = (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {status.newVersion
              ? `Rowboat ${status.newVersion} is ready to install.`
              : 'An update is ready to install.'}
          </p>
          <Button
            size="sm"
            className="shrink-0"
            onClick={() => void window.ipc.invoke('updater:quitAndInstall', null)}
          >
            Restart to update
          </Button>
        </div>
      )
      break
    case 'error':
      body = (
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <AlertTriangle className="size-3.5 shrink-0 mt-0.5 text-destructive" />
            {`Update check failed: ${status.error ?? 'unknown error'}`}
          </p>
          <Button size="sm" variant="outline" className="shrink-0" onClick={checkNow}>
            Try again
          </Button>
        </div>
      )
      break
    case 'idle':
      body = (
        <div className="space-y-2">
          {/* lastCheckedAt only exists after a check that found no update
              (an available update moves the state to downloading/ready), so
              idle + lastCheckedAt genuinely means "on the latest version". */}
          {status.lastCheckedAt !== undefined && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5 text-green-500 shrink-0" />
              <span>
                {`You're up to date! Rowboat v${status.version} is the latest version.`}
                <span className="text-muted-foreground/60">
                  {` Checked at ${new Date(status.lastCheckedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`}
                </span>
              </span>
            </p>
          )}
          <Button size="sm" variant="outline" onClick={checkNow}>
            <RefreshCw className="size-3.5" />
            Check for updates
          </Button>
        </div>
      )
      break
  }

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-medium">Updates</h4>
        <p className="text-xs text-muted-foreground mt-0.5">Rowboat v{status.version}</p>
      </div>
      {body}
    </div>
  )
}

// --- Help & Support tab ---

function HelpSettings() {
  return (
    <div className="space-y-4">
      <UpdateSettings />
      <Separator />
      <div>
        <h4 className="text-sm font-medium">Help &amp; Support</h4>
        <p className="text-xs text-muted-foreground mt-0.5">Get help from our community</p>
      </div>
      <Button
        variant="outline"
        className="w-full justify-start gap-3 h-auto py-3"
        onClick={() => window.open("https://github.com/rowboatlabs/rowboat/issues/new", "_blank")}
      >
        <div className="flex size-8 items-center justify-center rounded-md bg-destructive/10">
          <Bug className="size-4 text-destructive" />
        </div>
        <div className="flex flex-col items-start">
          <span className="text-sm font-medium">Report a bug</span>
          <span className="text-xs text-muted-foreground">Send feedback to the Rowboat team</span>
        </div>
      </Button>
      <Button
        variant="outline"
        className="w-full justify-start gap-3 h-auto py-3"
        onClick={() => window.open("https://discord.com/invite/wajrgmJQ6b", "_blank")}
      >
        <div className="flex size-8 items-center justify-center rounded-md bg-[#5865F2]">
          <MessageCircle className="size-4 text-white" />
        </div>
        <div className="flex flex-col items-start">
          <span className="text-sm font-medium">Join our Discord</span>
          <span className="text-xs text-muted-foreground">Chat with the community</span>
        </div>
      </Button>
      <Button
        variant="outline"
        className="w-full justify-start gap-3 h-auto py-3"
        onClick={() => window.open("mailto:contact@rowboatlabs.com", "_blank")}
      >
        <div className="flex size-8 items-center justify-center rounded-md bg-muted">
          <Mail className="size-4" />
        </div>
        <div className="flex flex-col items-start">
          <span className="text-sm font-medium">Contact us</span>
          <span className="text-xs text-muted-foreground">contact@rowboatlabs.com</span>
        </div>
      </Button>
      <div className="flex gap-3 text-xs text-muted-foreground">
        <a
          href="https://www.rowboatlabs.com/terms-of-service"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground transition-colors"
        >
          Terms of Service
        </a>
        <span>·</span>
        <a
          href="https://www.rowboatlabs.com/privacy-policy"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground transition-colors"
        >
          Privacy Policy
        </a>
      </div>
    </div>
  )
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
  const { theme, setTheme, chatPanePlacement, setChatPanePlacement, chatPaneSize, setChatPaneSize } = useTheme()

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
      <div>
        <h4 className="text-sm font-medium mb-3">Chat</h4>
        <p className="text-xs text-muted-foreground mb-4">
          Choose where chat sits when another pane is open
        </p>
        <div className="grid grid-cols-2 gap-3">
          <ThemeOption
            label="Chat right"
            icon={PanelRight}
            isSelected={chatPanePlacement === "right"}
            onClick={() => setChatPanePlacement("right")}
          />
          <ThemeOption
            label="Chat middle"
            icon={MessageCircle}
            isSelected={chatPanePlacement === "middle"}
            onClick={() => setChatPanePlacement("middle")}
          />
        </div>
        <h4 className="mt-6 text-sm font-medium mb-3">Chat size</h4>
        <p className="text-xs text-muted-foreground mb-4">
          Choose how much width chat gets when another pane is open
        </p>
        <div className="grid grid-cols-3 gap-3">
          <ThemeOption
            label="Chat smaller"
            icon={MessageCircle}
            isSelected={chatPaneSize === "chat-smaller"}
            onClick={() => setChatPaneSize("chat-smaller")}
          />
          <ThemeOption
            label="Chat equal"
            icon={Monitor}
            isSelected={chatPaneSize === "chat-equal"}
            onClick={() => setChatPaneSize("chat-equal")}
          />
          <ThemeOption
            label="Chat bigger"
            icon={PanelRight}
            isSelected={chatPaneSize === "chat-bigger"}
            onClick={() => setChatPaneSize("chat-bigger")}
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
  openai: "gpt-5.4",
  anthropic: "claude-opus-4-8",
}

const defaultBaseURLs: Partial<Record<LlmProviderFlavor, string>> = {
  ollama: "http://localhost:11434",
  "openai-compatible": "http://localhost:1234/v1",
}

type ProviderModelConfig = {
  apiKey: string
  baseURL: string
  models: string[]
  knowledgeGraphModel: string
  meetingNotesModel: string
  liveNoteAgentModel: string
  autoPermissionDecisionModel: string
}

function ModelSettings({ dialogOpen, rowboatConnected = false }: { dialogOpen: boolean; rowboatConnected?: boolean }) {
  const [provider, setProvider] = useState<LlmProviderFlavor>("openai")
  const [defaultProvider, setDefaultProvider] = useState<LlmProviderFlavor | null>(null)
  const [providerConfigs, setProviderConfigs] = useState<Record<LlmProviderFlavor, ProviderModelConfig>>({
    openai: { apiKey: "", baseURL: "", models: [""], knowledgeGraphModel: "", meetingNotesModel: "", liveNoteAgentModel: "", autoPermissionDecisionModel: "" },
    anthropic: { apiKey: "", baseURL: "", models: [""], knowledgeGraphModel: "", meetingNotesModel: "", liveNoteAgentModel: "", autoPermissionDecisionModel: "" },
    google: { apiKey: "", baseURL: "", models: [""], knowledgeGraphModel: "", meetingNotesModel: "", liveNoteAgentModel: "", autoPermissionDecisionModel: "" },
    openrouter: { apiKey: "", baseURL: "", models: [""], knowledgeGraphModel: "", meetingNotesModel: "", liveNoteAgentModel: "", autoPermissionDecisionModel: "" },
    aigateway: { apiKey: "", baseURL: "", models: [""], knowledgeGraphModel: "", meetingNotesModel: "", liveNoteAgentModel: "", autoPermissionDecisionModel: "" },
    ollama: { apiKey: "", baseURL: "http://localhost:11434", models: [""], knowledgeGraphModel: "", meetingNotesModel: "", liveNoteAgentModel: "", autoPermissionDecisionModel: "" },
    "openai-compatible": { apiKey: "", baseURL: "http://localhost:1234/v1", models: [""], knowledgeGraphModel: "", meetingNotesModel: "", liveNoteAgentModel: "", autoPermissionDecisionModel: "" },
  })
  const [modelsCatalog, setModelsCatalog] = useState<Record<string, LlmModelOption[]>>({})
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [testState, setTestState] = useState<{ status: "idle" | "testing" | "success" | "error"; error?: string }>({ status: "idle" })
  const [configLoading, setConfigLoading] = useState(true)
  const [showMoreProviders, setShowMoreProviders] = useState(false)
  // "Defer background tasks while a chat is running" — a top-level
  // models.json flag. deferExplicit tracks whether the user (or the Ollama
  // auto-enable) has ever set it, so we only auto-enable once.
  const [deferBackgroundTasks, setDeferBackgroundTasks] = useState(false)
  const [deferExplicit, setDeferExplicit] = useState(false)

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
    (prov: LlmProviderFlavor, updates: Partial<ProviderModelConfig>) => {
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

    const asString = (v: unknown): string => (typeof v === "string" ? v : "")

    async function loadCurrentConfig() {
      try {
        setConfigLoading(true)
        const result = await window.ipc.invoke("workspace:readFile", {
          path: "config/models.json",
        })
        const parsed = JSON.parse(result.data)
        setDeferBackgroundTasks(parsed?.deferBackgroundTasks === true)
        setDeferExplicit(typeof parsed?.deferBackgroundTasks === "boolean")
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
                    knowledgeGraphModel: asString(e.knowledgeGraphModel),
                    meetingNotesModel: asString(e.meetingNotesModel),
                    liveNoteAgentModel: asString(e.liveNoteAgentModel),
                    autoPermissionDecisionModel: asString(e.autoPermissionDecisionModel),
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
                knowledgeGraphModel: asString(parsed.knowledgeGraphModel),
                meetingNotesModel: asString(parsed.meetingNotesModel),
                liveNoteAgentModel: asString(parsed.liveNoteAgentModel),
                autoPermissionDecisionModel: asString(parsed.autoPermissionDecisionModel),
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

  const handleDeferToggle = useCallback(async (value: boolean) => {
    setDeferBackgroundTasks(value)
    setDeferExplicit(true)
    try {
      await window.ipc.invoke("models:updateConfig", { deferBackgroundTasks: value })
      window.dispatchEvent(new Event("models-config-changed"))
    } catch {
      toast.error("Failed to save setting")
    }
  }, [])

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
        ...(rowboatConnected ? {} : {
          knowledgeGraphModel: activeConfig.knowledgeGraphModel.trim() || undefined,
          meetingNotesModel: activeConfig.meetingNotesModel.trim() || undefined,
          liveNoteAgentModel: activeConfig.liveNoteAgentModel.trim() || undefined,
          autoPermissionDecisionModel: activeConfig.autoPermissionDecisionModel.trim() || undefined,
        }),
      }
      const result = await window.ipc.invoke("models:test", providerConfig)
      if (result.success) {
        await window.ipc.invoke("models:saveConfig", providerConfig)
        setDefaultProvider(provider)
        setTestState({ status: "success" })
        window.dispatchEvent(new Event('models-config-changed'))
        // Local models compete with background agents for the same hardware:
        // when the user connects Ollama and has never touched the defer
        // flag, enable it for them (they can switch it off below).
        if (provider === "ollama" && !deferExplicit && !deferBackgroundTasks) {
          void handleDeferToggle(true)
        }
        // Capability probe caveats (local models): saved, but the user should
        // know when the model can't do tools or has a too-small context.
        const warnings: string[] = result.warnings ?? []
        if (warnings.length > 0) {
          for (const warning of warnings) {
            toast.warning(warning, { duration: 12000 })
          }
          toast.success("Model configuration saved (with warnings)")
        } else {
          toast.success("Model configuration saved")
        }
      } else {
        setTestState({ status: "error", error: result.error })
        toast.error(result.error || "Connection test failed")
      }
    } catch {
      setTestState({ status: "error", error: "Connection test failed" })
      toast.error("Connection test failed")
    }
  }, [canTest, provider, activeConfig, rowboatConnected, deferExplicit, deferBackgroundTasks, handleDeferToggle])

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
        ...(rowboatConnected ? {} : {
          knowledgeGraphModel: config.knowledgeGraphModel.trim() || undefined,
          meetingNotesModel: config.meetingNotesModel.trim() || undefined,
          liveNoteAgentModel: config.liveNoteAgentModel.trim() || undefined,
          autoPermissionDecisionModel: config.autoPermissionDecisionModel.trim() || undefined,
        }),
      })
      setDefaultProvider(prov)
      window.dispatchEvent(new Event('models-config-changed'))
      toast.success("Default provider updated")
    } catch {
      toast.error("Failed to set default provider")
    }
  }, [providerConfigs, rowboatConnected])

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
        if (!rowboatConnected) {
          parsed.knowledgeGraphModel = defConfig.knowledgeGraphModel.trim() || undefined
          parsed.meetingNotesModel = defConfig.meetingNotesModel.trim() || undefined
          parsed.liveNoteAgentModel = defConfig.liveNoteAgentModel.trim() || undefined
          parsed.autoPermissionDecisionModel = defConfig.autoPermissionDecisionModel.trim() || undefined
        }
      }
      await window.ipc.invoke("workspace:writeFile", {
        path: "config/models.json",
        data: JSON.stringify(parsed, null, 2),
      })
      setProviderConfigs(prev => ({
        ...prev,
        [prov]: { apiKey: "", baseURL: defaultBaseURLs[prov] || "", models: [""], knowledgeGraphModel: "", meetingNotesModel: "", liveNoteAgentModel: "", autoPermissionDecisionModel: "" },
      }))
      setTestState({ status: "idle" })
      window.dispatchEvent(new Event('models-config-changed'))
      toast.success("Provider configuration removed")
    } catch {
      toast.error("Failed to remove provider")
    }
  }, [defaultProvider, providerConfigs, rowboatConnected])

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
          {isDefault && !rowboatConnected && (
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-primary">
              Default
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">{p.description}</div>
        {!isDefault && hasModel && isSelected && (
          <div className="mt-1.5 flex items-center gap-3">
            {!rowboatConnected && (
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
            )}
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
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{rowboatConnected ? "Model" : "Assistant model"}</span>
          {modelsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading...
            </div>
          ) : (
            <div className="space-y-2">
              {showModelInput ? (
                <Input
                  value={primaryModel}
                  onChange={(e) => updateConfig(provider, { models: [e.target.value] })}
                  placeholder="Enter model"
                />
              ) : (
                <Select
                  value={primaryModel}
                  onValueChange={(value) => updateConfig(provider, { models: [value] })}
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
            </div>
          )}
          {modelsError && (
            <div className="text-xs text-destructive">{modelsError}</div>
          )}
        </div>

        {!rowboatConnected && (<>
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

        {/* Meeting notes model */}
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Meeting notes model</span>
          {modelsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading...
            </div>
          ) : showModelInput ? (
            <Input
              value={activeConfig.meetingNotesModel}
              onChange={(e) => updateConfig(provider, { meetingNotesModel: e.target.value })}
              placeholder={primaryModel || "Enter model"}
            />
          ) : (
            <Select
              value={activeConfig.meetingNotesModel || "__same__"}
              onValueChange={(value) => updateConfig(provider, { meetingNotesModel: value === "__same__" ? "" : value })}
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

        {/* Track block model */}
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Track block model</span>
          {modelsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading...
            </div>
          ) : showModelInput ? (
            <Input
              value={activeConfig.liveNoteAgentModel}
              onChange={(e) => updateConfig(provider, { liveNoteAgentModel: e.target.value })}
              placeholder={primaryModel || "Enter model"}
            />
          ) : (
            <Select
              value={activeConfig.liveNoteAgentModel || "__same__"}
              onValueChange={(value) => updateConfig(provider, { liveNoteAgentModel: value === "__same__" ? "" : value })}
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

        {/* Auto-permission model */}
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Auto-permission model</span>
          {modelsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading...
            </div>
          ) : showModelInput ? (
            <Input
              value={activeConfig.autoPermissionDecisionModel}
              onChange={(e) => updateConfig(provider, { autoPermissionDecisionModel: e.target.value })}
              placeholder={primaryModel || "Enter model"}
            />
          ) : (
            <Select
              value={activeConfig.autoPermissionDecisionModel || "__same__"}
              onValueChange={(value) => updateConfig(provider, { autoPermissionDecisionModel: value === "__same__" ? "" : value })}
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
        </>)}
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

      {/* Defer background tasks while chatting */}
      <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-medium">Defer background tasks while chatting</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Background agents (knowledge sync, live notes, tasks) wait until your chat finishes. Recommended for local models.
          </div>
        </div>
        <Switch checked={deferBackgroundTasks} onCheckedChange={handleDeferToggle} />
      </div>

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
  no_auth?: boolean
  auth_schemes?: string[]
  composio_managed_auth_schemes?: string[]
}

function ToolsLibrarySettings({ dialogOpen, rowboatConnected }: { dialogOpen: boolean; rowboatConnected: boolean }) {
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
  }, [dialogOpen, checkApiKey, loadConnected])

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
      toast.success(`Disconnected from ${toolkitSlug}`)
    } catch {
      toast.error("Failed to disconnect")
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
      {/* Section A: API Key (only in BYOK mode) */}
      {!rowboatConnected && (
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
      )}

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
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
              {filteredToolkits.map((toolkit) => {
                const isConnected = connectedToolkits.has(toolkit.slug)
                const isConnecting = connectingToolkit === toolkit.slug

                return (
                  <div key={toolkit.slug} className="border rounded-lg overflow-hidden">
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      {/* Logo */}
                      {toolkit.meta.logo ? (
                        <img
                          src={toolkit.meta.logo}
                          alt=""
                          className="size-7 rounded object-contain shrink-0"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                      ) : (
                        <div className="size-7 rounded bg-muted flex items-center justify-center shrink-0">
                          <Wrench className="size-3.5 text-muted-foreground" />
                        </div>
                      )}

                      {/* Name & description */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate">{toolkit.name}</span>
                          {isConnected && (
                            <span className="rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-green-600">
                              Connected
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {toolkit.meta.description}
                        </p>
                      </div>

                      {/* Connect / Disconnect button */}
                      {isConnected ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDisconnect(toolkit.slug)}
                          className="text-xs h-7 shrink-0"
                        >
                          Disconnect
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleConnect(toolkit.slug)}
                          disabled={isConnecting}
                          className="text-xs h-7 shrink-0"
                        >
                          {isConnecting ? (
                            <><Loader2 className="size-3 animate-spin mr-1" />Connecting...</>
                          ) : (
                            <><Link2 className="size-3 mr-1" />Connect</>
                          )}
                        </Button>
                      )}
                    </div>
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

// --- Rowboat Model Settings (when signed in via Rowboat) ---
//
// Hybrid mode: every dropdown lists the gateway catalog PLUS any models from
// BYOK providers configured below. Values are provider-qualified
// ("provider::model") and saved via models:updateConfig as {provider, model}
// refs, so a signed-in user can e.g. keep the gateway assistant while
// running background agents on a local Ollama model.

interface HybridModelOption {
  provider: string
  model: string
  label: string
}

const providerDisplayNames: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Gemini',
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
  aigateway: 'AI Gateway',
  'openai-compatible': 'OpenAI-Compatible',
  rowboat: 'Rowboat',
}

const HYBRID_SEP = "::"
const hybridKey = (provider: string, model: string) => `${provider}${HYBRID_SEP}${model}`

function parseHybridKey(key: string): { provider: string; model: string } | null {
  const index = key.indexOf(HYBRID_SEP)
  if (index <= 0) return null
  return { provider: key.slice(0, index), model: key.slice(index + HYBRID_SEP.length) }
}

function RowboatModelSettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [options, setOptions] = useState<HybridModelOption[]>([])
  const [selectedDefault, setSelectedDefault] = useState("")
  const [selectedKg, setSelectedKg] = useState("")
  const [selectedLiveNote, setSelectedLiveNote] = useState("")
  const [selectedAutoPermission, setSelectedAutoPermission] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!dialogOpen) return

    async function load() {
      setLoading(true)
      try {
        const collected: HybridModelOption[] = []
        const seen = new Set<string>()
        const push = (provider: string, model: string, label?: string) => {
          if (!model) return
          const key = hybridKey(provider, model)
          if (seen.has(key)) return
          seen.add(key)
          collected.push({ provider, model, label: label || model })
        }

        const catalog: Record<string, LlmModelOption[]> = {}
        try {
          const listResult = await window.ipc.invoke("models:list", null)
          for (const p of listResult.providers || []) {
            catalog[p.id] = p.models || []
          }
        } catch { /* offline — BYOK entries below still load */ }
        for (const m of catalog["rowboat"] || []) push("rowboat", m.id, m.name || m.id)

        let parsed: Record<string, unknown> = {}
        try {
          const configResult = await window.ipc.invoke("workspace:readFile", { path: "config/models.json" })
          parsed = JSON.parse(configResult.data)
        } catch { /* no BYOK config yet */ }

        const providersMap = (parsed.providers ?? {}) as Record<string, Record<string, unknown>>
        for (const [flavor, entry] of Object.entries(providersMap)) {
          const hasKey = typeof entry.apiKey === "string" && (entry.apiKey as string).trim().length > 0
          const hasBaseURL = typeof entry.baseURL === "string" && (entry.baseURL as string).trim().length > 0
          if (!hasKey && !hasBaseURL) continue
          push(flavor, typeof entry.model === "string" ? entry.model : "")
          const catalogModels = catalog[flavor] || []
          if (catalogModels.length > 0) {
            for (const m of catalogModels) push(flavor, m.id, m.name || m.id)
          } else {
            for (const m of Array.isArray(entry.models) ? entry.models as string[] : []) push(flavor, m)
          }
        }
        setOptions(collected)

        // Current selections. Legacy string overrides pair with the BYOK
        // top-level flavor (mirrors core/models/defaults.ts).
        const legacyFlavor = (parsed.provider as Record<string, unknown> | undefined)?.flavor
        const toKey = (value: unknown): string => {
          if (!value) return ""
          if (typeof value === "string") {
            return typeof legacyFlavor === "string" ? hybridKey(legacyFlavor, value) : ""
          }
          const ref = value as { provider?: unknown; model?: unknown }
          return typeof ref.provider === "string" && typeof ref.model === "string"
            ? hybridKey(ref.provider, ref.model)
            : ""
        }
        setSelectedDefault(toKey(parsed.defaultSelection))
        setSelectedKg(toKey(parsed.knowledgeGraphModel))
        setSelectedLiveNote(toKey(parsed.liveNoteAgentModel))
        setSelectedAutoPermission(toKey(parsed.autoPermissionDecisionModel))
      } catch {
        toast.error("Failed to load models")
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [dialogOpen])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const toRef = (key: string) => (key ? parseHybridKey(key) : null)
      await window.ipc.invoke("models:updateConfig", {
        defaultSelection: toRef(selectedDefault),
        knowledgeGraphModel: toRef(selectedKg),
        liveNoteAgentModel: toRef(selectedLiveNote),
        autoPermissionDecisionModel: toRef(selectedAutoPermission),
      })
      window.dispatchEvent(new Event("models-config-changed"))
      toast.success("Model configuration saved")
    } catch {
      toast.error("Failed to save model configuration")
    } finally {
      setSaving(false)
    }
  }, [selectedDefault, selectedKg, selectedLiveNote, selectedAutoPermission])

  const renderSelect = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    defaultLabel: string,
  ) => (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <Select value={value || "__default__"} onValueChange={(v) => onChange(v === "__default__" ? "" : v)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={defaultLabel} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__default__">{defaultLabel}</SelectItem>
          {options.map((o) => {
            const key = hybridKey(o.provider, o.model)
            return (
              <SelectItem key={key} value={key}>
                {o.label}
                <span className="ml-2 text-xs text-muted-foreground">
                  {providerDisplayNames[o.provider] || o.provider}
                </span>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    </div>
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Select the models Rowboat uses. Rowboat models are provided through your account; models from your own providers route through your keys or local runtimes.
      </p>

      {renderSelect("Assistant model", selectedDefault, setSelectedDefault, "Rowboat default")}
      {renderSelect("Knowledge graph model", selectedKg, setSelectedKg, "Rowboat default")}
      {renderSelect("Background agents model", selectedLiveNote, setSelectedLiveNote, "Rowboat default")}
      {renderSelect("Permission checks model", selectedAutoPermission, setSelectedAutoPermission, "Rowboat default")}

      {/* Save */}
      <Button onClick={handleSave} disabled={saving}>
        {saving ? (
          <><Loader2 className="size-4 animate-spin mr-2" />Saving...</>
        ) : (
          "Save"
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
  noteEffect?: "create" | "skip" | "none"
}

const NOTE_TAG_TYPE_ORDER = [
  "relationship", "relationship-sub", "topic", "action", "status", "source",
]

const EMAIL_TAG_TYPE_ORDER = [
  "relationship", "topic", "email-type", "noise", "action", "status",
]

const TAG_TYPE_LABELS: Record<string, string> = {
  "relationship": "Relationship",
  "relationship-sub": "Relationship Sub-Tags",
  "topic": "Topic",
  "email-type": "Email Type",
  "noise": "Noise",
  "action": "Action",
  "status": "Status",
  "source": "Source",
}


function TagGroupTable({
  group,
  tags: _tags,
  collapsed,
  onToggle,
  onAdd,
  onUpdate,
  onRemove,
  getGlobalIndex,
  isEmail,
}: {
  group: { type: string; label: string; tags: TagDef[] }
  tags: TagDef[]
  collapsed: boolean
  onToggle: () => void
  onAdd: () => void
  onUpdate: (index: number, field: keyof TagDef, value: string | boolean) => void
  onRemove: (index: number) => void
  getGlobalIndex: (type: string, localIndex: number) => number
  isEmail: boolean
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <button
          onClick={onToggle}
          className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", !collapsed && "rotate-90")} />
          {group.label}
          <span className="text-[10px] ml-0.5">({group.tags.length})</span>
        </button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onAdd}
        >
          <Plus className="size-3 mr-1" />
          Add
        </Button>
      </div>
      {!collapsed && group.tags.length > 0 && (
        <div className="border rounded-md overflow-hidden">
          <div className={cn(
            "gap-1 bg-muted/50 px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider grid",
            isEmail ? "grid-cols-[100px_1fr_1fr_60px_24px]" : "grid-cols-[100px_1fr_1fr_24px]"
          )}>
            <div>Label</div>
            <div>Description</div>
            <div>Example</div>
            {isEmail && <div className="text-center" title="Emails with this label will be excluded from creating notes">Skip notes</div>}
            <div />
          </div>
          {group.tags.map((tag, localIdx) => {
            const globalIdx = getGlobalIndex(group.type, localIdx)
            return (
              <div key={globalIdx} className={cn(
                "gap-1 border-t px-2 py-0.5 items-center grid",
                isEmail ? "grid-cols-[100px_1fr_1fr_60px_24px]" : "grid-cols-[100px_1fr_1fr_24px]"
              )}>
                <Input
                  value={tag.tag}
                  onChange={e => onUpdate(globalIdx, "tag", e.target.value)}
                  className="h-7 text-xs"
                  placeholder="tag-name"
                  title={tag.tag}
                />
                <Input
                  value={tag.description}
                  onChange={e => onUpdate(globalIdx, "description", e.target.value)}
                  className="h-7 text-xs"
                  placeholder="Description"
                  title={tag.description}
                />
                <Input
                  value={tag.example || ""}
                  onChange={e => onUpdate(globalIdx, "example", e.target.value)}
                  className="h-7 text-xs"
                  placeholder="Example"
                  title={tag.example || ""}
                />
                {isEmail && (
                  <div className="flex justify-center">
                    <Switch
                      checked={tag.noteEffect === "skip"}
                      onCheckedChange={checked => onUpdate(globalIdx, "noteEffect", checked ? "skip" : "create")}
                      className="scale-75"
                    />
                  </div>
                )}
                <button
                  onClick={() => onRemove(globalIdx)}
                  className="flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}
      {!collapsed && group.tags.length === 0 && (
        <div className="text-xs text-muted-foreground italic px-2">No tags in this group</div>
      )}
    </div>
  )
}

function NoteTaggingSettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [tags, setTags] = useState<TagDef[]>([])
  const [originalTags, setOriginalTags] = useState<TagDef[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [activeSection, setActiveSection] = useState<"notes" | "email">("notes")

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
        setTags([])
        setOriginalTags([])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [dialogOpen])

  const noteGroups = useMemo(() => {
    const map = new Map<string, TagDef[]>()
    for (const tag of tags) {
      if (tag.applicability === "email") continue
      const list = map.get(tag.type) ?? []
      list.push(tag)
      map.set(tag.type, list)
    }
    return NOTE_TAG_TYPE_ORDER.filter(type => map.has(type)).map(type => ({
      type,
      label: TAG_TYPE_LABELS[type],
      tags: map.get(type) ?? [],
    }))
  }, [tags])

  const emailGroups = useMemo(() => {
    const map = new Map<string, TagDef[]>()
    for (const tag of tags) {
      if (tag.applicability === "notes") continue
      const list = map.get(tag.type) ?? []
      list.push(tag)
      map.set(tag.type, list)
    }
    return EMAIL_TAG_TYPE_ORDER.filter(type => map.has(type)).map(type => ({
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

  const updateTag = useCallback((index: number, field: keyof TagDef, value: string | boolean) => {
    setTags(prev => prev.map((t, i) => i === index ? { ...t, [field]: value } : t))
  }, [])

  const removeTag = useCallback((index: number) => {
    setTags(prev => prev.filter((_, i) => i !== index))
  }, [])

  const addTag = useCallback((type: string) => {
    const isEmailSection = activeSection === "email"
    const applicability = isEmailSection ? "email" as const : "notes" as const
    // For email-only types, always use "email"; for notes-only types, always use "notes"; otherwise use "both"
    const emailOnlyTypes = ["email-type", "noise"]
    const notesOnlyTypes = ["relationship-sub", "source"]
    let finalApplicability: "email" | "notes" | "both" = "both"
    if (emailOnlyTypes.includes(type)) finalApplicability = "email"
    else if (notesOnlyTypes.includes(type)) finalApplicability = "notes"
    else finalApplicability = isEmailSection ? "email" : applicability

    const newTag: TagDef = {
      tag: "",
      type,
      applicability: finalApplicability === "email" && !isEmailSection ? "both" : finalApplicability === "notes" && isEmailSection ? "both" : finalApplicability,
      description: "",
      noteEffect: isEmailSection ? "create" : "none",
    }
    const lastIndex = tags.reduce((acc, t, i) => t.type === type ? i : acc, -1)
    if (lastIndex === -1) {
      setTags(prev => [...prev, newTag])
    } else {
      setTags(prev => [...prev.slice(0, lastIndex + 1), newTag, ...prev.slice(lastIndex + 1)])
    }
  }, [tags, activeSection])

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

  const currentGroups = activeSection === "notes" ? noteGroups : emailGroups

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 mb-3 border-b">
        <button
          onClick={() => setActiveSection("notes")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors",
            activeSection === "notes"
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <BookOpen className="size-3.5" />
          Note Tags
        </button>
        <button
          onClick={() => setActiveSection("email")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors",
            activeSection === "email"
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Mail className="size-3.5" />
          Email Labels
        </button>
      </div>
      <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
        {currentGroups.map(group => (
          <TagGroupTable
            key={group.type}
            group={group}
            tags={tags}
            collapsed={collapsedGroups.has(group.type)}
            onToggle={() => toggleGroup(group.type)}
            onAdd={() => addTag(group.type)}
            onUpdate={updateTag}
            onRemove={removeTag}
            getGlobalIndex={getGlobalIndex}
            isEmail={activeSection === "email"}
          />
        ))}
      </div>
      <div className="pt-3 border-t mt-3 flex items-center justify-between">
        <div>
          {hasChanges && (
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={saving || !hasChanges}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  )
}

// --- Code Mode Settings ---

function AgentStatusRow({
  name,
  agent,
  signInCommand,
  status,
  onProvisioned,
}: {
  name: string
  agent: 'claude' | 'codex'
  signInCommand: string
  status: AgentStatus | null
  onProvisioned: () => void
}) {
  const prov = useProvisioning(agent)
  const provisioning = prov !== undefined && prov.error === undefined
  const error = prov?.error ?? null
  const enable = useCallback(() => startProvisioning(agent, onProvisioned), [agent, onProvisioned])

  // Treat a just-enabled engine as installed even before the status refresh lands.
  const installed = (status?.installed ?? false) || enabledOptimistic.has(agent)
  const ready = installed && status?.signedIn
  return (
    <div className="rounded-md border px-3 py-2.5 flex items-center gap-3">
      <Terminal className="size-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{name}</div>
        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3">
          <span className={cn("inline-flex items-center gap-1", installed ? "text-green-600" : "text-muted-foreground")}>
            {installed ? <CheckCircle2 className="size-3" /> : <X className="size-3" />}
            {installed ? 'Engine ready' : 'Not enabled'}
          </span>
          <span className={cn("inline-flex items-center gap-1", status?.signedIn ? "text-green-600" : "text-muted-foreground")}>
            {status?.signedIn ? <CheckCircle2 className="size-3" /> : <X className="size-3" />}
            Signed in
          </span>
        </div>
        {error && <div className="text-xs text-red-600 mt-1 break-words">{error}</div>}
      </div>
      {provisioning ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 tabular-nums">
          <Loader2 className="size-3 animate-spin" />
          {prov?.pct != null ? `${prov.pct}%` : null}
        </span>
      ) : ready ? (
        <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium leading-none text-green-600">
          Ready
        </span>
      ) : !installed ? (
        <button
          type="button"
          onClick={enable}
          className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 shrink-0"
        >
          Enable
        </button>
      ) : (
        <span className="text-xs text-muted-foreground shrink-0">
          Run <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{signInCommand}</code>
        </span>
      )}
    </div>
  )
}

function CodeModeSettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [enabled, setEnabled] = useState(false)
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>('ask')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<CodeModeAgentStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)

  const loadStatus = useCallback(async () => {
    setStatusLoading(true)
    try {
      const result = await window.ipc.invoke("codeMode:checkAgentStatus", null)
      setStatus(result)
    } catch {
      setStatus(null)
    } finally {
      setStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!dialogOpen) return
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const result = await window.ipc.invoke("codeMode:getConfig", null)
        if (!cancelled) {
          setEnabled(result.enabled)
          setApprovalPolicy(result.approvalPolicy ?? 'ask')
        }
      } catch {
        if (!cancelled) setEnabled(false)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    loadStatus()
    return () => { cancelled = true }
  }, [dialogOpen, loadStatus])

  const handleToggle = useCallback(async (next: boolean) => {
    setSaving(true)
    setEnabled(next)
    try {
      await window.ipc.invoke("codeMode:setConfig", { enabled: next, approvalPolicy })
      window.dispatchEvent(new Event("code-mode-config-changed"))
      toast.success(next ? "Code mode enabled" : "Code mode disabled")
    } catch {
      setEnabled(!next)
      toast.error("Failed to update code mode")
    } finally {
      setSaving(false)
    }
  }, [approvalPolicy])

  const handlePolicyChange = useCallback(async (next: ApprovalPolicy) => {
    const prev = approvalPolicy
    setSaving(true)
    setApprovalPolicy(next)
    try {
      await window.ipc.invoke("codeMode:setConfig", { enabled, approvalPolicy: next })
      window.dispatchEvent(new Event("code-mode-config-changed"))
    } catch {
      setApprovalPolicy(prev)
      toast.error("Failed to update approval policy")
    } finally {
      setSaving(false)
    }
  }, [enabled, approvalPolicy])

  const anyReady = status?.claude.installed && status?.claude.signedIn
    || status?.codex.installed && status?.codex.signedIn

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="size-4 animate-spin mr-2" />
        Loading...
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2 text-sm text-muted-foreground leading-relaxed">
        <p>
          <strong className="text-foreground">Code mode</strong> lets the assistant delegate coding tasks
          to <strong className="text-foreground">Claude Code</strong> or <strong className="text-foreground">Codex</strong> running
          on your machine. Pick the agent inline from the composer; the assistant runs it on-device
          and streams its work — tool calls, file diffs, and approvals — back into chat.
        </p>
        <p>
          Requires an active <strong className="text-foreground">Claude Code</strong> subscription or
          a <strong className="text-foreground">ChatGPT/Codex</strong> subscription. You can have one or both.
        </p>
        <p>
          For each agent you want to use, you must have it{' '}
          <strong className="text-foreground">installed and logged in</strong> on this machine: click{' '}
          <strong className="text-foreground">Enable</strong> below to download its engine, and sign in by
          running <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">claude login</code>{' '}
          or <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">codex login</code>{' '}
          in your terminal. Code mode uses that saved login.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Agent status</span>
          <button
            onClick={() => { void loadStatus() }}
            disabled={statusLoading}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {statusLoading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            Re-check
          </button>
        </div>
        <div className="space-y-2">
          <AgentStatusRow
            name="Claude Code"
            agent="claude"
            signInCommand="claude login"
            status={status?.claude ?? null}
            onProvisioned={loadStatus}
          />
          <AgentStatusRow
            name="Codex"
            agent="codex"
            signInCommand="codex login"
            status={status?.codex ?? null}
            onProvisioned={loadStatus}
          />
        </div>
      </div>

      <div className="rounded-md border px-3 py-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">Enable code mode</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Shows the code mode chip in the composer and lets the assistant delegate to your installed agents.
          </div>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={saving}
        />
      </div>

      {enabled && (
        <div className="rounded-md border px-3 py-3 space-y-2">
          <div className="text-sm font-medium">Approvals</div>
          <div className="text-xs text-muted-foreground">
            How the coding agent checks in before changing files or running commands. You always see
            everything it does in the timeline — this only controls the prompts.
          </div>
          <Select
            value={approvalPolicy}
            onValueChange={(v) => handlePolicyChange(v as ApprovalPolicy)}
            disabled={saving}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ask">Ask every time</SelectItem>
              <SelectItem value="auto-approve-reads">Auto-approve reads</SelectItem>
              <SelectItem value="yolo">Auto-approve everything (YOLO)</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground">
            {approvalPolicy === 'ask' && 'You approve every file change and command the agent wants to run.'}
            {approvalPolicy === 'auto-approve-reads' && 'Reading and searching run automatically; you still approve writes, edits, and commands.'}
            {approvalPolicy === 'yolo' && 'The agent runs everything — writes, edits, and commands — without asking. Use only in folders you trust.'}
          </div>
        </div>
      )}

      {enabled && status && !anyReady && (
        <div className="rounded-md border border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2.5 flex items-start gap-2 text-xs">
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
          <div className="text-amber-900 dark:text-amber-200">
            Neither Claude Code nor Codex is ready. Click Enable above to download an engine, sign in with a
            subscription account, then click Re-check.
          </div>
        </div>
      )}
    </div>
  )
}

// --- Notification Settings ---

type NotificationCategoryKey = "chat_completion" | "new_email" | "agent_permission" | "background_task"

const NOTIFICATION_CATEGORIES: { key: NotificationCategoryKey; label: string; description: string }[] = [
  {
    key: "chat_completion",
    label: "Chat responses",
    description: "When an agent finishes responding while the app is in the background.",
  },
  {
    key: "new_email",
    label: "New email",
    description: "When a new email arrives during sync while the app is in the background.",
  },
  {
    key: "agent_permission",
    label: "Permission requests",
    description: "When an agent needs your approval to run a tool. Always shown, even when the app is focused.",
  },
  {
    key: "background_task",
    label: "Background agents",
    description: "When a background agent you've set up has something to surface. Click to open it on the background tasks page.",
  },
]

function NotificationSettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [categories, setCategories] = useState<Record<NotificationCategoryKey, boolean> | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!dialogOpen) return
    let cancelled = false
    async function load() {
      try {
        const result = await window.ipc.invoke("notifications:getSettings", null)
        if (!cancelled) setCategories(result.categories)
      } catch {
        if (!cancelled) toast.error("Failed to load notification settings")
      }
    }
    load()
    return () => { cancelled = true }
  }, [dialogOpen])

  const handleToggle = useCallback(async (key: NotificationCategoryKey, next: boolean) => {
    // Optimistic update with rollback on failure.
    const previous = categories
    if (!previous) return
    const updated = { ...previous, [key]: next }
    setCategories(updated)
    setSaving(true)
    try {
      await window.ipc.invoke("notifications:setSettings", { categories: updated })
    } catch {
      setCategories(previous)
      toast.error("Failed to update notification settings")
    } finally {
      setSaving(false)
    }
  }, [categories])

  if (!categories) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="size-4 animate-spin mr-2" />
        Loading...
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="text-sm text-muted-foreground leading-relaxed">
        Choose which desktop notifications Rowboat sends you. Ambient notifications are only shown
        when the app is in the background.
      </div>

      <div className="space-y-2">
        {NOTIFICATION_CATEGORIES.map((cat) => (
          <div key={cat.key} className="rounded-md border px-3 py-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{cat.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{cat.description}</div>
            </div>
            <Switch
              checked={categories[cat.key]}
              onCheckedChange={(next) => handleToggle(cat.key, next)}
              disabled={saving}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

// --- Main Settings Dialog ---

export function SettingsDialog({ children, defaultTab = "account", open: controlledOpen, onOpenChange }: SettingsDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = useCallback((next: boolean) => {
    if (onOpenChange) onOpenChange(next)
    else setInternalOpen(next)
  }, [onOpenChange])
  const [activeTab, setActiveTab] = useState<ConfigTab>(defaultTab)
  const [content, setContent] = useState("")
  const [originalContent, setOriginalContent] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rowboatConnected, setRowboatConnected] = useState(false)

  // Reset to the requested default tab each time the dialog is opened
  useEffect(() => {
    if (open) setActiveTab(defaultTab)
  }, [open, defaultTab])

  // Check if user is signed in to Rowboat
  useEffect(() => {
    if (!open) return
    window.ipc.invoke('oauth:getState', null).then((result) => {
      const connected = result.config?.rowboat?.connected ?? false
      setRowboatConnected(connected)
    }).catch(() => {
      setRowboatConnected(false)
    })
  }, [open])

  // Hybrid mode: the Models tab is shown in both modes — signed-in users can
  // pick gateway models AND bring their own providers/models alongside.
  const visibleTabs = tabs

  const activeTabConfig = visibleTabs.find((t) => t.id === activeTab) ?? visibleTabs[0]
  const isJsonTab = activeTab === "mcp" || activeTab === "security"

  const formatJson = (jsonString: string): string => {
    try {
      return JSON.stringify(JSON.parse(jsonString), null, 2)
    } catch {
      return jsonString
    }
  }

  const loadConfig = useCallback(async (tab: ConfigTab) => {
    if (tab === "appearance" || tab === "models" || tab === "note-tagging" || tab === "account" || tab === "connections" || tab === "help" || tab === "code-mode" || tab === "notifications") return
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
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
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
              {visibleTabs.map((tab) => (
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
                {activeTab === "models" && rowboatConnected
                  ? "Select your default models"
                  : activeTabConfig.description}
              </p>
            </div>

            {/* Content */}
            <div className={cn("flex-1 p-4 min-h-0", (activeTab === "models" || activeTab === "connections" || activeTab === "mobile" || activeTab === "account" || activeTab === "code-mode" || activeTab === "notifications") ? "overflow-y-auto" : activeTab === "note-tagging" ? "overflow-hidden flex flex-col" : "overflow-hidden")}>
              {activeTab === "account" ? (
                <AccountSettings dialogOpen={open} />
              ) : activeTab === "connections" ? (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">Primary accounts</h4>
                    <ConnectedAccountsSettings dialogOpen={open} />
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">Library</h4>
                    <ToolsLibrarySettings dialogOpen={open} rowboatConnected={rowboatConnected} />
                  </div>
                </div>
              ) : activeTab === "mobile" ? (
                <MobileChannelsSettings dialogOpen={open} />
              ) : activeTab === "models" ? (
                rowboatConnected
                  ? (
                    <div className="space-y-8">
                      <RowboatModelSettings dialogOpen={open} />
                      <Separator />
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold">Your own providers</h4>
                        <p className="text-xs text-muted-foreground">
                          Connect your own API keys or local runtimes (Ollama, LM Studio). Their models appear in the model pickers above and alongside your Rowboat models, and are billed to you directly.
                        </p>
                        <ModelSettings dialogOpen={open} rowboatConnected />
                      </div>
                    </div>
                  )
                  : <ModelSettings dialogOpen={open} />
              ) : activeTab === "note-tagging" ? (
                <NoteTaggingSettings dialogOpen={open} />
              ) : activeTab === "appearance" ? (
                <AppearanceSettings />
              ) : activeTab === "notifications" ? (
                <NotificationSettings dialogOpen={open} />
              ) : activeTab === "help" ? (
                <HelpSettings />
              ) : activeTab === "code-mode" ? (
                <CodeModeSettings dialogOpen={open} />
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
