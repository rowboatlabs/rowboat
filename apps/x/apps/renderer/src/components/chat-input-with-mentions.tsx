import { useCallback, useEffect, useRef, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ArrowUp,
  AudioLines,
  ChevronDown,
  FileArchive,
  FileCode2,
  FileIcon,
  FileSpreadsheet,
  FileText,
  FileVideo,
  FolderCheck,
  FolderClock,
  FolderCog,
  FolderOpen,
  Globe,
  Headphones,
  ImagePlus,
  LoaderIcon,
  Mic,
  Plus,
  ShieldCheck,
  Square,
  Terminal,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  type AttachmentIconKind,
  getAttachmentDisplayName,
  getAttachmentIconKind,
  getAttachmentToneClass,
  getAttachmentTypeLabel,
} from '@/lib/attachment-presentation'
import { getExtension, getFileDisplayName, getMimeFromExtension, isImageMime } from '@/lib/file-utils'
import { cn } from '@/lib/utils'
import {
  type FileMention,
  type PromptInputMessage,
  PromptInputProvider,
  PromptInputTextarea,
  usePromptInputController,
} from '@/components/ai-elements/prompt-input'
import { toast } from 'sonner'

export type StagedAttachment = {
  id: string
  path: string
  filename: string
  mimeType: string
  isImage: boolean
  size: number
  thumbnailUrl?: string
}

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_VISIBLE_RECENT_WORK_DIRS = 3
const MAX_STORED_RECENT_WORK_DIRS = 8
// Stored in the workspace (~/.rowboat/config) so it travels with the workspace and
// stays consistent with the other config/*.json files (e.g. coding-agents.json).
const RECENT_WORK_DIRS_CONFIG_PATH = 'config/recent-work-dirs.json'
const RECENT_WORK_DIRS_CHANGED_EVENT = 'rowboat-chat-recent-work-dirs-changed'


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

type ProviderName = "openai" | "anthropic" | "google" | "openrouter" | "aigateway" | "ollama" | "openai-compatible" | "rowboat"

interface ConfiguredModel {
  provider: ProviderName
  model: string
}

type RecentWorkDir = {
  path: string
  lastUsedAt: number
}

export interface SelectedModel {
  provider: string
  model: string
}

export type PermissionMode = 'manual' | 'auto'

function getSelectedModelDisplayName(model: string) {
  return model.split('/').pop() || model
}

function getAttachmentIcon(kind: AttachmentIconKind) {
  switch (kind) {
    case 'audio':
      return AudioLines
    case 'video':
      return FileVideo
    case 'spreadsheet':
      return FileSpreadsheet
    case 'archive':
      return FileArchive
    case 'code':
      return FileCode2
    case 'text':
      return FileText
    default:
      return FileIcon
  }
}

function normalizeRecentWorkDir(value: unknown): RecentWorkDir | null {
  if (typeof value === 'string') {
    const path = value.trim()
    return path ? { path, lastUsedAt: 0 } : null
  }
  if (!value || typeof value !== 'object') return null
  const entry = value as Record<string, unknown>
  const path = typeof entry.path === 'string' ? entry.path.trim() : ''
  const lastUsedAt = typeof entry.lastUsedAt === 'number' && Number.isFinite(entry.lastUsedAt)
    ? entry.lastUsedAt
    : 0
  return path ? { path, lastUsedAt } : null
}

async function readRecentWorkDirs(): Promise<RecentWorkDir[]> {
  try {
    const result = await window.ipc.invoke('workspace:readFile', { path: RECENT_WORK_DIRS_CONFIG_PATH })
    const parsed = JSON.parse(result.data)
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    const dirs: RecentWorkDir[] = []
    for (const value of parsed) {
      const entry = normalizeRecentWorkDir(value)
      if (!entry || seen.has(entry.path)) continue
      seen.add(entry.path)
      dirs.push(entry)
      if (dirs.length >= MAX_STORED_RECENT_WORK_DIRS) break
    }
    return dirs
  } catch {
    // File missing or invalid — no recents yet.
    return []
  }
}

async function writeRecentWorkDirs(dirs: RecentWorkDir[]) {
  try {
    await window.ipc.invoke('workspace:writeFile', {
      path: RECENT_WORK_DIRS_CONFIG_PATH,
      data: JSON.stringify(dirs.slice(0, MAX_STORED_RECENT_WORK_DIRS), null, 2),
    })
  } catch (err) {
    console.error('Failed to persist recent work directories', err)
  }
  // Notify other mounted chat inputs in this window to re-read.
  window.dispatchEvent(new CustomEvent(RECENT_WORK_DIRS_CHANGED_EVENT))
}

