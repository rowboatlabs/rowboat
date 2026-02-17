import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, LoaderIcon, Paperclip, Plus, Square, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
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
  mediaType: string
  isImage: boolean
  size: number
  thumbnailUrl?: string
}

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024 // 10MB

interface ChatInputInnerProps {
  onSubmit: (message: PromptInputMessage, mentions?: FileMention[], attachments?: StagedAttachment[]) => void
  onStop?: () => void
  isProcessing: boolean
  isStopping?: boolean
  isActive: boolean
  presetMessage?: string
  onPresetMessageConsumed?: () => void
  runId?: string | null
  initialDraft?: string
  onDraftChange?: (text: string) => void
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
}: ChatInputInnerProps) {
  const controller = usePromptInputController()
  const message = controller.textInput.value
  const [attachments, setAttachments] = useState<StagedAttachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canSubmit = (Boolean(message.trim()) || attachments.length > 0) && !isProcessing

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
          mediaType: mime,
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
    }
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id))
  }, [])

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return
    onSubmit({ text: message.trim(), files: [] }, controller.mentions.mentions, attachments)
    controller.textInput.clear()
    controller.mentions.clearMentions()
    setAttachments([])
  }, [attachments, canSubmit, controller, message, onSubmit])

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
        <div className="flex flex-wrap gap-1.5 px-4 pb-1 pt-3">
          {attachments.map((attachment) => (
            <span
              key={attachment.id}
              className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
            >
              {attachment.isImage && attachment.thumbnailUrl ? (
                <img src={attachment.thumbnailUrl} alt="" className="size-4 rounded object-cover" />
              ) : (
                <Paperclip className="size-3" />
              )}
              <span className="max-w-[120px] truncate">{attachment.filename}</span>
              <button
                type="button"
                onClick={() => removeAttachment(attachment.id)}
                className="transition-colors hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 px-4 py-4">
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
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Attach files"
        >
          <Plus className="h-4 w-4" />
        </button>
        <PromptInputTextarea
          placeholder="Type your message..."
          onKeyDown={handleKeyDown}
          autoFocus={isActive}
          focusTrigger={isActive ? runId : undefined}
          className="min-h-6 rounded-none border-0 py-0 shadow-none focus-visible:ring-0"
        />
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
      />
    </PromptInputProvider>
  )
}
