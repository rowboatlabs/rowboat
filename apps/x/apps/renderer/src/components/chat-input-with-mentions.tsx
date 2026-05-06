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
  FolderCog,
  Globe,
  Headphones,
  ImagePlus,
  LoaderIcon,
  Mic,
  Plus,
  Square,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
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

export interface SelectedModel {
  provider: string
  model: string
}

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

interface ChatInputInnerProps {
  onSubmit: (message: PromptInputMessage, mentions?: FileMention[], attachments?: StagedAttachment[], searchEnabled?: boolean) => void
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
  const [workDir, setWorkDir] = useState<string | null>(null)

  // When a run exists, freeze the dropdown to the run's resolved model+provider.
  useEffect(() => {
    if (!runId) {
      setLockedModel(null)
      return
    }
    let cancelled = false
    window.ipc.invoke('runs:fetch', { runId }).then((run) => {
      if (cancelled) return
      if (run.provider && run.model) {
        setLockedModel({ provider: run.provider, model: run.model })
      }
    }).catch(() => { /* legacy run or fetch failure — leave unlocked */ })
    return () => { cancelled = true }
  }, [runId])

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

  // Load currently configured work directory
  const loadWorkDir = useCallback(async () => {
    try {
      const result = await window.ipc.invoke('workspace:readFile', { path: 'config/workdir.json' })
      const parsed = JSON.parse(result.data)
      const value = typeof parsed?.path === 'string' ? parsed.path.trim() : ''
      setWorkDir(value || null)
    } catch {
      setWorkDir(null)
    }
  }, [])

  useEffect(() => {
    loadWorkDir()
  }, [isActive, loadWorkDir])

  const handleSetWorkDir = useCallback(async () => {
    try {
      const { path: chosen } = await window.ipc.invoke('dialog:openDirectory', {
        title: 'Choose work directory',
        defaultPath: workDir ?? undefined,
      })
      if (!chosen) return
      await window.ipc.invoke('workspace:writeFile', {
        path: 'config/workdir.json',
        data: JSON.stringify({ path: chosen }, null, 2),
      })
      setWorkDir(chosen)
      toast.success(`Work directory set: ${chosen}`)
    } catch (err) {
      console.error('Failed to set work directory', err)
      toast.error('Failed to set work directory')
    }
  }, [workDir])

  const handleClearWorkDir = useCallback(async () => {
    try {
      await window.ipc.invoke('workspace:writeFile', {
        path: 'config/workdir.json',
        data: JSON.stringify({}, null, 2),
      })
      setWorkDir(null)
      toast.success('Work directory cleared')
    } catch (err) {
      console.error('Failed to clear work directory', err)
      toast.error('Failed to clear work directory')
    }
  }, [])

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
    onSubmit({ text: message.trim(), files: [] }, controller.mentions.mentions, attachments, searchEnabled || undefined)
    controller.textInput.clear()
    controller.mentions.clearMentions()
    setAttachments([])
    setSearchEnabled(false)
  }, [attachments, canSubmit, controller, message, onSubmit, searchEnabled])

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

  return (
    <div className="rounded-lg border border-border bg-background shadow-none">
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
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Add"
            >
              <Plus className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
              <ImagePlus className="size-4" />
              <span>Add files or photos</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { void handleSetWorkDir() }}>
              <FolderCog className="size-4" />
              <span>{workDir ? 'Change work directory' : 'Set work directory'}</span>
            </DropdownMenuItem>
            {workDir && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => { void handleClearWorkDir() }}>
                  <X className="size-4" />
                  <span>Clear work directory</span>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {workDir && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleSetWorkDir}
                className="flex h-7 max-w-[180px] shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <FolderCog className="h-3.5 w-3.5" />
                <span className="truncate">{workDir.split('/').pop() || workDir}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              Work directory: {workDir}
            </TooltipContent>
          </Tooltip>
        )}
        {searchAvailable && (
          searchEnabled ? (
            <button
              type="button"
              onClick={() => setSearchEnabled(false)}
              className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 text-blue-600 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-400 dark:hover:bg-blue-900"
            >
              <Globe className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">Search</span>
              <X className="h-3 w-3" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSearchEnabled(true)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Search"
            >
              <Globe className="h-4 w-4" />
            </button>
          )
        )}
        <div className="flex-1" />
        {lockedModel ? (
          <span
            className="flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground"
            title={`${providerDisplayNames[lockedModel.provider] || lockedModel.provider} — fixed for this chat`}
          >
            <span className="max-w-[150px] truncate">{getSelectedModelDisplayName(lockedModel.model)}</span>
          </span>
        ) : configuredModels.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <span className="max-w-[150px] truncate">
                  {getSelectedModelDisplayName(configuredModels.find((m) => `${m.provider}/${m.model}` === activeModelKey)?.model || configuredModels[0]?.model || 'Model')}
                </span>
                <ChevronDown className="h-3 w-3" />
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
  onSubmit: (message: PromptInputMessage, mentions?: FileMention[], attachments?: StagedAttachment[]) => void
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
      />
    </PromptInputProvider>
  )
}