function formatRecentWorkDirTime(lastUsedAt: number) {
  if (!lastUsedAt) return ''
  const now = Date.now()
  const diffMs = Math.max(0, now - lastUsedAt)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diffMs < minute) return 'now'
  if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))}m ago`
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`

  const used = new Date(lastUsedAt)
  const yesterday = new Date(now - day)
  if (
    used.getFullYear() === yesterday.getFullYear() &&
    used.getMonth() === yesterday.getMonth() &&
    used.getDate() === yesterday.getDate()
  ) {
    return 'Yesterday'
  }
  if (diffMs < 7 * day) {
    return used.toLocaleDateString(undefined, { weekday: 'short' })
  }
  return used.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function compactWorkDirPath(path: string) {
  return path.replace(/^\/Users\/[^/]+/, '~')
}

interface ChatInputInnerProps {
  onSubmit: (message: PromptInputMessage, mentions?: FileMention[], attachments?: StagedAttachment[], searchEnabled?: boolean, codeMode?: 'claude' | 'codex', permissionMode?: PermissionMode) => void
  onStop?: () => void
  isProcessing: boolean
  isStopping?: boolean
  isActive: boolean
  presetMessage?: string
  onPresetMessageConsumed?: () => void
  runId?: string | null
  initialDraft?: string
  onDraftChange?: (text: string) => void
  isRecording?: boolean
  recordingText?: string
  recordingState?: 'connecting' | 'listening'
  onStartRecording?: () => void
  onSubmitRecording?: () => void
  onCancelRecording?: () => void
  voiceAvailable?: boolean
  ttsAvailable?: boolean
  ttsEnabled?: boolean
  ttsMode?: 'summary' | 'full'
  onToggleTts?: () => void
  onTtsModeChange?: (mode: 'summary' | 'full') => void
  /** Fired when the user picks a different model in the dropdown (only when no run exists yet). */
  onSelectedModelChange?: (model: SelectedModel | null) => void
  /** Work directory for this chat (per-chat). Null when none is set. */
  workDir?: string | null
  /** Fired when the user sets/changes/clears the work directory for this chat. */
  onWorkDirChange?: (value: string | null) => void
}

