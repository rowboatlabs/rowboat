"use client"

import * as React from "react"
import { useState, useEffect, useCallback, useMemo } from "react"
import { Server, Key, Shield, Palette, Monitor, Sun, Moon, Loader2, CheckCircle2, Plus, Minus, X, Wrench, Search, ChevronRight, Link2, Tags, Mail, BookOpen, User, Plug, HelpCircle, MessageCircle, Terminal, AlertTriangle, RefreshCw, PanelRight, Bell, Smartphone } from "lucide-react"

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
import * as analytics from "@/lib/analytics"
import { useTheme } from "@/contexts/theme-context"
import { toast } from "sonner"
import { AnthropicIcon, DiscordIcon, GenericApiIcon, GitHubIcon, GoogleIcon, OllamaIcon, OpenAIIcon, OpenRouterIcon, VercelIcon } from "@/components/onboarding/provider-icons"
import { AccountSettings } from "@/components/settings/account-settings"
import { ConnectedAccountsSettings } from "@/components/settings/connected-accounts-settings"
import { MobileChannelsSettings } from "@/components/settings/mobile-channels-settings"
import type { ApprovalPolicy } from "@x/shared/src/code-mode.js"
import { DEFAULT_TURN_LIMITS_SETTINGS } from "@x/shared/src/turn-limits.js"
import type { ipc as ipcShared } from "@x/shared"
import { startProvisioning, useProvisioning, enabledOptimistic, type AgentStatus, type CodeModeAgentStatus } from "@/lib/code-mode-provisioning"
import { useProviderModels } from "@/hooks/use-provider-models"
import { useChatGPT } from "@/hooks/useChatGPT"
import { ModelSelector, type ModelRef } from "@/components/model-selector"

type ConfigTab = "account" | "connections" | "mobile" | "models" | "mcp" | "security" | "code-mode" | "appearance" | "notifications" | "note-tagging" | "advanced" | "help"

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
    id: "advanced",
    label: "Advanced",
    icon: Wrench,
    description: "Advanced runtime and cost controls",
  },
  {
    id: "help",
    label: "Help",
    icon: HelpCircle,
    description: "Get help and support",
  },
]

/** Sidebar nav grouping: identity first, capabilities, then app-level. */
const NAV_SECTIONS: { label: string | null; ids: ConfigTab[] }[] = [
  { label: null, ids: ["account", "connections", "mobile"] },
  { label: "Configure", ids: ["models", "mcp", "security", "code-mode", "note-tagging", "advanced"] },
  { label: "App", ids: ["appearance", "notifications", "help"] },
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
        <GitHubIcon className="size-5 shrink-0" />
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
        <DiscordIcon className="size-5 shrink-0" />
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
        <Mail className="size-5 shrink-0" />
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

function LaunchAtLoginSetting() {
  const [openAtLogin, setOpenAtLogin] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    window.ipc.invoke("app:getLoginItemSettings", null)
      .then(({ openAtLogin }) => setOpenAtLogin(openAtLogin))
      .catch(() => { /* dev builds report off */ })
      .finally(() => setLoaded(true))
  }, [])

  const handleToggle = async (next: boolean) => {
    setOpenAtLogin(next)
    try {
      await window.ipc.invoke("app:setLoginItemSettings", { openAtLogin: next })
    } catch {
      setOpenAtLogin(!next)
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium">Start Rowboat when you log in</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          Keeps Rowboat in your menu bar so meeting notes and notifications work without opening the app
        </div>
      </div>
      <Switch checked={openAtLogin} onCheckedChange={handleToggle} disabled={!loaded} />
    </div>
  )
}

