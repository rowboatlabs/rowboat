"use client"

import * as React from "react"
import { useState, useEffect, useCallback, useMemo } from "react"
import { Server, Key, Shield, Palette, Monitor, Sun, Moon, Loader2, CheckCircle2, Plus, X, Wrench, Search, ChevronRight, Link2, Tags, Mail, BookOpen, User, Plug } from "lucide-react"

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
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { useTheme } from "@/contexts/theme-context"
import { toast } from "sonner"
import { ConnectedAccountsSettings } from "@/components/settings/connected-accounts-settings"

type ConfigTab = "connected-accounts" | "models" | "mcp" | "security" | "appearance" | "tools" | "note-tagging"

interface TabConfig {
  id: ConfigTab
  label: string
  icon: React.ElementType
  path?: string
  description: string
}

const tabs: TabConfig[] = [
  {
    id: "connected-accounts",
    label: "Connected Accounts",
    icon: Plug,
    description: "Manage connected services",
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
    id: "appearance",
    label: "Appearance",
    icon: Palette,
    description: "Customize the look and feel",
  },
  {
    id: "tools",
    label: "Tools Library",
    icon: Wrench,
    description: "Browse and enable toolkits",
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

// --- Model Settings UI (Ollama Cloud only) ---

const OLLAMA_MODELS = [
  { id: "glm-4.1-flash:cloud", name: "GLM 4.1 Flash" },
  { id: "glm-5.1:cloud", name: "GLM 5.1" },
  { id: "kimi-k2.6:cloud", name: "Kimi K2.6" },
  { id: "deepseek-v4-flash:cloud", name: "DeepSeek V4 Flash" },
]

function ModelSettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [selectedModel, setSelectedModel] = useState("glm-5.1:cloud")
  const [selectedKgModel, setSelectedKgModel] = useState("")
  const [selectedMeetingNotesModel, setSelectedMeetingNotesModel] = useState("")
  const [selectedTrackBlockModel, setSelectedTrackBlockModel] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [testState, setTestState] = useState<{ status: "idle" | "testing" | "success" | "error"; error?: string }>({ status: "idle" })
  const [configLoading, setConfigLoading] = useState(true)

  // Load current config from file
  useEffect(() => {
    if (!dialogOpen) return

    async function loadCurrentConfig() {
      try {
        setConfigLoading(true)
        const result = await window.ipc.invoke("workspace:readFile", { path: "config/models.json" })
        const parsed = JSON.parse(result.data)
        if (parsed?.model) setSelectedModel(parsed.model)
        if (parsed?.knowledgeGraphModel) setSelectedKgModel(parsed.knowledgeGraphModel)
        if (parsed?.meetingNotesModel) setSelectedMeetingNotesModel(parsed.meetingNotesModel)
        if (parsed?.trackBlockModel) setSelectedTrackBlockModel(parsed.trackBlockModel)
        if (parsed?.provider?.apiKey) setApiKey(parsed.provider.apiKey)
      } catch {
        // No config yet — use defaults
      } finally {
        setConfigLoading(false)
      }
    }

    loadCurrentConfig()
  }, [dialogOpen])

  const handleTestAndSave = useCallback(async () => {
    setTestState({ status: "testing" })
    try {
      const providerConfig = {
        provider: {
          flavor: "ollama" as const,
          apiKey: apiKey.trim() || undefined,
          baseURL: "https://ollama.com",
        },
        model: selectedModel,
        knowledgeGraphModel: selectedKgModel || undefined,
        meetingNotesModel: selectedMeetingNotesModel || undefined,
        trackBlockModel: selectedTrackBlockModel || undefined,
      }
      const result = await window.ipc.invoke("models:test", providerConfig)
      if (result.success) {
        await window.ipc.invoke("models:saveConfig", providerConfig)
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
  }, [selectedModel, selectedKgModel, selectedMeetingNotesModel, selectedTrackBlockModel, apiKey])

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
      {/* Provider info */}
      <div className="rounded-lg border bg-muted/30 p-3">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-md bg-purple-500/10 flex items-center justify-center text-purple-600 text-sm font-bold">O</div>
          <div>
            <div className="text-sm font-medium">Ollama Cloud</div>
            <div className="text-xs text-muted-foreground">Connected to ollama.com</div>
          </div>
        </div>
      </div>

      {/* API Key */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          API Key
        </label>
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => { setApiKey(e.target.value); setTestState({ status: "idle" }) }}
          placeholder="Your Ollama Cloud API key"
          className="font-mono"
        />
      </div>

      {/* Assistant model */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          Assistant Model
        </label>
        <Select value={selectedModel} onValueChange={(value) => { setSelectedModel(value); setTestState({ status: "idle" }) }}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a model" />
          </SelectTrigger>
          <SelectContent>
            {OLLAMA_MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Knowledge graph model */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          Knowledge Graph Model
        </label>
        <Select value={selectedKgModel || "__same__"} onValueChange={(value) => { setSelectedKgModel(value === "__same__" ? "" : value); setTestState({ status: "idle" }) }}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Same as assistant" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__same__">Same as assistant</SelectItem>
            {OLLAMA_MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Meeting notes model */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          Meeting Notes Model
        </label>
        <Select value={selectedMeetingNotesModel || "__same__"} onValueChange={(value) => { setSelectedMeetingNotesModel(value === "__same__" ? "" : value); setTestState({ status: "idle" }) }}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Same as assistant" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__same__">Same as assistant</SelectItem>
            {OLLAMA_MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Track block model */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          Track Block Model
        </label>
        <Select value={selectedTrackBlockModel || "__same__"} onValueChange={(value) => { setSelectedTrackBlockModel(value === "__same__" ? "" : value); setTestState({ status: "idle" }) }}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Same as assistant" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__same__">Same as assistant</SelectItem>
            {OLLAMA_MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Test & Save */}
      <div className="flex items-center justify-between pt-2">
        {testState.status === "success" && (
          <div className="flex items-center gap-1.5 text-sm text-green-600">
            <CheckCircle2 className="size-4" />
            Connected
          </div>
        )}
        {testState.status === "error" && (
          <span className="text-sm text-destructive max-w-[250px] truncate">
            {testState.error}
          </span>
        )}
        <Button onClick={handleTestAndSave} disabled={testState.status === "testing"} className="min-w-[140px]">
          {testState.status === "testing" ? (
            <><Loader2 className="size-4 animate-spin mr-2" />Testing...</>
          ) : (
            "Test & Save"
          )}
        </Button>
      </div>
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

// --- Tools Library Settings ---

interface ToolkitInfo {
  slug: string
  name: string
  meta: { description: string; logo: string; tools_count: number; triggers_count: number }
  no_auth?: boolean
  auth_schemes?: string[]
  composio_managed_auth_schemes?: string[]
}

function ToolsLibrarySettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState("")
  const [apiKeySaving, setApiKeySaving] = useState(false)
  const [showApiKeyInput, setShowApiKeyInput] = useState(false)
  const [toolkits, setToolkits] = useState<ToolkitInfo[]>([])
  const [toolkitsLoading, setToolkitsLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [connectedToolkits, setConnectedToolkits] = useState<Set<string>>(new Set())
  const [connectingToolkit, setConnectingToolkit] = useState<string | null>(null)

  const checkApiKey = useCallback(async () => {
    try {
      const result = await window.ipc.invoke("composio:is-configured", null)
      setApiKeyConfigured(result.configured)
      if (!result.configured) setShowApiKeyInput(true)
    } catch {
      setApiKeyConfigured(false)
    }
  }, [])

  const loadConnected = useCallback(async () => {
    try {
      const result = await window.ipc.invoke("composio:list-connected", null)
      setConnectedToolkits(new Set(result.toolkits))
    } catch {
      // ignore
    }
  }, [])

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

  useEffect(() => {
    if (!dialogOpen) return
    checkApiKey()
    loadConnected()
  }, [dialogOpen, checkApiKey, loadConnected])

  useEffect(() => {
    if (dialogOpen && apiKeyConfigured) loadToolkits()
  }, [dialogOpen, apiKeyConfigured, loadToolkits])

  useEffect(() => {
    const cleanup = window.ipc.on('composio:didConnect', (event: { toolkitSlug: string; success: boolean; error?: string }) => {
      setConnectingToolkit(null)
      if (event.success) {
        setConnectedToolkits(prev => new Set([...prev, event.toolkitSlug]))
        toast.success(`Connected to ${event.toolkitSlug}`)
      } else {
        toast.error(event.error || `Failed to connect to ${event.toolkitSlug}`)
      }
    })
    return cleanup
  }, [])

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

  const handleConnect = async (toolkitSlug: string) => {
    setConnectingToolkit(toolkitSlug)
    try {
      const result = await window.ipc.invoke("composio:initiate-connection", { toolkitSlug })
      if (!result.success) {
        toast.error(result.error || "Failed to connect")
        setConnectingToolkit(null)
      }
    } catch {
      toast.error("Failed to connect")
      setConnectingToolkit(null)
    }
  }

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

  const filteredToolkits = searchQuery.trim()
    ? toolkits.filter(t =>
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.meta.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : toolkits

  return (
    <div className="space-y-4">
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
              <a href="https://app.composio.dev/settings" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
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
              <Button onClick={handleSaveApiKey} disabled={!apiKeyInput.trim() || apiKeySaving} size="sm">
                {apiKeySaving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
              </Button>
              {apiKeyConfigured && (
                <Button variant="outline" size="sm" onClick={() => { setShowApiKeyInput(false); setApiKeyInput("") }}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {apiKeyConfigured && (
        <>
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Available Toolkits</span>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search toolkits..." className="pl-8" />
            </div>
          </div>

          {toolkitsLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <Loader2 className="size-4 animate-spin mr-2" />Loading toolkits...
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
              {filteredToolkits.map((toolkit) => {
                const isConnected = connectedToolkits.has(toolkit.slug)
                const isConnecting = connectingToolkit === toolkit.slug
                return (
                  <div key={toolkit.slug} className="border rounded-lg overflow-hidden">
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      {toolkit.meta.logo ? (
                        <img src={toolkit.meta.logo} alt="" className="size-7 rounded object-contain shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      ) : (
                        <div className="size-7 rounded bg-muted flex items-center justify-center shrink-0">
                          <Wrench className="size-3.5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate">{toolkit.name}</span>
                          {isConnected && (
                            <span className="rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-green-600">Connected</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{toolkit.meta.description}</p>
                      </div>
                      {isConnected ? (
                        <Button variant="outline" size="sm" onClick={() => handleDisconnect(toolkit.slug)} className="text-xs h-7 shrink-0">Disconnect</Button>
                      ) : (
                        <Button size="sm" onClick={() => handleConnect(toolkit.slug)} disabled={isConnecting} className="text-xs h-7 shrink-0">
                          {isConnecting ? (<><Loader2 className="size-3 animate-spin mr-1" />Connecting...</>) : (<><Link2 className="size-3 mr-1" />Connect</>)}
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

// --- Main Settings Dialog ---

export function SettingsDialog({ children }: SettingsDialogProps) {
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<ConfigTab>("connected-accounts")
  const [content, setContent] = useState("")
  const [originalContent, setOriginalContent] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    if (tab === "appearance" || tab === "models" || tab === "note-tagging" || tab === "connected-accounts") return
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
                {activeTabConfig.description}
              </p>
            </div>

            {/* Content */}
            <div className={cn("flex-1 p-4 min-h-0", (activeTab === "models" || activeTab === "tools" || activeTab === "connected-accounts") ? "overflow-y-auto" : activeTab === "note-tagging" ? "overflow-hidden flex flex-col" : "overflow-hidden")}>
              {activeTab === "connected-accounts" ? (
                <ConnectedAccountsSettings dialogOpen={open} />
              ) : activeTab === "models" ? (
                <ModelSettings dialogOpen={open} />
              ) : activeTab === "note-tagging" ? (
                <NoteTaggingSettings dialogOpen={open} />
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