function ChatInputInner({
  onSubmit,
  onStop,
  isProcessing,
  isStopping,
  isActive,
  presetMessage,
  onPresetMessageConsumed,
  runId,
  initialDraft,
  onDraftChange,
  isRecording,
  recordingText,
  recordingState,
  onStartRecording,
  onSubmitRecording,
  onCancelRecording,
  voiceAvailable,
  ttsAvailable,
  ttsEnabled,
  ttsMode,
  onToggleTts,
  onTtsModeChange,
  onSelectedModelChange,
  workDir = null,
  onWorkDirChange,
}: ChatInputInnerProps) {
  const controller = usePromptInputController()
  const message = controller.textInput.value
  const [attachments, setAttachments] = useState<StagedAttachment[]>([])
  const [focusNonce, setFocusNonce] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canSubmit = (Boolean(message.trim()) || attachments.length > 0) && !isProcessing

  const [configuredModels, setConfiguredModels] = useState<ConfiguredModel[]>([])
  const [activeModelKey, setActiveModelKey] = useState('')
  const [lockedModel, setLockedModel] = useState<SelectedModel | null>(null)
  const [searchEnabled, setSearchEnabled] = useState(false)
  const [searchAvailable, setSearchAvailable] = useState(false)
  const [isRowboatConnected, setIsRowboatConnected] = useState(false)
  const [codingAgent, setCodingAgent] = useState<'claude' | 'codex'>('claude')
  const [codeModeEnabled, setCodeModeEnabled] = useState(false)
  const [codeModeFeatureEnabled, setCodeModeFeatureEnabled] = useState(false)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('auto')
  const [recentWorkDirs, setRecentWorkDirs] = useState<RecentWorkDir[]>([])

  // When a run exists, freeze the dropdown to the run's resolved model+provider.
  useEffect(() => {
    if (!runId) {
      setLockedModel(null)
      setPermissionMode('auto')
      return
    }
    let cancelled = false
    window.ipc.invoke('runs:fetch', { runId }).then((run) => {
      if (cancelled) return
      if (run.provider && run.model) {
        setLockedModel({ provider: run.provider, model: run.model })
      }
      setPermissionMode(run.permissionMode ?? 'manual')
    }).catch(() => { /* legacy run or fetch failure — leave unlocked */ })
    return () => { cancelled = true }
  }, [runId])

  useEffect(() => {
    const syncRecentWorkDirs = () => { void readRecentWorkDirs().then(setRecentWorkDirs) }
    syncRecentWorkDirs()
    window.addEventListener(RECENT_WORK_DIRS_CHANGED_EVENT, syncRecentWorkDirs)
    return () => {
      window.removeEventListener(RECENT_WORK_DIRS_CHANGED_EVENT, syncRecentWorkDirs)
    }
  }, [])

  // Check Rowboat sign-in state
  useEffect(() => {
    window.ipc.invoke('oauth:getState', null).then((result) => {
      setIsRowboatConnected(result.config?.rowboat?.connected ?? false)
    }).catch(() => setIsRowboatConnected(false))
  }, [isActive])

  // Update sign-in state when OAuth events fire
  useEffect(() => {
    const cleanup = window.ipc.on('oauth:didConnect', () => {
      window.ipc.invoke('oauth:getState', null).then((result) => {
        setIsRowboatConnected(result.config?.rowboat?.connected ?? false)
      }).catch(() => setIsRowboatConnected(false))
    })
    return cleanup
  }, [])

  // Load the list of models the user can choose from.
  // Signed-in: gateway model list. Signed-out: providers configured in models.json.
  const loadModelConfig = useCallback(async () => {
    try {
      if (isRowboatConnected) {
        const listResult = await window.ipc.invoke('models:list', null)
        const rowboatProvider = listResult.providers?.find(
          (p: { id: string }) => p.id === 'rowboat'
        )
        const models: ConfiguredModel[] = (rowboatProvider?.models || []).map(
          (m: { id: string }) => ({ provider: 'rowboat', model: m.id })
        )
        setConfiguredModels(models)
      } else {
        const result = await window.ipc.invoke('workspace:readFile', { path: 'config/models.json' })
        const parsed = JSON.parse(result.data)
        const models: ConfiguredModel[] = []
        if (parsed?.providers) {
          for (const [flavor, entry] of Object.entries(parsed.providers)) {
            const e = entry as Record<string, unknown>
            const modelList: string[] = Array.isArray(e.models) ? e.models as string[] : []
            const singleModel = typeof e.model === 'string' ? e.model : ''
            const allModels = modelList.length > 0 ? modelList : singleModel ? [singleModel] : []
            for (const model of allModels) {
              if (model) {
                models.push({ provider: flavor as ProviderName, model })
              }
            }
          }
        }
        setConfiguredModels(models)
      }
    } catch {
      // No config yet
    }
  }, [isRowboatConnected])

  useEffect(() => {
    loadModelConfig()
  }, [isActive, loadModelConfig])

  // Reload when model config changes (e.g. from settings dialog)
  useEffect(() => {
    const handler = () => { loadModelConfig() }
    window.addEventListener('models-config-changed', handler)
    return () => window.removeEventListener('models-config-changed', handler)
  }, [loadModelConfig])

  // Load the global code-mode feature flag (from settings) and stay in sync.
  useEffect(() => {
    const load = () => {
      window.ipc.invoke('codeMode:getConfig', null)
        .then((r) => setCodeModeFeatureEnabled(r.enabled))
        .catch(() => setCodeModeFeatureEnabled(false))
    }
    load()
    window.addEventListener('code-mode-config-changed', load)
    return () => window.removeEventListener('code-mode-config-changed', load)
  }, [])

  // If the feature is turned off in settings, also turn off any per-conversation chip.
  useEffect(() => {
    if (!codeModeFeatureEnabled && codeModeEnabled) {
      setCodeModeEnabled(false)
    }
  }, [codeModeFeatureEnabled, codeModeEnabled])


  // Cross-platform basename — handles both / and \ separators.
  const basename = useCallback((p: string): string => {
    const trimmed = p.replace(/[\\/]+$/, '')
    const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
    return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
  }, [])

  const rememberWorkDir = useCallback(async (dir: string) => {
    const trimmed = dir.trim()
    if (!trimmed) return
    const next = [
      { path: trimmed, lastUsedAt: Date.now() },
      ...(await readRecentWorkDirs()).filter((item) => item.path !== trimmed),
    ].slice(0, MAX_STORED_RECENT_WORK_DIRS)
    setRecentWorkDirs(next)
    await writeRecentWorkDirs(next)
  }, [])

  // Load coding-agent preference for a given workdir.
  // Storage: config/coding-agents.json — { [workDirPath]: 'claude' | 'codex' }
  const loadCodingAgentFor = useCallback(async (dir: string | null): Promise<'claude' | 'codex'> => {
    if (!dir) return 'claude'
    try {
      const result = await window.ipc.invoke('workspace:readFile', { path: 'config/coding-agents.json' })
      const parsed = JSON.parse(result.data) as Record<string, unknown>
      const value = parsed?.[dir]
      if (value === 'codex' || value === 'claude') return value
    } catch {
      /* file missing or invalid — fall through to default */
    }
    return 'claude'
  }, [])

  const persistCodingAgent = useCallback(async (dir: string, agent: 'claude' | 'codex') => {
    const existing: Record<string, 'claude' | 'codex'> = {}
    try {
      const result = await window.ipc.invoke('workspace:readFile', { path: 'config/coding-agents.json' })
      const parsed = JSON.parse(result.data) as Record<string, unknown>
      for (const [k, v] of Object.entries(parsed ?? {})) {
        if (v === 'claude' || v === 'codex') existing[k] = v
      }
    } catch { /* start fresh */ }
    existing[dir] = agent
    await window.ipc.invoke('workspace:writeFile', {
      path: 'config/coding-agents.json',
      data: JSON.stringify(existing, null, 2),
    })
  }, [])

  // Work directory is owned per-chat by the parent (App). This component only
  // drives the picker dialog and reports changes up via onWorkDirChange. Whenever
  // the work directory changes, load its persisted coding-agent preference.
  useEffect(() => {
    let cancelled = false
    loadCodingAgentFor(workDir).then((agent) => {
      if (!cancelled) setCodingAgent(agent)
    })
    return () => { cancelled = true }
  }, [workDir, loadCodingAgentFor])

  useEffect(() => {
    if (isActive && workDir) void rememberWorkDir(workDir)
  }, [isActive, workDir, rememberWorkDir])

  const handleSetWorkDir = useCallback(async () => {
    try {
      let defaultPath: string | undefined = workDir ?? undefined
      try {
        const { root } = await window.ipc.invoke('workspace:getRoot', null)
        const workspaceRel = 'knowledge/Workspace'
        const exists = await window.ipc.invoke('workspace:exists', { path: workspaceRel })
        if (!exists.exists) {
          await window.ipc.invoke('workspace:mkdir', { path: workspaceRel, recursive: true })
        }
        defaultPath = `${root.replace(/\/$/, '')}/${workspaceRel}`
      } catch (err) {
        console.error('Failed to resolve Workspace path; falling back to current workDir', err)
      }
      const { path: chosen } = await window.ipc.invoke('dialog:openDirectory', {
        title: 'Choose work directory',
        defaultPath,
      })
      if (!chosen) return
      onWorkDirChange?.(chosen)
      await rememberWorkDir(chosen)
      setCodingAgent(await loadCodingAgentFor(chosen))
      toast.success(`Work directory set: ${chosen}`)
    } catch (err) {
      console.error('Failed to set work directory', err)
      toast.error('Failed to set work directory')
    }
  }, [workDir, onWorkDirChange, rememberWorkDir, loadCodingAgentFor])

  const handleSelectRecentWorkDir = useCallback(async (dir: string) => {
    onWorkDirChange?.(dir)
    await rememberWorkDir(dir)
    setCodingAgent(await loadCodingAgentFor(dir))
    toast.success(`Work directory set: ${dir}`)
  }, [onWorkDirChange, rememberWorkDir, loadCodingAgentFor])

  const handleClearWorkDir = useCallback(() => {
    onWorkDirChange?.(null)
    setCodingAgent('claude')
    toast.success('Work directory cleared')
  }, [onWorkDirChange])

  const handleToggleCodingAgent = useCallback(async () => {
    const next: 'claude' | 'codex' = codingAgent === 'claude' ? 'codex' : 'claude'
    setCodingAgent(next)
    // Persist only when scoped to a workdir; without one there's nothing to key on.
    if (!workDir) return
    try {
      await persistCodingAgent(workDir, next)
    } catch (err) {
      console.error('Failed to save coding agent', err)
      toast.error('Failed to save coding agent')
      // revert on failure
      setCodingAgent(codingAgent)
    }
  }, [workDir, codingAgent, persistCodingAgent])

  // Check search tool availability (exa or signed-in via gateway)
  useEffect(() => {
    const checkSearch = async () => {
      if (isRowboatConnected) {
        setSearchAvailable(true)
        return
      }
      let available = false
      try {
        const raw = await window.ipc.invoke('workspace:readFile', { path: 'config/exa-search.json' })
        const config = JSON.parse(raw.data)
        if (config.apiKey) available = true
      } catch { /* not configured */ }
      setSearchAvailable(available)
    }
    checkSearch()
  }, [isActive, isRowboatConnected])

  // Selecting a model affects only the *next* run created from this tab.
  // Once a run exists, model is frozen on the run and the dropdown is read-only.
  const handleModelChange = useCallback((key: string) => {
    if (lockedModel) return
    const entry = configuredModels.find((m) => `${m.provider}/${m.model}` === key)
    if (!entry) return
    setActiveModelKey(key)
    onSelectedModelChange?.({ provider: entry.provider, model: entry.model })
  }, [configuredModels, lockedModel, onSelectedModelChange])

  // Restore the tab draft when this input mounts.
  useEffect(() => {
    if (initialDraft) {
      controller.textInput.setInput(initialDraft)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    onDraftChange?.(message)
  }, [message, onDraftChange])

  useEffect(() => {
    if (presetMessage) {
      controller.textInput.setInput(presetMessage)
      onPresetMessageConsumed?.()
    }
  }, [presetMessage, controller.textInput, onPresetMessageConsumed])

  const addFiles = useCallback(async (paths: string[]) => {
    const newAttachments: StagedAttachment[] = []
    for (const filePath of paths) {
      try {
        const result = await window.ipc.invoke('shell:readFileBase64', { path: filePath })
        if (result.size > MAX_ATTACHMENT_SIZE) {
          toast.error(`File too large: ${getFileDisplayName(filePath)} (max 10MB)`)
          continue
        }
        const mime = result.mimeType || getMimeFromExtension(getExtension(filePath))
        const image = isImageMime(mime)
        newAttachments.push({
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          path: filePath,
          filename: getFileDisplayName(filePath),
          mimeType: mime,
          isImage: image,
          size: result.size,
          thumbnailUrl: image ? `data:${mime};base64,${result.data}` : undefined,
        })
      } catch (err) {
        console.error('Failed to read file:', filePath, err)
        toast.error(`Failed to read: ${getFileDisplayName(filePath)}`)
      }
    }
    if (newAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...newAttachments])
      setFocusNonce((value) => value + 1)
    }
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id))
  }, [])

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return
    // codeMode is sticky per conversation — don't reset after send.
    const effectiveCodeMode = codeModeEnabled ? codingAgent : undefined
    onSubmit({ text: message.trim(), files: [] }, controller.mentions.mentions, attachments, searchEnabled || undefined, effectiveCodeMode, permissionMode)
    controller.textInput.clear()
    controller.mentions.clearMentions()
    setAttachments([])
    // Web search toggle stays on for the rest of the chat session; the user
    // turns it off explicitly. (Not persisted across app restarts.)
  }, [attachments, canSubmit, controller, message, onSubmit, searchEnabled, codeModeEnabled, codingAgent, permissionMode, workDir])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  useEffect(() => {
    if (!isActive) return
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault()
      }
    }

    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault()
      }
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        const paths = Array.from(e.dataTransfer.files)
          .map((file) => window.electronUtils?.getPathForFile(file))
          .filter(Boolean) as string[]
        if (paths.length > 0) {
          void addFiles(paths)
        }
      }
    }

    document.addEventListener('dragover', onDragOver)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('drop', onDrop)
    }
  }, [addFiles, isActive])

  const visibleRecentWorkDirs = recentWorkDirs
    .filter((entry) => entry.path !== workDir)
    .slice(0, MAX_VISIBLE_RECENT_WORK_DIRS)
  const currentWorkDirLabel = workDir ? basename(workDir) || workDir : 'Not set'
  const currentWorkDirPath = workDir ? compactWorkDirPath(workDir) : ''

  return (
    <div className="rowboat-chat-input rounded-lg border border-border bg-background shadow-none">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-1 pt-3">
          {attachments.map((attachment) => {
            const attachmentType = getAttachmentTypeLabel(attachment)
            const attachmentName = getAttachmentDisplayName(attachment)
            const Icon = getAttachmentIcon(getAttachmentIconKind(attachment))

            return (
              <span
                key={attachment.id}
                className="group relative inline-flex min-w-[230px] max-w-[320px] items-center gap-2 rounded-xl border border-border/50 bg-muted/80 px-2.5 py-2"
              >
                <span
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg',
                    attachment.isImage && attachment.thumbnailUrl
                      ? 'bg-muted'
                      : getAttachmentToneClass(attachmentType)
                  )}
                >
                  {attachment.isImage && attachment.thumbnailUrl ? (
                    <img src={attachment.thumbnailUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <Icon className="size-5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm leading-tight font-medium">{attachmentName}</span>
                  <span className="block pt-0.5 text-xs leading-tight text-muted-foreground">{attachmentType}</span>
                </span>
                <button
                  type="button"
                  onClick={() => removeAttachment(attachment.id)}
                  className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full border border-border/70 bg-background/70 text-muted-foreground opacity-0 transition-[opacity,color] duration-150 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            )
          })}
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files
          if (!files || files.length === 0) return
          const paths = Array.from(files)
            .map((file) => window.electronUtils?.getPathForFile(file))
            .filter(Boolean) as string[]
          if (paths.length > 0) {
            void addFiles(paths)
          }
          e.target.value = ''
        }}
      />
      {isRecording ? (
        /* ── Recording bar ── */
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={onCancelRecording}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Cancel recording"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex flex-1 items-center gap-2 overflow-hidden">
            <VoiceWaveform />
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              {recordingState === 'connecting' ? 'Connecting...' : recordingText || 'Listening...'}
            </span>
          </div>
          <Button
            size="icon"
            onClick={onSubmitRecording}
            disabled={!recordingText?.trim()}
            className={cn(
              'h-7 w-7 shrink-0 rounded-full transition-all',
              recordingText?.trim()
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground'
            )}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        /* ── Normal input ── */
        <>
      <div className="px-4 pt-4 pb-2">
        <PromptInputTextarea
          placeholder="Type your message..."
          onKeyDown={handleKeyDown}
          autoFocus={isActive}
          focusTrigger={isActive ? `${runId ?? 'new'}:${focusNonce}` : undefined}
          className="min-h-6 rounded-none border-0 py-0 shadow-none focus-visible:ring-0"
        />
      </div>
      <div className="flex items-center gap-2 px-4 pb-3">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Add"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">
              {workDir ? 'Add files or change work directory' : 'Add files or set work directory'}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-2rem)] p-2">
            <div className="rounded-[14px] border border-border/80 bg-background p-1">
              <DropdownMenuItem onSelect={() => fileInputRef.current?.click()} className="h-9 rounded-[9px] px-2.5">
                <ImagePlus className="size-4" />
                <span>Add files or photos</span>
              </DropdownMenuItem>

              {/* Working directory lives behind a submenu so the main menu stays to two
                  items. One hover/click away for power users; out of the way otherwise. */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="h-9 rounded-[9px] px-2.5">
                  <FolderCog className="size-4" />
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                    <span>Set working directory</span>
                    <span className="min-w-0 max-w-[110px] truncate text-xs text-muted-foreground">
                      {currentWorkDirLabel}
                    </span>
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-72 max-w-[calc(100vw-2rem)] p-1">
                  {/* Current selection — shown for context only when one is set. */}
                  {workDir && (
                    <div
                      title={workDir}
                      className="mb-1 flex items-center gap-2 rounded-[9px] bg-blue-50/80 px-2.5 py-2 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
                    >
                      <FolderCheck className="size-4 shrink-0 text-blue-600 dark:text-blue-300" />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium">{currentWorkDirLabel}</span>
                        <span className="truncate text-xs text-blue-700/70 dark:text-blue-300/70">
                          {currentWorkDirPath}
                        </span>
                      </span>
                    </div>
                  )}

                  {/* Primary action: choose when unset, change when set. Always on top. */}
                  <DropdownMenuItem
                    onSelect={() => { void handleSetWorkDir() }}
                    className="h-9 rounded-[9px] px-2.5"
                  >
                    <FolderOpen className="size-4" />
                    <span>{workDir ? 'Change folder…' : 'Choose a folder…'}</span>
                  </DropdownMenuItem>

                  {visibleRecentWorkDirs.length > 0 && (
                    <>
                      <div className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Recent
                      </div>
                      {visibleRecentWorkDirs.map((entry) => {
                        const name = basename(entry.path) || entry.path
                        const when = formatRecentWorkDirTime(entry.lastUsedAt)
                        return (
                          <DropdownMenuItem
                            key={entry.path}
                            title={entry.path}
                            onSelect={() => { void handleSelectRecentWorkDir(entry.path) }}
                            className="h-8 rounded-[9px] px-2.5"
                          >
                            <FolderClock className="size-4" />
                            <span className="min-w-0 flex-1 truncate">{name}</span>
                            {when && <span className="shrink-0 text-xs text-muted-foreground">{when}</span>}
                          </DropdownMenuItem>
                        )
                      })}
                    </>
                  )}

                  {/* Clear — only meaningful once a directory is set. Kept at the bottom. */}
                  {workDir && (
                    <>
                      <div className="my-1 h-px bg-border/60" />
                      <DropdownMenuItem
                        onSelect={handleClearWorkDir}
                        className="h-8 rounded-[9px] px-2.5 text-red-600 focus:bg-red-50 focus:text-red-600 dark:text-red-400 dark:focus:bg-red-950/30"
                      >
                        <X className="size-4" />
                        <span>Clear folder</span>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
        {workDir && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="group flex h-7 max-w-[180px] shrink-0 items-center rounded-full border border-border bg-muted/40 pl-2.5 pr-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <button
                  type="button"
                  onClick={handleSetWorkDir}
                  className="flex min-w-0 items-center gap-1.5"
                >
                  <FolderCog className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{basename(workDir) || workDir}</span>
                </button>
                <button
                  type="button"
                  onClick={handleClearWorkDir}
                  aria-label="Remove work directory"
                  className="flex h-3.5 w-0 shrink-0 items-center justify-center overflow-hidden opacity-0 transition-all duration-150 ease-out hover:text-red-500 group-hover:ml-1 group-hover:w-3.5 group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5 shrink-0" />
                </button>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top">
              Work directory: {workDir}
            </TooltipContent>
          </Tooltip>
        )}
        {searchAvailable && (
          <button
            type="button"
            onClick={() => setSearchEnabled((v) => !v)}
            aria-label="Search"
            aria-pressed={searchEnabled}
            className={cn(
              'flex h-7 shrink-0 items-center rounded-full border px-1.5 transition-colors duration-150 ease-out',
              searchEnabled
                ? 'border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-400 dark:hover:bg-blue-900'
                : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Globe className="h-4 w-4 shrink-0" />
            <span
              className={cn(
                'overflow-hidden whitespace-nowrap text-xs font-medium transition-all duration-150 ease-out',
                searchEnabled ? 'ml-1.5 max-w-[60px] opacity-100' : 'max-w-0 opacity-0'
              )}
            >
              Search
            </span>
          </button>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => {
                if (runId) return
                setPermissionMode((mode) => mode === 'auto' ? 'manual' : 'auto')
              }}
              disabled={Boolean(runId)}
              className={cn(
                "flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors",
                permissionMode === 'auto'
                  ? "bg-secondary text-foreground hover:bg-secondary/70"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
                runId && "cursor-not-allowed opacity-70 hover:bg-secondary"
              )}
              aria-label="Permission mode"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>{permissionMode === 'auto' ? 'Auto' : 'Manual'}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {runId
              ? `Permission mode is fixed for this run: ${permissionMode === 'auto' ? 'Auto' : 'Manual'}`
              : permissionMode === 'auto'
                ? 'Auto-permission on — click for manual approval prompts'
                : 'Manual approval prompts — click for auto-permission'}
          </TooltipContent>
        </Tooltip>
        {codeModeFeatureEnabled && (codeModeEnabled ? (
          <div className="flex h-7 shrink-0 items-center rounded-full bg-secondary text-xs font-medium text-foreground">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setCodeModeEnabled(false)}
                  className="flex h-full items-center gap-1.5 rounded-l-full pl-2.5 pr-2 transition-colors hover:bg-secondary/70"
                >
                  <Terminal className="h-3.5 w-3.5" />
                  <span>Code</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Code mode on — click to disable</TooltipContent>
            </Tooltip>
            <span className="text-foreground/30">·</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleToggleCodingAgent}
                  className="flex h-full items-center rounded-r-full pl-2 pr-2.5 transition-colors hover:bg-secondary/70"
                >
                  <span>{codingAgent === 'claude' ? 'Claude' : 'Codex'}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                Coding agent: {codingAgent === 'claude' ? 'Claude Code' : 'Codex'} — click to swap
              </TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setCodeModeEnabled(true)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Code mode"
              >
                <Terminal className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Use a coding agent (Claude Code or Codex)</TooltipContent>
          </Tooltip>
        ))}
        <div className="flex-1" />
        {lockedModel ? (
          <span
            className="flex h-7 min-w-0 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground"
            title={`${providerDisplayNames[lockedModel.provider] || lockedModel.provider} — fixed for this chat`}
          >
            <span className="min-w-0 truncate">{getSelectedModelDisplayName(lockedModel.model)}</span>
          </span>
        ) : configuredModels.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-7 min-w-0 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <span className="min-w-0 truncate">
                  {getSelectedModelDisplayName(configuredModels.find((m) => `${m.provider}/${m.model}` === activeModelKey)?.model || configuredModels[0]?.model || 'Model')}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={activeModelKey} onValueChange={handleModelChange}>
                {configuredModels.map((m) => {
                  const key = `${m.provider}/${m.model}`
                  return (
                    <DropdownMenuRadioItem key={key} value={key}>
                      <span className="truncate">{m.model}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{providerDisplayNames[m.provider] || m.provider}</span>
                    </DropdownMenuRadioItem>
                  )
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {onToggleTts && ttsAvailable && (
          <div className="flex shrink-0 items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onToggleTts}
                  className={cn(
                    'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors',
                    ttsEnabled
                      ? 'text-foreground hover:bg-muted'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                  aria-label={ttsEnabled ? 'Disable voice output' : 'Enable voice output'}
                >
                  <Headphones className="h-4 w-4" />
                  {!ttsEnabled && (
                    <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="block h-[1.5px] w-5 -rotate-45 rounded-full bg-muted-foreground" />
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {ttsEnabled ? 'Voice output on' : 'Voice output off'}
              </TooltipContent>
            </Tooltip>
            {ttsEnabled && onTtsModeChange && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-7 w-4 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuRadioGroup value={ttsMode ?? 'summary'} onValueChange={(v) => onTtsModeChange(v as 'summary' | 'full')}>
                    <DropdownMenuRadioItem value="summary">Speak summary</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="full">Speak full response</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
        {voiceAvailable && onStartRecording && (
          <button
            type="button"
            onClick={onStartRecording}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Voice input"
          >
            <Mic className="h-4 w-4" />
          </button>
        )}
        {isProcessing ? (
          <Button
            size="icon"
            onClick={onStop}
            title={isStopping ? 'Click again to force stop' : 'Stop generation'}
            className={cn(
              'h-7 w-7 shrink-0 rounded-full transition-all',
              isStopping
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            )}
          >
            {isStopping ? (
              <LoaderIcon className="h-4 w-4 animate-spin" />
            ) : (
              <Square className="h-3 w-3 fill-current" />
            )}
          </Button>
        ) : (
          <Button
            size="icon"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={cn(
              'h-7 w-7 shrink-0 rounded-full transition-all',
              canSubmit
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground'
            )}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        )}
      </div>
        </>
      )}
    </div>
  )
}

/** Animated waveform bars for the recording indicator */
function VoiceWaveform() {
  return (
    <div className="flex items-center gap-[3px] h-5">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-primary"
          style={{
            animation: `voice-wave 1.2s ease-in-out ${i * 0.15}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes voice-wave {
          0%, 100% { height: 4px; }
          50% { height: 16px; }
        }
      `}</style>
    </div>
  )
}

export interface ChatInputWithMentionsProps {
  knowledgeFiles: string[]
  recentFiles: string[]
  visibleFiles: string[]
  onSubmit: (message: PromptInputMessage, mentions?: FileMention[], attachments?: StagedAttachment[], searchEnabled?: boolean, codeMode?: 'claude' | 'codex', permissionMode?: PermissionMode) => void
  onStop?: () => void
  isProcessing: boolean
  isStopping?: boolean
  isActive?: boolean
  presetMessage?: string
  onPresetMessageConsumed?: () => void
  runId?: string | null
  initialDraft?: string
  onDraftChange?: (text: string) => void
  isRecording?: boolean
  recordingText?: string
  recordingState?: 'connecting' | 'listening'
  onStartRecording?: () => void
  onSubmitRecording?: () => void
  onCancelRecording?: () => void
  voiceAvailable?: boolean
  ttsAvailable?: boolean
  ttsEnabled?: boolean
  ttsMode?: 'summary' | 'full'
  onToggleTts?: () => void
  onTtsModeChange?: (mode: 'summary' | 'full') => void
  onSelectedModelChange?: (model: SelectedModel | null) => void
  workDir?: string | null
  onWorkDirChange?: (value: string | null) => void
}

export function ChatInputWithMentions({
  knowledgeFiles,
  recentFiles,
  visibleFiles,
  onSubmit,
  onStop,
  isProcessing,
  isStopping,
  isActive = true,
  presetMessage,
  onPresetMessageConsumed,
  runId,
  initialDraft,
  onDraftChange,
  isRecording,
  recordingText,
  recordingState,
  onStartRecording,
  onSubmitRecording,
  onCancelRecording,
  voiceAvailable,
  ttsAvailable,
  ttsEnabled,
  ttsMode,
  onToggleTts,
  onTtsModeChange,
  onSelectedModelChange,
  workDir,
  onWorkDirChange,
}: ChatInputWithMentionsProps) {
  return (
    <PromptInputProvider knowledgeFiles={knowledgeFiles} recentFiles={recentFiles} visibleFiles={visibleFiles}>
      <ChatInputInner
        onSubmit={onSubmit}
        onStop={onStop}
        isProcessing={isProcessing}
        isStopping={isStopping}
        isActive={isActive}
        presetMessage={presetMessage}
        onPresetMessageConsumed={onPresetMessageConsumed}
        runId={runId}
        initialDraft={initialDraft}
        onDraftChange={onDraftChange}
        isRecording={isRecording}
        recordingText={recordingText}
        recordingState={recordingState}
        onStartRecording={onStartRecording}
        onSubmitRecording={onSubmitRecording}
        onCancelRecording={onCancelRecording}
        voiceAvailable={voiceAvailable}
        ttsAvailable={ttsAvailable}
        ttsEnabled={ttsEnabled}
        ttsMode={ttsMode}
        onToggleTts={onToggleTts}
        onTtsModeChange={onTtsModeChange}
        onSelectedModelChange={onSelectedModelChange}
        workDir={workDir}
        onWorkDirChange={onWorkDirChange}
      />
    </PromptInputProvider>
  )
}