function AppearanceSettings() {
  const { theme, setTheme, chatPanePlacement, setChatPanePlacement, chatPaneSize, setChatPaneSize } = useTheme()

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-medium mb-3">System</h4>
        <LaunchAtLoginSetting />
      </div>
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

const primaryProviders: Array<{ id: LlmProviderFlavor; name: string; description: string; icon: React.ElementType }> = [
  { id: "openai", name: "OpenAI", description: "GPT models", icon: OpenAIIcon },
  { id: "anthropic", name: "Anthropic", description: "Claude models", icon: AnthropicIcon },
  { id: "google", name: "Gemini", description: "Google AI Studio", icon: GoogleIcon },
  { id: "ollama", name: "Ollama (Local)", description: "Run models locally", icon: OllamaIcon },
]

const moreProviders: Array<{ id: LlmProviderFlavor; name: string; description: string; icon: React.ElementType }> = [
  { id: "openrouter", name: "OpenRouter", description: "Multiple models, one key", icon: OpenRouterIcon },
  { id: "aigateway", name: "AI Gateway (Vercel)", description: "Vercel's AI Gateway", icon: VercelIcon },
  { id: "openai-compatible", name: "OpenAI-Compatible", description: "Custom OpenAI-compatible API", icon: GenericApiIcon },
]

const preferredDefaults: Partial<Record<LlmProviderFlavor, string>> = {
  openai: "gpt-5.4",
  anthropic: "claude-opus-4-8",
}

const defaultBaseURLs: Partial<Record<LlmProviderFlavor, string>> = {
  ollama: "http://localhost:11434",
  "openai-compatible": "http://localhost:1234/v1",
  aigateway: "https://ai-gateway.vercel.sh/v1",
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
  // Flavors present in the saved providers map — drives each card's
  // "Connected" indicator, independent of which card is active.
  const [savedProviders, setSavedProviders] = useState<Set<LlmProviderFlavor>>(new Set())
  const [providerConfigs, setProviderConfigs] = useState<Record<LlmProviderFlavor, ProviderModelConfig>>({
    openai: { apiKey: "", baseURL: "", models: [""], knowledgeGraphModel: "", meetingNotesModel: "", liveNoteAgentModel: "", autoPermissionDecisionModel: "" },
    anthropic: { apiKey: "", baseURL: "", models: [""], knowledgeGraphModel: "", meetingNotesModel: "", liveNoteAgentModel: "", autoPermissionDecisionModel: "" },
    google: { apiKey: "", baseURL: "", models: [""], knowledgeGraphModel: "", meetingNotesModel: "", liveNoteAgentModel: "", autoPermissionDecisionModel: "" },
    openrouter: { apiKey: "", baseURL: "", models: [""], knowledgeGraphModel: "", meetingNotesModel: "", liveNoteAgentModel: "", autoPermissionDecisionModel: "" },
    aigateway: { apiKey: "", baseURL: "https://ai-gateway.vercel.sh/v1", models: [""], knowledgeGraphModel: "", meetingNotesModel: "", liveNoteAgentModel: "", autoPermissionDecisionModel: "" },
    ollama: { apiKey: "", baseURL: "http://localhost:11434", models: [""], knowledgeGraphModel: "", meetingNotesModel: "", liveNoteAgentModel: "", autoPermissionDecisionModel: "" },
    "openai-compatible": { apiKey: "", baseURL: "http://localhost:1234/v1", models: [""], knowledgeGraphModel: "", meetingNotesModel: "", liveNoteAgentModel: "", autoPermissionDecisionModel: "" },
  })
  const [testState, setTestState] = useState<{ status: "idle" | "testing" | "success" | "error"; error?: string }>({ status: "idle" })
  const [configLoading, setConfigLoading] = useState(true)
  const [showMoreProviders, setShowMoreProviders] = useState(false)
  // "Defer background tasks while a chat is running" — a top-level
  // models.json flag. deferExplicit tracks whether the user (or the Ollama
  // auto-enable) has ever set it, so we only auto-enable once.
  const [deferBackgroundTasks, setDeferBackgroundTasks] = useState(false)
  const [deferExplicit, setDeferExplicit] = useState(false)
  // openai-compatible only: free-text model that takes precedence over the
  // fetched list (many such servers don't implement /models at all).
  const [customModel, setCustomModel] = useState("")

  const activeConfig = providerConfigs[provider]
  // Live per-key model list for the active provider — drives the primary
  // model area. The per-function fields below still use the static catalog.
  const providerModels = useProviderModels({
    flavor: provider,
    apiKey: activeConfig.apiKey,
    baseURL: activeConfig.baseURL,
  })
  // "Sign in with ChatGPT" subscription state — only rendered on the OpenAI
  // card; independent of the API-key providerConfigs state above.
  const chatgpt = useChatGPT()
  const showApiKey = provider === "openai" || provider === "anthropic" || provider === "google" || provider === "openrouter" || provider === "aigateway" || provider === "openai-compatible"
  const requiresApiKey = provider === "openai" || provider === "anthropic" || provider === "google" || provider === "openrouter" || provider === "aigateway"
  const showBaseURL = provider === "ollama" || provider === "openai-compatible" || provider === "aigateway"
  const requiresBaseURL = provider === "ollama" || provider === "openai-compatible"
  const isLocalProvider = provider === "ollama" || provider === "openai-compatible"
  const isMoreProvider = moreProviders.some(p => p.id === provider)

  const primaryModel = activeConfig.models[0] || ""
  // Settings no longer exposes model selection — the model is resolved
  // silently when the user connects (the config schema still requires one;
  // background agents/channels read it). Precedence: a typed escape-hatch
  // value (openai-compatible Model field, offline manual input) > the saved
  // model when the fetched list still has it > the flavor's preferred
  // default > the first fetched id.
  const resolvedModel = (() => {
    if (provider === "openai-compatible" && customModel.trim()) return customModel.trim()
    const saved = primaryModel.trim()
    if (providerModels.status === "loaded" && providerModels.models.length > 0) {
      if (saved && providerModels.models.includes(saved)) return saved
      const preferred = preferredDefaults[provider]
      if (preferred && providerModels.models.includes(preferred)) return preferred
      return providerModels.models[0]
    }
    return saved
  })()
  // Gate Connect on credentials only, NOT on resolvedModel — that derives
  // from the live fetch, which hasn't settled the instant a key is pasted, so
  // gating on it made the first click a no-op (the model is resolved, fetching
  // on demand if needed, inside handleTestAndSave).
  const canTest =
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

  // All primary-model writes go through here: the old `models: [value]` form
  // silently dropped every saved model after the first.
  const setPrimaryModel = useCallback((prov: LlmProviderFlavor, value: string) => {
    setProviderConfigs(prev => {
      const existing = prev[prov].models
      return {
        ...prev,
        [prov]: { ...prev[prov], models: [value, ...existing.slice(1).filter(m => m && m !== value)] },
      }
    })
    setTestState({ status: "idle" })
  }, [])


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
        const knownFlavors = new Set<string>([...primaryProviders, ...moreProviders].map(p => p.id))
        setSavedProviders(new Set(
          Object.keys(parsed?.providers ?? {}).filter((k): k is LlmProviderFlavor => knownFlavors.has(k))
        ))
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

  // A saved openai-compatible model that the server's list doesn't confirm
  // (not listed, or /models unreachable) belongs in the visible Model field,
  // where it stays editable and wins over the silent pick.
  useEffect(() => {
    if (provider !== "openai-compatible" || customModel || !primaryModel) return
    if (providerModels.status === "error" || (providerModels.status === "loaded" && !providerModels.models.includes(primaryModel))) {
      setCustomModel(primaryModel)
    }
  }, [provider, providerModels.status, providerModels.models, primaryModel, customModel])

  const handleTestAndSave = useCallback(async () => {
    if (!canTest) return
    setTestState({ status: "testing" })
    try {
      // Normally providerModels has loaded by click time and resolvedModel is
      // set. But a Connect click right after pasting a key can beat the
      // debounced key-change fetch — so when nothing is resolved yet, fetch
      // the list on demand (one fetch, then save) instead of forcing a second
      // click. Same silent precedence as resolvedModel, minus the customModel
      // branch (that path only runs when resolvedModel is already empty).
      let model = resolvedModel
      if (!model) {
        const listRes = await window.ipc.invoke("models:listForProvider", {
          provider: {
            flavor: provider,
            apiKey: activeConfig.apiKey.trim() || undefined,
            baseURL: activeConfig.baseURL.trim() || undefined,
          },
        })
        if (listRes.success && listRes.models && listRes.models.length > 0) {
          const preferred = preferredDefaults[provider]
          model = preferred && listRes.models.includes(preferred) ? preferred : listRes.models[0]
        }
      }
      if (!model) {
        setTestState({ status: "error", error: "Enter a model to connect" })
        toast.error("Enter a model to connect")
        return
      }
      // The silently resolved model takes the primary slot; the rest of the
      // saved list is preserved (same semantics setPrimaryModel had).
      const existing = activeConfig.models.map(m => m.trim())
      const allModels = [model, ...existing.slice(1).filter(m => m && m !== model)]
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
        setProviderConfigs(prev => ({
          ...prev,
          [provider]: { ...prev[provider], models: allModels },
        }))
        setSavedProviders(prev => new Set(prev).add(provider))
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
  }, [canTest, resolvedModel, provider, activeConfig, rowboatConnected, deferExplicit, deferBackgroundTasks, handleDeferToggle])

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
    const isDefaultProv = defaultProvider === prov
    try {
      const result = await window.ipc.invoke("workspace:readFile", { path: "config/models.json" })
      let parsed = JSON.parse(result.data)

      // Disconnecting the default provider: silently promote another
      // connected provider first — the connect-only UI has no usable
      // set-as-default step to send the user to. Prefer the provider the
      // user's explicit defaultSelection points at; promotion goes through
      // the same models:saveConfig path Set-as-default uses, so the repo
      // writes a valid top-level provider/model.
      let promoted: LlmProviderFlavor | null = null
      if (isDefaultProv) {
        const selProvider = parsed?.defaultSelection?.provider
        const candidates = Object.keys(parsed?.providers ?? {})
          .filter((k): k is LlmProviderFlavor => k !== prov && k in providerConfigs)
          .sort((a, b) => (a === selProvider ? -1 : b === selProvider ? 1 : 0))
        for (const candidate of candidates) {
          const config = providerConfigs[candidate]
          const allModels = config.models.map(m => m.trim()).filter(Boolean)
          // Same silent precedence as connect, minus the live list we don't
          // have here: the provider's saved model, else its preferred default.
          const model = allModels[0] || preferredDefaults[candidate] || ""
          if (!model) continue
          await window.ipc.invoke("models:saveConfig", {
            provider: {
              flavor: candidate,
              apiKey: config.apiKey.trim() || undefined,
              baseURL: config.baseURL.trim() || undefined,
            },
            model,
            models: allModels.length > 0 ? allModels : [model],
            ...(rowboatConnected ? {} : {
              knowledgeGraphModel: config.knowledgeGraphModel.trim() || undefined,
              meetingNotesModel: config.meetingNotesModel.trim() || undefined,
              liveNoteAgentModel: config.liveNoteAgentModel.trim() || undefined,
              autoPermissionDecisionModel: config.autoPermissionDecisionModel.trim() || undefined,
            }),
          })
          promoted = candidate
          break
        }
        if (promoted) {
          // saveConfig rewrote top-level and the providers map — re-read so
          // the deletion write below doesn't clobber the promotion.
          const fresh = await window.ipc.invoke("workspace:readFile", { path: "config/models.json" })
          parsed = JSON.parse(fresh.data)
        }
      }

      if (parsed?.providers?.[prov]) {
        delete parsed.providers[prov]
      }
      // A defaultSelection pointing at the removed provider is dangling —
      // drop it so llm:getDefaultModel falls back cleanly.
      if (parsed?.defaultSelection?.provider === prov) {
        delete parsed.defaultSelection
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
      } else if (parsed?.provider?.flavor === prov) {
        // Removing the last connected provider: drop the top-level pair
        // entirely. The schema requires it, so core's readConfig() treats
        // the file as "no config" — signed-in falls back to the curated
        // gateway default and signed-out llm:getDefaultModel rejects, which
        // the composer already handles (it shows the connect hint).
        delete parsed.provider
        delete parsed.model
        delete parsed.models
        delete parsed.knowledgeGraphModel
        delete parsed.meetingNotesModel
        delete parsed.liveNoteAgentModel
        delete parsed.autoPermissionDecisionModel
        // With no BYOK providers left, any non-gateway selection is dangling.
        if (parsed?.defaultSelection && parsed.defaultSelection.provider !== "rowboat"
          && Object.keys(parsed?.providers ?? {}).length === 0) {
          delete parsed.defaultSelection
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
      setSavedProviders(prev => {
        const next = new Set(prev)
        next.delete(prov)
        return next
      })
      if (isDefaultProv) setDefaultProvider(promoted)
      setTestState({ status: "idle" })
      window.dispatchEvent(new Event('models-config-changed'))
      if (promoted) {
        const promotedName = [...primaryProviders, ...moreProviders].find(p => p.id === promoted)?.name || promoted
        toast.success(`Disconnected · ${promotedName} is now the default`)
      } else {
        toast.success("Provider configuration removed")
      }
    } catch {
      toast.error("Failed to remove provider")
    }
  }, [defaultProvider, providerConfigs, rowboatConnected])

  const renderProviderCard = (p: { id: LlmProviderFlavor; name: string; description: string; icon: React.ElementType }) => {
    const isDefault = defaultProvider === p.id
    const isSelected = provider === p.id
    const isConnected = savedProviders.has(p.id)
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
        <div className="flex items-center gap-2">
          <p.icon className="size-4 shrink-0" />
          <span className="text-sm font-medium">{p.name}</span>
          {isDefault && !rowboatConnected && (
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-primary">
              Default
            </span>
          )}
          {isConnected && (
            <span className="rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-green-600">
              Connected
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

      {/* API Key — key-first: the model list is fetched from it */}
      {showApiKey && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {provider === "openai-compatible" ? "API Key (optional)" : "API Key"}
          </span>
          <Input
            type="password"
            value={activeConfig.apiKey}
            onChange={(e) => updateConfig(provider, { apiKey: e.target.value })}
            onBlur={() => providerModels.refetch()}
            placeholder="Paste your API key"
          />
        </div>
      )}

      {/* ChatGPT subscription — OAuth sign-in, independent of the API key and
          of models.json (the Codex model client consumes the token via core) */}
      {provider === "openai" && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            ChatGPT Subscription
          </span>
          {chatgpt.status.signedIn ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-sm text-green-600 min-w-0">
                <CheckCircle2 className="size-4 shrink-0" />
                <span className="truncate">
                  Connected as {chatgpt.status.email ?? "your ChatGPT account"}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={chatgpt.signOut}
              >
                Sign Out
              </Button>
            </div>
          ) : chatgpt.isSigningIn ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Waiting for browser…
              </div>
              <Button variant="outline" size="sm" className="shrink-0" onClick={chatgpt.cancelSignIn}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">
                Use your ChatGPT Plus/Pro subscription
              </span>
              <Button variant="outline" size="sm" className="shrink-0" onClick={chatgpt.signIn}>
                Sign In
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Base URL */}
      {showBaseURL && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Base URL</span>
          <Input
            value={activeConfig.baseURL}
            onChange={(e) => updateConfig(provider, { baseURL: e.target.value })}
            onBlur={() => providerModels.refetch()}
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

      {/* Connection status — the model itself is resolved silently on save */}
      <div className="space-y-2">
        {providerModels.status === "idle" ? (
          <div className="text-sm text-muted-foreground">
            {isLocalProvider
              ? "Enter your base URL to connect"
              : "Enter your API key to connect"}
          </div>
        ) : providerModels.status === "loading" ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Checking connection…
          </div>
        ) : providerModels.status === "error" ? (
          <div className="space-y-2">
            <div className="text-xs text-destructive break-words">
              {providerModels.error || "Connection check failed"}
            </div>
            <Button variant="outline" size="sm" onClick={() => providerModels.refetch()}>
              Retry
            </Button>
            {provider !== "openai-compatible" && (
              <Input
                value={primaryModel}
                onChange={(e) => setPrimaryModel(provider, e.target.value)}
                placeholder="Enter a model to connect anyway"
              />
            )}
          </div>
        ) : providerModels.models.length === 0 && provider !== "openai-compatible" ? (
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">
              Connected, but the provider reported no models — enter one manually
            </div>
            <Input
              value={primaryModel}
              onChange={(e) => setPrimaryModel(provider, e.target.value)}
              placeholder="Enter model"
            />
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-sm text-green-600">
            <CheckCircle2 className="size-4" />
            Connected · {providerModels.models.length} model{providerModels.models.length === 1 ? "" : "s"} available
          </div>
        )}
        {savedProviders.has(provider) && (
          <Button
            variant="outline"
            size="sm"
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => handleDeleteProvider(provider)}
          >
            Disconnect
          </Button>
        )}
      </div>

      {/* openai-compatible escape hatch: its /models often doesn't exist, and
          a typed model always wins over the silent pick */}
      {provider === "openai-compatible" && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Model</span>
          <Input
            value={customModel}
            onChange={(e) => {
              setCustomModel(e.target.value)
              setPrimaryModel(provider, e.target.value)
            }}
            placeholder="Model ID (leave empty to auto-select)"
          />
        </div>
      )}

      {/* Per-function model overrides. Persisted as bare model-id strings
          inside providers[flavor] ('' = "Same as assistant"), so the
          ModelRef picker value is adapted at this boundary: string ↔
          {provider, model} with the active card's flavor. allowCustom keeps
          arbitrary ids typeable (local servers, unlisted models). */}
      <div className="grid grid-cols-2 gap-3">
        {!rowboatConnected && (<>
          {(
            [
              { label: "Knowledge graph model", field: "knowledgeGraphModel" },
              { label: "Meeting notes model", field: "meetingNotesModel" },
              { label: "Track block model", field: "liveNoteAgentModel" },
              { label: "Auto-permission model", field: "autoPermissionDecisionModel" },
            ] as const
          ).map(({ label, field }) => (
            <div key={field} className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
              <ModelSelector
                variant="field"
                providerFilter={provider}
                allowCustom
                defaultOption={{ label: "Same as assistant" }}
                value={activeConfig[field] ? { provider, model: activeConfig[field] } : null}
                onChange={(ref) => updateConfig(provider, { [field]: ref ? ref.model : "" })}
              />
            </div>
          ))}
        </>)}
      </div>

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
          <><Loader2 className="size-4 animate-spin mr-2" />Connecting...</>
        ) : (
          "Connect"
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
// Hybrid mode: every picker lists the gateway catalog PLUS any BYOK
// providers configured below (ModelSelector renders the shared store's
// groups, live-fetching list-less providers inside the open dropdown).
// Saved via models:updateConfig as {provider, model} refs, so a signed-in
// user can e.g. keep the gateway assistant while running background agents
// on a local Ollama model. Selections stay local until Save — unlike the
// composer, picking here must not write anything by itself.

function RowboatModelSettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [selectedDefault, setSelectedDefault] = useState<ModelRef | null>(null)
  const [selectedKg, setSelectedKg] = useState<ModelRef | null>(null)
  const [selectedLiveNote, setSelectedLiveNote] = useState<ModelRef | null>(null)
  const [selectedAutoPermission, setSelectedAutoPermission] = useState<ModelRef | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!dialogOpen) return

    async function load() {
      setLoading(true)
      try {
        let parsed: Record<string, unknown> = {}
        try {
          const configResult = await window.ipc.invoke("workspace:readFile", { path: "config/models.json" })
          parsed = JSON.parse(configResult.data)
        } catch { /* no config yet */ }

        // Current selections. Legacy string overrides pair with the BYOK
        // top-level flavor (mirrors core/models/defaults.ts).
        const legacyFlavor = (parsed.provider as Record<string, unknown> | undefined)?.flavor
        const toRef = (value: unknown): ModelRef | null => {
          if (!value) return null
          if (typeof value === "string") {
            return typeof legacyFlavor === "string" ? { provider: legacyFlavor, model: value } : null
          }
          const ref = value as { provider?: unknown; model?: unknown }
          return typeof ref.provider === "string" && typeof ref.model === "string"
            ? { provider: ref.provider, model: ref.model }
            : null
        }
        setSelectedDefault(toRef(parsed.defaultSelection))
        setSelectedKg(toRef(parsed.knowledgeGraphModel))
        setSelectedLiveNote(toRef(parsed.liveNoteAgentModel))
        setSelectedAutoPermission(toRef(parsed.autoPermissionDecisionModel))
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
      await window.ipc.invoke("models:updateConfig", {
        defaultSelection: selectedDefault,
        knowledgeGraphModel: selectedKg,
        liveNoteAgentModel: selectedLiveNote,
        autoPermissionDecisionModel: selectedAutoPermission,
      })
      window.dispatchEvent(new Event("models-config-changed"))
      toast.success("Model configuration saved")
    } catch {
      toast.error("Failed to save model configuration")
    } finally {
      setSaving(false)
    }
  }, [selectedDefault, selectedKg, selectedLiveNote, selectedAutoPermission])

  const renderModelField = (
    label: string,
    value: ModelRef | null,
    onChange: (v: ModelRef | null) => void,
  ) => (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <ModelSelector
        variant="field"
        value={value}
        onChange={onChange}
        defaultOption={{ label: "Rowboat default" }}
      />
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

      {renderModelField("Assistant model", selectedDefault, setSelectedDefault)}
      {renderModelField("Knowledge graph model", selectedKg, setSelectedKg)}
      {renderModelField("Background agents model", selectedLiveNote, setSelectedLiveNote)}
      {renderModelField("Permission checks model", selectedAutoPermission, setSelectedAutoPermission)}

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
      {agent === 'claude' ? (
        <AnthropicIcon className="size-5 shrink-0" />
      ) : (
        <OpenAIIcon className="size-5 shrink-0" />
      )}
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

type NotificationCategoryKey = "chat_completion" | "new_email" | "agent_permission" | "background_task" | "meeting_detection" | "meeting_notes_ready"

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
  {
    key: "meeting_detection",
    label: "Meeting detection",
    description: "A popup offering to take notes when Rowboat notices you're in a call or meeting. Nothing records until you accept.",
  },
  {
    key: "meeting_notes_ready",
    label: "Meeting notes ready",
    description: "When your meeting notes finish generating after a call. Click to open the note. Only shown while the app is in the background.",
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

// --- Advanced (runtime/cost controls) tab ---

const MODEL_CALL_LIMIT_MIN = 1
const MODEL_CALL_LIMIT_MAX = 500

function parseLimit(value: string): number | null {
  const n = Number(value.trim())
  if (!Number.isInteger(n) || n < MODEL_CALL_LIMIT_MIN || n > MODEL_CALL_LIMIT_MAX) return null
  return n
}

/**
 * Compact segmented − / value / + stepper. The native number-input spinners
 * are replaced entirely: typing is free-form digits, stepping clamps to the
 * range and commits immediately. An empty value steps from `fallback` (the
 * chat field starts from the global limit).
 */
function LimitStepper({
  value,
  fallback,
  placeholder,
  onInput,
  onCommit,
}: {
  value: string
  fallback: number
  placeholder?: string
  /** Every keystroke (no save). */
  onInput: (next: string) => void
  /** A settled change: step click or blur. */
  onCommit: (next: string) => void
}) {
  const current = parseLimit(value)

  const step = (delta: number) => {
    // From an empty/invalid field, the first step lands on the fallback so
    // the override starts where the effective value already is.
    const next = current === null
      ? Math.min(MODEL_CALL_LIMIT_MAX, Math.max(MODEL_CALL_LIMIT_MIN, fallback))
      : Math.min(MODEL_CALL_LIMIT_MAX, Math.max(MODEL_CALL_LIMIT_MIN, current + delta))
    onCommit(String(next))
  }

  return (
    <div className="flex h-8 items-center overflow-hidden rounded-md border border-input bg-background shadow-xs shrink-0">
      <button
        type="button"
        aria-label="Decrease limit"
        onClick={() => step(-1)}
        disabled={current !== null && current <= MODEL_CALL_LIMIT_MIN}
        className="flex h-full w-7 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
      >
        <Minus className="size-3" />
      </button>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onInput(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={() => onCommit(value)}
        className={cn(
          "h-full border-x border-input bg-transparent text-center text-sm tabular-nums outline-none",
          // The 11px placeholder sits on the 14px text baseline, so it reads
          // slightly low; nudge it up for optical centering. Only applies
          // while the placeholder is visible, so typed text is unaffected.
          "placeholder:text-[11px] placeholder:text-muted-foreground/70 placeholder-shown:pb-1",
          placeholder ? "w-24" : "w-16",
        )}
      />
      <button
        type="button"
        aria-label="Increase limit"
        onClick={() => step(1)}
        disabled={current !== null && current >= MODEL_CALL_LIMIT_MAX}
        className="flex h-full w-7 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
      >
        <Plus className="size-3" />
      </button>
    </div>
  )
}

function AdvancedSettings({ dialogOpen }: { dialogOpen: boolean }) {
  // Inputs are kept as strings so the user can clear a field while typing;
  // validation happens on commit (step click or blur).
  const [globalLimit, setGlobalLimit] = useState("")
  const [chatLimit, setChatLimit] = useState("")
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!dialogOpen) return
    let cancelled = false
    window.ipc.invoke("turnLimits:getSettings", null)
      .then((settings) => {
        if (cancelled) return
        setGlobalLimit(String(settings.maxModelCalls))
        // A chat override equal to the global limit is no override — show
        // "Same as above" (legacy files; saves already collapse this).
        setChatLimit(
          settings.chatMaxModelCalls !== undefined && settings.chatMaxModelCalls !== settings.maxModelCalls
            ? String(settings.chatMaxModelCalls)
            : ""
        )
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) toast.error("Failed to load advanced settings")
      })
    return () => { cancelled = true }
  }, [dialogOpen])

  // Saves silently on success (a toast per stepper click would be noisy,
  // matching the notification toggles); errors still surface.
  const saveLimits = useCallback(async (globalStr: string, chatStr: string) => {
    const global = parseLimit(globalStr)
    if (global === null) {
      toast.error(`Model-call limit must be a whole number between ${MODEL_CALL_LIMIT_MIN} and ${MODEL_CALL_LIMIT_MAX}`)
      return
    }
    let chat: number | undefined
    if (chatStr.trim() !== "") {
      const parsed = parseLimit(chatStr)
      if (parsed === null) {
        toast.error(`Chat limit must be empty or a whole number between ${MODEL_CALL_LIMIT_MIN} and ${MODEL_CALL_LIMIT_MAX}`)
        return
      }
      chat = parsed
    }
    // An override equal to the global limit is meaningless — persist it as
    // "use the global limit" so the field reopens as "Same as above".
    if (chat === global) chat = undefined
    try {
      await window.ipc.invoke("turnLimits:setSettings", {
        maxModelCalls: global,
        ...(chat === undefined ? {} : { chatMaxModelCalls: chat }),
      })
    } catch {
      toast.error("Failed to save model-call limits")
    }
  }, [])

  if (!loaded) {
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
        Runtime cost and safety controls. A turn is stopped once it reaches its model-call limit;
        changes apply to newly started turns only.
      </div>

      <div className="space-y-2">
        <div className="rounded-md border px-3 py-3 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">Model-call limit</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Maximum model calls per turn. Applies to everything by default — background and
              knowledge work, scheduled agents, and sub-agents (it also caps sub-agent budgets).
            </div>
          </div>
          <LimitStepper
            value={globalLimit}
            fallback={DEFAULT_TURN_LIMITS_SETTINGS.maxModelCalls}
            onInput={setGlobalLimit}
            onCommit={(next) => {
              setGlobalLimit(next)
              void saveLimits(next, chatLimit)
            }}
          />
        </div>

        <div className="rounded-md border px-3 py-3 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">Chat model-call limit</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Optional separate limit for interactive chat turns. Leave empty to use the
              model-call limit above.
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {chatLimit.trim() !== "" && (
              <button
                type="button"
                aria-label="Use the global limit"
                title="Use the global limit"
                onClick={() => {
                  setChatLimit("")
                  void saveLimits(globalLimit, "")
                }}
                className="flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
            <LimitStepper
              value={chatLimit}
              fallback={parseLimit(globalLimit) ?? DEFAULT_TURN_LIMITS_SETTINGS.maxModelCalls}
              placeholder="Same as above"
              onInput={setChatLimit}
              onCommit={(next) => {
                setChatLimit(next)
                // An emptied chat field on blur means "use the global
                // limit" — persist the override removal.
                void saveLimits(globalLimit, next)
              }}
            />
          </div>
        </div>
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
    if (open) {
      setActiveTab(defaultTab)
      analytics.settingsOpened(defaultTab)
    }
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
    if (tab === "appearance" || tab === "models" || tab === "note-tagging" || tab === "account" || tab === "connections" || tab === "help" || tab === "code-mode" || tab === "notifications" || tab === "advanced") return
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
    analytics.settingsTabChanged(tab)
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
            <div className="px-2 pt-3.5 pb-3 mb-2">
              <h2 className="font-semibold text-base tracking-tight">Settings</h2>
            </div>
            <nav className="flex flex-col">
              {NAV_SECTIONS.map((section) => {
                const sectionTabs = visibleTabs.filter((tab) => section.ids.includes(tab.id))
                if (sectionTabs.length === 0) return null
                return (
                  <div key={section.label ?? "main"} className="flex flex-col gap-0.5">
                    {section.label ? (
                      <div className="px-2 pb-1 pt-4 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                        {section.label}
                      </div>
                    ) : null}
                    {sectionTabs.map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => handleTabChange(tab.id)}
                        className={cn(
                          "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left",
                          activeTab === tab.id
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                        )}
                      >
                        <tab.icon className="size-4" />
                        {tab.label}
                      </button>
                    ))}
                  </div>
                )
              })}
            </nav>
          </div>

          {/* Main content */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {/* Header */}
            <div className="px-6 pb-4 pt-5">
              <h3 className="text-lg font-semibold tracking-tight">{activeTabConfig.label}</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {activeTab === "models" && rowboatConnected
                  ? "Select your default models"
                  : activeTabConfig.description}
              </p>
            </div>

            {/* Content */}
            <div className={cn("flex-1 px-6 pb-5 min-h-0", (activeTab === "models" || activeTab === "connections" || activeTab === "mobile" || activeTab === "account" || activeTab === "code-mode" || activeTab === "notifications" || activeTab === "advanced") ? "overflow-y-auto" : activeTab === "note-tagging" ? "overflow-hidden flex flex-col" : "overflow-hidden")}>
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
              ) : activeTab === "advanced" ? (
                <AdvancedSettings dialogOpen={open} />
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
