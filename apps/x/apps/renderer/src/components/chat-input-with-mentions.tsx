import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  ImagePlus,
  LoaderIcon,
  Brain,
  Lock,
  Mic,
  MoreHorizontal,
  Phone,
  PhoneOff,
  Plus,
  Presentation,
  ShieldCheck,
  Square,
  Terminal,
  Video,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useProviderModels, type ProviderModelsFlavor } from '@/hooks/use-provider-models'
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
const CHAT_INPUT_TOOLTIP_DELAY_MS = 1000
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

// One picker group per connected provider. Catalog groups carry a resolved
// model list (models:list / saved config); live groups carry credentials and
// fetch their list from the provider inside the dropdown via
// useProviderModels (models:listForProvider).
const LIVE_PICKER_FLAVORS = new Set<string>(['openrouter', 'aigateway', 'ollama', 'openai-compatible'])
// Catalog-preferred flavors that degrade to a live fetch when models:list has
// no catalog for them (signed-in mode returns only the rowboat provider, or
// the models.dev cache is empty).
const LIVE_FALLBACK_FLAVORS = new Set<string>(['openai', 'anthropic', 'google'])

type ModelPickerGroup =
  | { kind: 'catalog'; flavor: string; models: string[] }
  | { kind: 'live'; flavor: ProviderModelsFlavor; apiKey: string; baseURL: string; savedModel: string }

// Rendered inside the dropdown's radio group: each live provider fetches its
// own list, so groups load and fail independently. Pinned models (the saved
// default / app default) render first — the model that actually runs is
// always pickable even while the fetch is pending or failed. Live-fetched
// ids carry no reasoning metadata, so the effort control stays hidden for
// them (reasoningByKey lookup misses default to off).
//
// The group owns its header so it can hide itself when the search filter
// matches none of its rows. Loading/error rows are status, not models — they
// render (with the header) regardless of the filter, and don't count toward
// the parent's "No models match" check (which is what gets reported up).
function LiveProviderGroupItems({ group, label, pinnedModels, filter, onModelRowsChange }: {
  group: Extract<ModelPickerGroup, { kind: 'live' }>
  label: string
  pinnedModels: string[]
  filter: string
  onModelRowsChange: (flavor: string, hasModelRows: boolean) => void
}) {
  const { status, models, error, refetch } = useProviderModels({
    flavor: group.flavor,
    apiKey: group.apiKey,
    baseURL: group.baseURL,
  })
  const items = [...pinnedModels, ...models.filter((m) => !pinnedModels.includes(m))]
  const visible = filter ? items.filter((m) => m.toLowerCase().includes(filter)) : items
  const showStatus = status === 'loading' || status === 'error'
  const hasModelRows = visible.length > 0
  useEffect(() => {
    onModelRowsChange(group.flavor, hasModelRows)
  }, [group.flavor, hasModelRows, onModelRowsChange])
  if (!hasModelRows && !showStatus) return null
  return (
    <>
      <DropdownMenuLabel className="text-xs text-muted-foreground">{label}</DropdownMenuLabel>
      {visible.map((m) => {
        const key = `${group.flavor}/${m}`
        return (
          <DropdownMenuRadioItem key={key} value={key}>
            <span className="truncate">{m}</span>
          </DropdownMenuRadioItem>
        )
      })}
      {status === 'loading' && (
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <LoaderIcon className="h-3 w-3 animate-spin" />
          Loading models…
        </div>
      )}
      {status === 'error' && (
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            refetch()
          }}
          className="text-xs"
        >
          <span className="truncate text-destructive">{error || 'Failed to load models'}</span>
          <span className="ml-auto shrink-0 text-muted-foreground">Retry</span>
        </DropdownMenuItem>
      )}
    </>
  )
}

type RecentWorkDir = {
  path: string
  lastUsedAt: number
}

export interface SelectedModel {
  provider: string
  model: string
}

export type ReasoningEffortLevel = 'low' | 'medium' | 'high'

// '' = auto (provider default). Ordered as shown in the picker.
const REASONING_EFFORT_OPTIONS: Array<{ value: '' | ReasoningEffortLevel; label: string; hint: string }> = [
  { value: '', label: 'Auto', hint: 'Provider default' },
  { value: 'low', label: 'Fast', hint: 'Minimal thinking' },
  { value: 'medium', label: 'Balanced', hint: 'Moderate thinking' },
  { value: 'high', label: 'Thorough', hint: 'Deep thinking, costs more' },
]

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

// Call presets: front doors into the same call engine, differing only in
// starting devices. 'share' is the call button's main click — the "work
// together" default (screen shared, camera off, floating pill). The chevron
// menu holds the deviations.
export type CallPreset = 'voice' | 'video' | 'share' | 'practice'

const CALL_PRESET_MENU: Array<{ preset: CallPreset; label: string; description: string; Icon: typeof Phone }> = [
  { preset: 'voice', label: 'Voice call', description: 'Just talk — nothing is shared, the mascot hovers while you work', Icon: AudioLines },
  { preset: 'video', label: 'Video call', description: 'Camera on, face to face — it sees your expressions', Icon: Video },
  { preset: 'practice', label: 'Practice session', description: 'Rehearse a pitch or interview with live coaching', Icon: Presentation },
]

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
  recordingState?: 'connecting' | 'listening' | 'stopping'
  /** Live mic amplitude history (RMS per frame) driving the recording waveform. */
  audioLevelsRef?: React.MutableRefObject<number[]>
  onStartRecording?: () => void
  onSubmitRecording?: () => void | Promise<void>
  onCancelRecording?: () => void
  voiceAvailable?: boolean
  /** A call is live (hands-free voice loop + spoken responses). */
  inCall?: boolean
  /** Start a call with the given preset's device defaults. */
  onStartCall?: (preset: CallPreset) => void
  onEndCall?: () => void
  /** Calls need both voice input (STT) and voice output (TTS) configured. */
  callAvailable?: boolean
  /** Fired when the user picks a different model in the dropdown (only when no run exists yet). */
  onSelectedModelChange?: (model: SelectedModel | null) => void
  /**
   * Fired when the user picks a reasoning effort (null = auto). Unlike model,
   * effort is never frozen on a run — it applies per turn.
   */
  onReasoningEffortChange?: (effort: ReasoningEffortLevel | null) => void
  /** Work directory for this chat (per-chat). Null when none is set. */
  workDir?: string | null
  /** Fired when the user sets/changes/clears the work directory for this chat. */
  onWorkDirChange?: (value: string | null) => void
  /**
   * Set when this chat is bound to a Code-section session: the work directory
   * and coding agent come from the session and are FROZEN — the backend pins
   * them server-side regardless, so the composer must not pretend otherwise.
   */
  codeSessionLock?: { cwd: string; agent: 'claude' | 'codex' } | null
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
  audioLevelsRef,
  onStartRecording,
  onSubmitRecording,
  onCancelRecording,
  voiceAvailable,
  inCall,
  onStartCall,
  onEndCall,
  callAvailable,
  onSelectedModelChange,
  onReasoningEffortChange,
  workDir = null,
  onWorkDirChange,
  codeSessionLock = null,
}: ChatInputInnerProps) {
  const controller = usePromptInputController()
  const message = controller.textInput.value
  const [attachments, setAttachments] = useState<StagedAttachment[]>([])
  const [focusNonce, setFocusNonce] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canSubmit = (Boolean(message.trim()) || attachments.length > 0) && !isProcessing

  const [modelGroups, setModelGroups] = useState<ModelPickerGroup[]>([])
  const [activeModelKey, setActiveModelKey] = useState('')
  // The effective runtime default (what a run actually uses when the user
  // hasn't picked a model) — shown in the picker instead of guessing from
  // list order, which can disagree with the real default.
  const [defaultModel, setDefaultModel] = useState<ConfiguredModel | null>(null)
  const loadModelConfigEpoch = useRef(0)
  const [lockedModel, setLockedModel] = useState<SelectedModel | null>(null)
  // '' = auto. Per-model reasoning capability ("provider/model" → flag) from
  // models:list; the effort control renders only for known-reasoning models.
  const [reasoningEffort, setReasoningEffort] = useState<'' | ReasoningEffortLevel>('')
  const [reasoningByKey, setReasoningByKey] = useState<Record<string, boolean>>({})
  const [searchEnabled, setSearchEnabled] = useState(false)
  const [searchAvailable, setSearchAvailable] = useState(false)
  const [isRowboatConnected, setIsRowboatConnected] = useState(false)
  const [codingAgent, setCodingAgent] = useState<'claude' | 'codex'>('claude')
  const [codeModeEnabled, setCodeModeEnabled] = useState(false)
  const [codeModeFeatureEnabled, setCodeModeFeatureEnabled] = useState(false)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('auto')
  const [recentWorkDirs, setRecentWorkDirs] = useState<RecentWorkDir[]>([])

  // Responsive toolbar: measure real overflow and progressively collapse items
  // right→left until everything fits. Stages:
  //   1 code→icon · 2 perm→icon · 3 search label hidden · 4 workDir→icon
  //   5 code→menu · 6 perm→menu · 7 search→menu · 8 workDir→menu
  // Once items move into the "⋯" overflow menu (≥5) no icon is ever hidden.
  // overflow-hidden on the left group is the hard guarantee against any overlap.
  const toolbarRef = useRef<HTMLDivElement>(null)
  const leftGroupRef = useRef<HTMLDivElement>(null)
  const lastWidthRef = useRef(0)
  const [collapseLevel, setCollapseLevel] = useState(0)

  // Re-evaluate from scratch (level 0) whenever the available width changes…
  useEffect(() => {
    const outer = toolbarRef.current
    if (!outer) return
    const ro = new ResizeObserver(() => {
      const w = outer.clientWidth
      if (w !== lastWidthRef.current) {
        lastWidthRef.current = w
        setCollapseLevel(0)
      }
    })
    ro.observe(outer)
    return () => ro.disconnect()
  }, [])

  // …or when the *set* of items changes (an item appears/disappears, or the model
  // name width changes). Deliberately excludes the in-place toggles (searchEnabled,
  // permissionMode, codeModeEnabled, codingAgent): those fire from the overflow menu
  // for items already inside it, so resetting here would unmount the open menu. The
  // no-dep effect below still re-collapses if any toggle happens to widen the row.
  useLayoutEffect(() => {
    setCollapseLevel(0)
  }, [workDir, searchAvailable, codeModeFeatureEnabled, lockedModel, activeModelKey])

  // After each render, if the left group still overflows, collapse one more step.
  // Runs before paint, so the intermediate (overflowing) state is never visible.
  useLayoutEffect(() => {
    const el = leftGroupRef.current
    if (!el) return
    if (el.scrollWidth > el.clientWidth + 1 && collapseLevel < 8) {
      setCollapseLevel((l) => Math.min(8, l + 1))
    }
  })

  // Sessions runtime: model and permission mode are per-message turn config,
  // so nothing is frozen for an existing chat — the picker stays live.
  useEffect(() => {
    if (!runId) {
      setLockedModel(null)
      setPermissionMode('auto')
      return
    }
    setLockedModel(null)
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

  // Load the list of models the user can choose from. Hybrid mode: signed-in
  // users get the gateway list AND every BYOK provider configured in
  // models.json (selecting a BYOK model routes that message through the
  // user's own key / local server). Signed-out users get BYOK only.
  const loadModelConfig = useCallback(async () => {
    // Concurrent runs race (mount fires one before the sign-in state resolves,
    // which fires another) — only the newest run may write state, else a slow
    // stale run can clobber the fresh list with an empty one.
    const epoch = ++loadModelConfigEpoch.current
    try {
      const def = await window.ipc.invoke('llm:getDefaultModel', null)
      if (loadModelConfigEpoch.current !== epoch) return
      setDefaultModel({ provider: def.provider as ProviderName, model: def.model })
    } catch {
      if (loadModelConfigEpoch.current === epoch) setDefaultModel(null)
    }
    try {
      const groups: ModelPickerGroup[] = []

      // Full catalog per provider (gateway + models.dev cloud providers).
      const catalog: Record<string, string[]> = {}
      const reasoningFlags: Record<string, boolean> = {}
      try {
        const listResult = await window.ipc.invoke('models:list', null)
        for (const p of listResult.providers || []) {
          catalog[p.id] = (p.models || []).map((m: { id: string }) => m.id)
          for (const m of p.models || []) {
            if (typeof m.reasoning === 'boolean') {
              reasoningFlags[`${p.id}/${m.id}`] = m.reasoning
            }
          }
        }
      } catch { /* offline / no catalog — groups fall back to saved config below */ }
      if (loadModelConfigEpoch.current === epoch) setReasoningByKey(reasoningFlags)

      if (isRowboatConnected && (catalog['rowboat'] || []).length > 0) {
        groups.push({ kind: 'catalog', flavor: 'rowboat', models: catalog['rowboat'] })
      }

      try {
        const result = await window.ipc.invoke('workspace:readFile', { path: 'config/models.json' })
        const parsed = JSON.parse(result.data)

        // List the default provider's group first.
        const defaultFlavor = typeof parsed?.provider?.flavor === 'string' ? parsed.provider.flavor : ''
        const flavors = Object.keys(parsed?.providers || {})
          .sort((a, b) => (a === defaultFlavor ? -1 : b === defaultFlavor ? 1 : 0))

        for (const flavor of flavors) {
          const e = (parsed.providers[flavor] || {}) as Record<string, unknown>
          const apiKey = typeof e.apiKey === 'string' ? e.apiKey.trim() : ''
          const baseURL = typeof e.baseURL === 'string' ? e.baseURL.trim() : ''
          if (!apiKey && !baseURL) continue // provider not configured
          const savedModel = typeof e.model === 'string' ? e.model : ''

          // Live flavors fetch their list from the provider inside the
          // dropdown, with the credentials saved in config. Catalog flavors
          // degrade to the same live fetch when models:list carried no
          // catalog for them (signed in, or empty models.dev cache).
          const catalogModels = catalog[flavor] || []
          if (LIVE_PICKER_FLAVORS.has(flavor) || (catalogModels.length === 0 && LIVE_FALLBACK_FLAVORS.has(flavor))) {
            groups.push({ kind: 'live', flavor: flavor as ProviderModelsFlavor, apiKey, baseURL, savedModel })
            continue
          }

          // Catalog group: the saved default model leads, then the catalog.
          // Saved models[] survives as the fallback for unknown flavors the
          // live fetch doesn't support.
          const models: string[] = []
          const push = (model: string) => {
            if (model && !models.includes(model)) models.push(model)
          }
          push(savedModel)
          if (catalogModels.length > 0) {
            for (const m of catalogModels) push(m)
          } else {
            const saved = Array.isArray(e.models) ? e.models as string[] : []
            for (const m of saved) push(m)
          }
          groups.push({ kind: 'catalog', flavor, models })
        }

        // The user's explicit default selection leads the picker: its group
        // first and, within a catalog group, the model itself first. (Live
        // groups pin the default at the top themselves.)
        const sel = parsed?.defaultSelection
        if (sel && typeof sel.provider === 'string' && typeof sel.model === 'string') {
          const index = groups.findIndex((g) => g.flavor === sel.provider)
          if (index >= 0) {
            const [group] = groups.splice(index, 1)
            groups.unshift(group)
            if (group.kind === 'catalog') {
              const mi = group.models.indexOf(sel.model)
              if (mi > 0) {
                group.models.splice(mi, 1)
                group.models.unshift(sel.model)
              }
            }
          }
        }
      } catch { /* no BYOK config yet */ }

      if (loadModelConfigEpoch.current !== epoch) return
      setModelGroups(groups)
    } catch (err) {
      // No config yet — but surface unexpected failures for diagnosis.
      console.error('[chat-input] failed to load model list', err)
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

  // A chat bound to a Code-section session has its work directory and coding
  // agent frozen to the session's — the backend pins them server-side, so the
  // composer reflects that instead of offering controls that wouldn't apply.
  const isCodeLocked = Boolean(codeSessionLock)
  const effectiveWorkDir = codeSessionLock?.cwd ?? workDir

  // Work directory is owned per-chat by the parent (App). This component only
  // drives the picker dialog and reports changes up via onWorkDirChange. Whenever
  // the work directory changes, load its persisted coding-agent preference.
  useEffect(() => {
    if (codeSessionLock) {
      setCodingAgent(codeSessionLock.agent)
      return
    }
    let cancelled = false
    loadCodingAgentFor(workDir).then((agent) => {
      if (!cancelled) setCodingAgent(agent)
    })
    return () => { cancelled = true }
  }, [workDir, loadCodingAgentFor, codeSessionLock])

  useEffect(() => {
    if (isActive && workDir && !isCodeLocked) void rememberWorkDir(workDir)
  }, [isActive, workDir, rememberWorkDir, isCodeLocked])

  const handleSetWorkDir = useCallback(async () => {
    if (isCodeLocked) return
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
  }, [workDir, onWorkDirChange, rememberWorkDir, loadCodingAgentFor, isCodeLocked])

  const handleSelectRecentWorkDir = useCallback(async (dir: string) => {
    onWorkDirChange?.(dir)
    await rememberWorkDir(dir)
    setCodingAgent(await loadCodingAgentFor(dir))
    toast.success(`Work directory set: ${dir}`)
  }, [onWorkDirChange, rememberWorkDir, loadCodingAgentFor])

  const handleClearWorkDir = useCallback(() => {
    if (isCodeLocked) return
    onWorkDirChange?.(null)
    setCodingAgent('claude')
    toast.success('Work directory cleared')
  }, [onWorkDirChange, isCodeLocked])

  const handleToggleCodingAgent = useCallback(async () => {
    if (isCodeLocked) return
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
  }, [workDir, codingAgent, persistCodingAgent, isCodeLocked])

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

  // Search filter for the model dropdown. Reset each time the menu opens;
  // matching is a case-insensitive substring test on the model id. Live
  // groups filter themselves and report whether they still have rows, so the
  // parent can render the global "No models match" row.
  const [modelFilter, setModelFilter] = useState('')
  const modelFilterInputRef = useRef<HTMLInputElement>(null)
  const [liveGroupHasRows, setLiveGroupHasRows] = useState<Record<string, boolean>>({})
  const modelFilterValue = modelFilter.trim().toLowerCase()
  const handleLiveGroupRows = useCallback((flavor: string, hasRows: boolean) => {
    setLiveGroupHasRows((prev) => (prev[flavor] === hasRows ? prev : { ...prev, [flavor]: hasRows }))
  }, [])

  // The effective default always renders even when no group carries it (the
  // gateway list failed, or its provider was removed from config) — the
  // picker must never be missing the model that actually runs. Live groups
  // pin the default themselves, so a flavor match is enough there.
  const standaloneDefault = useMemo<ConfiguredModel | null>(() => {
    if (!defaultModel) return null
    const covered = modelGroups.some((g) =>
      g.flavor === defaultModel.provider &&
      (g.kind === 'live' || g.models.includes(defaultModel.model)))
    return covered ? null : defaultModel
  }, [modelGroups, defaultModel])

  const standaloneVisible = standaloneDefault !== null &&
    (!modelFilterValue || standaloneDefault.model.toLowerCase().includes(modelFilterValue))
  // Nothing matches anywhere → "No models match". Live groups that haven't
  // reported yet (first render after opening) count as having rows so the
  // empty row never flashes.
  const anyModelRowVisible = standaloneVisible || modelGroups.some((g) =>
    g.kind === 'catalog'
      ? g.models.some((m) => m.toLowerCase().includes(modelFilterValue))
      : liveGroupHasRows[g.flavor] !== false)

  // Selecting a model affects the *next* run created from this tab (frozen
  // once a run exists) AND persists as the app default so background agents
  // and new tabs follow the last pick. The models-config-changed dispatch
  // re-runs loadModelConfig here too — that re-read lands on the same
  // selection (activeModelKey is untouched, the live lists come from the
  // hook's cache), so it's visually a no-op.
  const handleModelChange = useCallback((key: string) => {
    if (lockedModel) return
    const slash = key.indexOf('/')
    if (slash <= 0 || slash === key.length - 1) return
    const provider = key.slice(0, slash)
    const model = key.slice(slash + 1)
    setActiveModelKey(key)
    onSelectedModelChange?.({ provider, model })
    void window.ipc.invoke('models:updateConfig', { defaultSelection: { provider, model } })
      .then(() => { window.dispatchEvent(new Event('models-config-changed')) })
      .catch(() => { toast.error('Failed to save default model') })
  }, [lockedModel, onSelectedModelChange])

  // Reasoning effort applies to the model the next message will actually use:
  // the run's frozen model once one exists, else the picker selection, else
  // the app default. Only known-reasoning models show the control.
  const effectiveModelKey = lockedModel
    ? `${lockedModel.provider}/${lockedModel.model}`
    : activeModelKey
      || (defaultModel ? `${defaultModel.provider}/${defaultModel.model}` : '')
  const reasoningAvailable = reasoningByKey[effectiveModelKey] === true

  const handleReasoningEffortChange = useCallback((value: string) => {
    const effort = value === 'low' || value === 'medium' || value === 'high' ? value : ''
    setReasoningEffort(effort)
    onReasoningEffortChange?.(effort === '' ? null : effort)
  }, [onReasoningEffortChange])

  // Switching to a model without reasoning support drops a stale selection —
  // otherwise the next message would carry an effort the model rejects.
  useEffect(() => {
    if (!reasoningAvailable && reasoningEffort !== '') {
      setReasoningEffort('')
      onReasoningEffortChange?.(null)
    }
  }, [reasoningAvailable, reasoningEffort, onReasoningEffortChange])

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
    // codeMode is sticky per conversation — don't reset after send. A code
    // session forces it (the backend pins the agent anyway).
    const effectiveCodeMode = codeSessionLock ? codeSessionLock.agent : (codeModeEnabled ? codingAgent : undefined)
    onSubmit({ text: message.trim(), files: [] }, controller.mentions.mentions, attachments, searchEnabled || undefined, effectiveCodeMode, permissionMode)
    controller.textInput.clear()
    controller.mentions.clearMentions()
    setAttachments([])
    // Web search toggle stays on for the rest of the chat session; the user
    // turns it off explicitly. (Not persisted across app restarts.)
  }, [attachments, canSubmit, controller, message, onSubmit, searchEnabled, codeModeEnabled, codingAgent, permissionMode, workDir, codeSessionLock])

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
  const currentWorkDirLabel = effectiveWorkDir ? basename(effectiveWorkDir) || effectiveWorkDir : 'Not set'
  const currentWorkDirPath = effectiveWorkDir ? compactWorkDirPath(effectiveWorkDir) : ''

  return (
    <div data-tour-id="chat-composer" className="rowboat-chat-input rounded-lg border border-border bg-background shadow-none">
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
          <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
            <VoiceWaveform audioLevelsRef={audioLevelsRef} />
            <div
              className={cn(
                'min-h-5 truncate text-sm leading-5',
                recordingText?.trim() ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {recordingText?.trim() || (recordingState === 'stopping' ? 'Finalizing...' : 'Listening...')}
            </div>
          </div>
          <Button
            size="icon"
            onClick={onSubmitRecording}
            disabled={recordingState === 'stopping'}
            className={cn(
              'h-7 w-7 shrink-0 rounded-full transition-all',
              recordingState !== 'stopping'
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {recordingState === 'stopping' ? (
              <LoaderIcon className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
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
      <div ref={toolbarRef} className="flex items-center gap-2 px-4 pb-3">
        <div ref={leftGroupRef} className="flex min-w-0 items-center gap-2 overflow-hidden">
        <DropdownMenu>
          <Tooltip delayDuration={CHAT_INPUT_TOOLTIP_DELAY_MS}>
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
              {isCodeLocked ? 'Add files' : workDir ? 'Add files or change work directory' : 'Add files or set work directory'}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-2rem)] p-2">
            <div className="rounded-[14px] border border-border/80 bg-background p-1">
              <DropdownMenuItem onSelect={() => fileInputRef.current?.click()} className="h-9 rounded-[9px] px-2.5">
                <ImagePlus className="size-4" />
                <span>Add files or photos</span>
              </DropdownMenuItem>

              {/* A bound code session pins the directory — show it, no controls. */}
              {isCodeLocked ? (
                <Tooltip delayDuration={CHAT_INPUT_TOOLTIP_DELAY_MS}>
                  <TooltipTrigger asChild>
                    <div className="flex h-auto items-center gap-2 rounded-[9px] px-2.5 py-2 text-muted-foreground">
                      <FolderCheck className="size-4 shrink-0" />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm">{currentWorkDirLabel}</span>
                        <span className="truncate text-xs">Pinned by the coding session</span>
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right">{effectiveWorkDir}</TooltipContent>
                </Tooltip>
              ) : (
              /* Working directory lives behind a submenu so the main menu stays to two
                 items. One hover/click away for power users; out of the way otherwise. */
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
                    <Tooltip delayDuration={CHAT_INPUT_TOOLTIP_DELAY_MS}>
                      <TooltipTrigger asChild>
                        <div className="mb-1 flex items-center gap-2 rounded-[9px] bg-blue-50/80 px-2.5 py-2 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                          <FolderCheck className="size-4 shrink-0 text-blue-600 dark:text-blue-300" />
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="truncate text-sm font-medium">{currentWorkDirLabel}</span>
                            <span className="truncate text-xs text-blue-700/70 dark:text-blue-300/70">
                              {currentWorkDirPath}
                            </span>
                          </span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right">{workDir}</TooltipContent>
                    </Tooltip>
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
                          <Tooltip key={entry.path} delayDuration={CHAT_INPUT_TOOLTIP_DELAY_MS}>
                            <TooltipTrigger asChild>
                              <DropdownMenuItem
                                onSelect={() => { void handleSelectRecentWorkDir(entry.path) }}
                                className="h-8 rounded-[9px] px-2.5"
                              >
                                <FolderClock className="size-4" />
                                <span className="min-w-0 flex-1 truncate">{name}</span>
                                {when && <span className="shrink-0 text-xs text-muted-foreground">{when}</span>}
                              </DropdownMenuItem>
                            </TooltipTrigger>
                            <TooltipContent side="right">{entry.path}</TooltipContent>
                          </Tooltip>
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
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
        {effectiveWorkDir && collapseLevel < 8 && (
          <Tooltip delayDuration={CHAT_INPUT_TOOLTIP_DELAY_MS}>
            <TooltipTrigger asChild>
              {/* Level 4: collapse to a square icon */}
              <div className={cn(
                "group flex h-7 shrink-0 items-center rounded-full border border-border bg-muted/40 text-xs text-muted-foreground transition-colors",
                !isCodeLocked && "hover:bg-muted hover:text-foreground",
                collapseLevel >= 4 ? "w-7 justify-center" : "max-w-[180px] pl-2.5 pr-2"
              )}>
                <button
                  type="button"
                  onClick={handleSetWorkDir}
                  disabled={isCodeLocked}
                  className={cn("flex min-w-0 items-center gap-1.5", isCodeLocked && "cursor-default")}
                >
                  {isCodeLocked
                    ? <Lock className="h-3 w-3 shrink-0" />
                    : <FolderCog className="h-3.5 w-3.5 shrink-0" />}
                  {collapseLevel < 4 && <span className="truncate">{basename(effectiveWorkDir) || effectiveWorkDir}</span>}
                </button>
                {collapseLevel < 4 && !isCodeLocked && (
                  <button
                    type="button"
                    onClick={handleClearWorkDir}
                    aria-label="Remove work directory"
                    className="flex h-3.5 w-0 shrink-0 items-center justify-center overflow-hidden opacity-0 transition-all duration-150 ease-out hover:text-red-500 group-hover:ml-1 group-hover:w-3.5 group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5 shrink-0" />
                  </button>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="top">
              {isCodeLocked
                ? `Pinned by the coding session: ${effectiveWorkDir}`
                : `Work directory: ${effectiveWorkDir}`}
            </TooltipContent>
          </Tooltip>
        )}
        {searchAvailable && collapseLevel < 7 && (
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
            {searchEnabled && collapseLevel < 3 && (
              <span className="ml-1.5 whitespace-nowrap text-xs font-medium">
                Search
              </span>
            )}
          </button>
        )}
        {collapseLevel < 6 && (
        <Tooltip delayDuration={CHAT_INPUT_TOOLTIP_DELAY_MS}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => {
                if (runId) return
                setPermissionMode((mode) => mode === 'auto' ? 'manual' : 'auto')
              }}
              disabled={Boolean(runId)}
              className={cn(
                "flex h-7 shrink-0 items-center gap-1.5 rounded-full text-xs font-medium transition-colors",
                collapseLevel >= 2 ? "w-7 justify-center" : "px-2.5",
                permissionMode === 'auto'
                  ? "bg-secondary text-foreground hover:bg-secondary/70"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
                runId && "cursor-not-allowed opacity-70 hover:bg-secondary"
              )}
              aria-label="Permission mode"
            >
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              {collapseLevel < 2 && <span>{permissionMode === 'auto' ? 'Auto' : 'Manual'}</span>}
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
        )}
        {codeModeFeatureEnabled && collapseLevel < 5 && ((isCodeLocked || codeModeEnabled) ? (
          collapseLevel >= 1 ? (
            /* Level 1: collapse the pill to a single icon */
            <Tooltip delayDuration={CHAT_INPUT_TOOLTIP_DELAY_MS}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => { if (!isCodeLocked) setCodeModeEnabled(false) }}
                  disabled={isCodeLocked}
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground transition-colors",
                    isCodeLocked ? "cursor-default" : "hover:bg-secondary/70",
                  )}
                >
                  <Terminal className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {isCodeLocked
                  ? `Coding session — ${codingAgent === 'claude' ? 'Claude Code' : 'Codex'}`
                  : `Code mode on (${codingAgent === 'claude' ? 'Claude Code' : 'Codex'}) — click to disable`}
              </TooltipContent>
            </Tooltip>
          ) : (
            <div className="flex h-7 shrink-0 items-center rounded-full bg-secondary text-xs font-medium text-foreground">
              <Tooltip delayDuration={CHAT_INPUT_TOOLTIP_DELAY_MS}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => { if (!isCodeLocked) setCodeModeEnabled(false) }}
                    disabled={isCodeLocked}
                    className={cn(
                      "flex h-full items-center gap-1.5 rounded-l-full pl-2.5 pr-2 transition-colors",
                      isCodeLocked ? "cursor-default" : "hover:bg-secondary/70",
                    )}
                  >
                    {isCodeLocked ? <Lock className="h-3 w-3" /> : <Terminal className="h-3.5 w-3.5" />}
                    <span>Code</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {isCodeLocked ? 'Pinned by the coding session' : 'Code mode on — click to disable'}
                </TooltipContent>
              </Tooltip>
              <span className="text-foreground/30">·</span>
              <Tooltip delayDuration={CHAT_INPUT_TOOLTIP_DELAY_MS}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleToggleCodingAgent}
                    disabled={isCodeLocked}
                    className={cn(
                      "flex h-full items-center rounded-r-full pl-2 pr-2.5 transition-colors",
                      isCodeLocked ? "cursor-default" : "hover:bg-secondary/70",
                    )}
                  >
                    <span>{codingAgent === 'claude' ? 'Claude' : 'Codex'}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {isCodeLocked
                    ? `Coding agent fixed by the session: ${codingAgent === 'claude' ? 'Claude Code' : 'Codex'}`
                    : `Coding agent: ${codingAgent === 'claude' ? 'Claude Code' : 'Codex'} — click to swap`}
                </TooltipContent>
              </Tooltip>
            </div>
          )
        ) : (
          <Tooltip delayDuration={CHAT_INPUT_TOOLTIP_DELAY_MS}>
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
        </div>
        {collapseLevel >= 5 && (
          <DropdownMenu>
            <Tooltip delayDuration={CHAT_INPUT_TOOLTIP_DELAY_MS}>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="More options"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="top">More options</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" side="top" className="min-w-52">
              {effectiveWorkDir && collapseLevel >= 8 && (
                <DropdownMenuItem disabled={isCodeLocked} onSelect={() => { void handleSetWorkDir() }}>
                  {isCodeLocked ? <Lock className="size-4" /> : <FolderCog className="size-4" />}
                  <span className="min-w-0 flex-1 truncate">{basename(effectiveWorkDir) || effectiveWorkDir}</span>
                </DropdownMenuItem>
              )}
              {searchAvailable && collapseLevel >= 7 && (
                <DropdownMenuCheckboxItem
                  checked={searchEnabled}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(c) => setSearchEnabled(Boolean(c))}
                >
                  Web search
                </DropdownMenuCheckboxItem>
              )}
              {collapseLevel >= 6 && (
                <DropdownMenuCheckboxItem
                  checked={permissionMode === 'auto'}
                  disabled={Boolean(runId)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(c) => setPermissionMode(c ? 'auto' : 'manual')}
                >
                  Auto-approve actions
                </DropdownMenuCheckboxItem>
              )}
              {codeModeFeatureEnabled && collapseLevel >= 5 && (
                <>
                  <DropdownMenuCheckboxItem
                    checked={isCodeLocked || codeModeEnabled}
                    disabled={isCodeLocked}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(c) => setCodeModeEnabled(Boolean(c))}
                  >
                    Code mode
                  </DropdownMenuCheckboxItem>
                  {(isCodeLocked || codeModeEnabled) && (
                    <DropdownMenuItem disabled={isCodeLocked} onSelect={(e) => { e.preventDefault(); handleToggleCodingAgent() }}>
                      <Terminal className="size-4" />
                      <span className="min-w-0 flex-1">Coding agent</span>
                      <span className="text-xs text-muted-foreground">{codingAgent === 'claude' ? 'Claude' : 'Codex'}</span>
                    </DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <div className="flex-1" />
        {reasoningAvailable && (
          <DropdownMenu>
            <Tooltip delayDuration={CHAT_INPUT_TOOLTIP_DELAY_MS}>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Brain className="h-3 w-3 shrink-0" />
                    {reasoningEffort !== '' && (
                      <span>{REASONING_EFFORT_OPTIONS.find((o) => o.value === reasoningEffort)?.label}</span>
                    )}
                    <ChevronDown className="h-3 w-3 shrink-0" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="top">Reasoning effort — applies to your next message</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={reasoningEffort} onValueChange={handleReasoningEffortChange}>
                {REASONING_EFFORT_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem key={option.value || 'auto'} value={option.value}>
                    <span>{option.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{option.hint}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {lockedModel ? (
          <Tooltip delayDuration={CHAT_INPUT_TOOLTIP_DELAY_MS}>
            <TooltipTrigger asChild>
              <span className="flex h-7 min-w-0 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground">
                <span className="min-w-0 truncate">{getSelectedModelDisplayName(lockedModel.model)}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              {providerDisplayNames[lockedModel.provider] || lockedModel.provider} — fixed for this chat
            </TooltipContent>
          </Tooltip>
        ) : (
          <DropdownMenu
            onOpenChange={(open) => {
              // The filter is per-opening, never sticky. Focus the search
              // input once the content has mounted and Radix has run its own
              // open-focus (DropdownMenu.Content has no onOpenAutoFocus).
              if (open) {
                setModelFilter('')
                setLiveGroupHasRows({})
                setTimeout(() => modelFilterInputRef.current?.focus(), 0)
              }
            }}
          >
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-7 min-w-0 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <span className="min-w-0 truncate">
                  {getSelectedModelDisplayName(
                    (activeModelKey ? activeModelKey.slice(activeModelKey.indexOf('/') + 1) : '')
                      || defaultModel?.model
                      || 'Model'
                  )}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="p-0 overflow-hidden">
              {modelGroups.length === 0 && !standaloneDefault ? (
                <div className="p-1">
                  <DropdownMenuItem disabled>Connect a provider in Settings</DropdownMenuItem>
                </div>
              ) : (
                <>
                  {/* Fixed search header — lives OUTSIDE the scroll area (the
                      inner div below scrolls), so it's flush at the very top
                      and always visible without any scroll. */}
                  <div className="bg-popover p-1">
                    <input
                      ref={modelFilterInputRef}
                      value={modelFilter}
                      onChange={(e) => setModelFilter(e.target.value)}
                      onKeyDown={(e) => {
                        // Printable keys belong to the input, not the menu's
                        // typeahead; arrows and Escape stay with the menu.
                        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Escape') {
                          e.stopPropagation()
                        }
                      }}
                      placeholder="Search models…"
                      className="h-7 w-full rounded-sm border border-input bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                  <div className="max-h-80 overflow-y-auto p-1 pt-0">
                  <DropdownMenuRadioGroup
                    value={activeModelKey || (defaultModel ? `${defaultModel.provider}/${defaultModel.model}` : '')}
                    onValueChange={handleModelChange}
                  >
                    {standaloneDefault && standaloneVisible && (
                      <DropdownMenuRadioItem value={`${standaloneDefault.provider}/${standaloneDefault.model}`}>
                        <span className="truncate">{standaloneDefault.model}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {providerDisplayNames[standaloneDefault.provider] || standaloneDefault.provider}
                        </span>
                      </DropdownMenuRadioItem>
                    )}
                    {modelGroups.map((g) => {
                      const label = providerDisplayNames[g.flavor] || g.flavor
                      if (g.kind === 'live') {
                        // The app default leads its live group; the group's
                        // own saved model follows (both stay pickable through
                        // fetch loading/failure).
                        const pinned: string[] = []
                        if (defaultModel && defaultModel.provider === g.flavor) pinned.push(defaultModel.model)
                        if (g.savedModel && !pinned.includes(g.savedModel)) pinned.push(g.savedModel)
                        return (
                          <LiveProviderGroupItems
                            key={g.flavor}
                            group={g}
                            label={label}
                            pinnedModels={pinned}
                            filter={modelFilterValue}
                            onModelRowsChange={handleLiveGroupRows}
                          />
                        )
                      }
                      const visibleModels = modelFilterValue
                        ? g.models.filter((m) => m.toLowerCase().includes(modelFilterValue))
                        : g.models
                      if (visibleModels.length === 0) return null
                      return (
                        <Fragment key={g.flavor}>
                          <DropdownMenuLabel className="text-xs text-muted-foreground">
                            {label}
                          </DropdownMenuLabel>
                          {visibleModels.map((m) => {
                            const key = `${g.flavor}/${m}`
                            return (
                              <DropdownMenuRadioItem key={key} value={key}>
                                <span className="truncate">{m}</span>
                              </DropdownMenuRadioItem>
                            )
                          })}
                        </Fragment>
                      )
                    })}
                    {modelFilterValue && !anyModelRowVisible && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">No models match</div>
                    )}
                  </DropdownMenuRadioGroup>
                  </div>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {onStartCall && (
          <div className="flex shrink-0 items-center">
            <Tooltip delayDuration={CHAT_INPUT_TOOLTIP_DELAY_MS}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    if (inCall) {
                      onEndCall?.()
                    } else if (callAvailable) {
                      onStartCall('share')
                    }
                  }}
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors',
                    inCall
                      ? 'bg-red-600 text-white hover:bg-red-500'
                      : callAvailable
                        ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        : 'cursor-default text-muted-foreground/40'
                  )}
                  aria-label={inCall ? 'End call' : 'Start a call'}
                >
                  {inCall ? <PhoneOff className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {inCall
                  ? 'End call'
                  : callAvailable
                    ? 'Start a call — it sees your screen while you talk it through'
                    : 'Calls need voice input and output configured'}
              </TooltipContent>
            </Tooltip>
            {!inCall && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-7 w-4 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                    aria-label="Call options"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  {CALL_PRESET_MENU.map(({ preset, label, description, Icon }) => (
                    <DropdownMenuItem
                      key={preset}
                      disabled={!callAvailable}
                      onSelect={() => onStartCall(preset)}
                      className="items-start gap-3 py-2"
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium leading-tight">{label}</span>
                        <span className="block pt-0.5 text-xs leading-tight text-muted-foreground">{description}</span>
                      </span>
                    </DropdownMenuItem>
                  ))}
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
          <Tooltip delayDuration={CHAT_INPUT_TOOLTIP_DELAY_MS}>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                onClick={onStop}
                aria-label={isStopping ? 'Force stop generation' : 'Stop generation'}
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
            </TooltipTrigger>
            <TooltipContent side="top">
              {isStopping ? 'Click again to force stop' : 'Stop generation'}
            </TooltipContent>
          </Tooltip>
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
// Live recording waveform. Each bar is one captured audio frame; bars accumulate
// from the left and grow rightward until they fill the width, then scroll (oldest
// drops off the left). Bar height tracks that frame's mic amplitude, so the
// waveform visibly reacts to how loud the user is speaking.
const WAVE_BAR_WIDTH = 3 // px
const WAVE_BAR_GAP = 2 // px
const WAVE_BAR_PITCH = WAVE_BAR_WIDTH + WAVE_BAR_GAP
const WAVE_BAR_MIN = 1.5 // px — floor so silence still shows a faint line
const WAVE_BAR_MAX = 18 // px — fits inside the h-5 (20px) row
const WAVE_CURVE = 0.8 // <1 lifts quiet speech slightly; near-linear keeps loud peaks tall

function waveBarHeight(level: number): number {
  // `level` is already auto-gained to ~0..1 in the hook, so map it close to linearly
  // (a gentle curve) — louder voice ⇒ visibly taller bar, quiet ⇒ short.
  const amp = Math.min(1, Math.max(0, level)) ** WAVE_CURVE
  return WAVE_BAR_MIN + amp * (WAVE_BAR_MAX - WAVE_BAR_MIN)
}

function VoiceWaveform({ audioLevelsRef }: { audioLevelsRef?: React.MutableRefObject<number[]> }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [bars, setBars] = useState<number[]>([])
  // How many bars fit in the current width; recomputed on resize.
  const maxBarsRef = useRef(48)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      maxBarsRef.current = Math.max(1, Math.floor(el.clientWidth / WAVE_BAR_PITCH))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!audioLevelsRef) return
    let raf = 0
    let lastSig = ''
    const tick = () => {
      const levels = audioLevelsRef.current
      const maxBars = maxBarsRef.current
      const next = levels.length > maxBars ? levels.slice(levels.length - maxBars) : levels
      // Only re-render when the visible window actually changed. Length covers
      // the growth phase; the trailing value covers the scrolling phase once full.
      const sig = `${next.length}:${next.length ? next[next.length - 1] : 0}`
      if (sig !== lastSig) {
        lastSig = sig
        setBars(next.slice())
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [audioLevelsRef])

  return (
    <div
      ref={containerRef}
      className="flex h-5 w-full items-center overflow-hidden"
      style={{ gap: `${WAVE_BAR_GAP}px` }}
    >
      {/* Each newly-appended bar mounts with `voice-bar-in` (grows + fades in) so it
          doesn't pop. Once the strip is full and values scroll through the bars, the
          height transition makes them flow smoothly instead of stepping. */}
      {bars.map((level, i) => (
        <span
          key={i}
          className="shrink-0 rounded-full bg-primary"
          style={{
            width: `${WAVE_BAR_WIDTH}px`,
            height: `${waveBarHeight(level)}px`,
            transformOrigin: 'center',
            transition: 'height 90ms linear',
            animation: 'voice-bar-in 130ms ease-out',
          }}
        />
      ))}
      <style>{`
        @keyframes voice-bar-in {
          from { transform: scaleY(0.15); opacity: 0; }
          to { transform: scaleY(1); opacity: 1; }
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
  recordingState?: 'connecting' | 'listening' | 'stopping'
  audioLevelsRef?: React.MutableRefObject<number[]>
  onStartRecording?: () => void
  onSubmitRecording?: () => void | Promise<void>
  onCancelRecording?: () => void
  voiceAvailable?: boolean
  inCall?: boolean
  onStartCall?: (preset: CallPreset) => void
  onEndCall?: () => void
  callAvailable?: boolean
  onSelectedModelChange?: (model: SelectedModel | null) => void
  onReasoningEffortChange?: (effort: ReasoningEffortLevel | null) => void
  workDir?: string | null
  onWorkDirChange?: (value: string | null) => void
  /** Set when this chat is bound to a Code-section session — freezes workdir + agent. */
  codeSessionLock?: { cwd: string; agent: 'claude' | 'codex' } | null
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
  audioLevelsRef,
  onStartRecording,
  onSubmitRecording,
  onCancelRecording,
  voiceAvailable,
  inCall,
  onStartCall,
  onEndCall,
  callAvailable,
  onSelectedModelChange,
  onReasoningEffortChange,
  workDir,
  onWorkDirChange,
  codeSessionLock,
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
        audioLevelsRef={audioLevelsRef}
        onStartRecording={onStartRecording}
        onSubmitRecording={onSubmitRecording}
        onCancelRecording={onCancelRecording}
        voiceAvailable={voiceAvailable}
        inCall={inCall}
        onStartCall={onStartCall}
        onEndCall={onEndCall}
        callAvailable={callAvailable}
        onSelectedModelChange={onSelectedModelChange}
        onReasoningEffortChange={onReasoningEffortChange}
        workDir={workDir}
        onWorkDirChange={onWorkDirChange}
        codeSessionLock={codeSessionLock}
      />
    </PromptInputProvider>
  )
}
