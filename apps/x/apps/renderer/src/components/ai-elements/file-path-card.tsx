import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderOpen, Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useFileCard } from '@/contexts/file-card-context'
import { useSidebarSection } from '@/contexts/sidebar-context'
import { wikiLabel } from '@/lib/wiki-links'
import { cn } from '@/lib/utils'

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.ogg', '.flac', '.aac'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm'])
const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.txt', '.rtf'])
const SPREADSHEET_EXTENSIONS = new Set(['.csv', '.tsv', '.xls', '.xlsx'])
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.rar', '.7z', '.tar', '.gz'])
const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.json', '.yaml', '.yml', '.toml', '.xml',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.sh', '.sql', '.html', '.css',
])

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : ''
}

function getFileNameWithoutExt(filePath: string): string {
  const name = filePath.split('/').pop() || filePath
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function getCategoryLabel(ext: string): string {
  if (AUDIO_EXTENSIONS.has(ext)) return 'Audio'
  if (IMAGE_EXTENSIONS.has(ext)) return 'Image'
  if (VIDEO_EXTENSIONS.has(ext)) return 'Video'
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'Document'
  if (SPREADSHEET_EXTENSIONS.has(ext)) return 'Spreadsheet'
  if (ARCHIVE_EXTENSIONS.has(ext)) return 'Archive'
  if (ext === '.md') return 'Markdown'
  if (CODE_EXTENSIONS.has(ext)) return 'Code'
  return 'File'
}

function getExtLabel(ext: string): string {
  return ext ? ext.slice(1).toUpperCase() : ''
}

/** Accent color for the extension label on the page glyph, by file type. */
function extAccentClass(ext: string): string {
  if (ext === '.pdf') return 'text-red-600 dark:text-red-400'
  if (SPREADSHEET_EXTENSIONS.has(ext)) return 'text-emerald-600 dark:text-emerald-400'
  if (AUDIO_EXTENSIONS.has(ext)) return 'text-fuchsia-600 dark:text-fuchsia-400'
  if (VIDEO_EXTENSIONS.has(ext)) return 'text-violet-600 dark:text-violet-400'
  if (ARCHIVE_EXTENSIONS.has(ext)) return 'text-amber-600 dark:text-amber-400'
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'text-blue-600 dark:text-blue-400'
  return 'text-muted-foreground'
}

/**
 * A small document-page glyph with a folded corner. Shows the file's
 * extension (colored by type) — or arbitrary content (audio play button).
 */
function PageGlyph({ ext, children }: { ext?: string; children?: React.ReactNode }) {
  return (
    <div className="relative flex h-11 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background shadow-xs dark:bg-muted/60">
      <div
        className="absolute -right-px -top-px size-3 rounded-bl-md border-b border-l border-border bg-muted"
        aria-hidden
      />
      {children ?? (
        <span className={cn('text-[8.5px] font-bold tracking-wider', ext ? extAccentClass(ext) : 'text-muted-foreground')}>
          {ext ? getExtLabel(ext) : 'FILE'}
        </span>
      )}
    </div>
  )
}

// Shared card shell used by all variants: page glyph, two-line text block,
// always-visible Open plus a hover-revealed reveal-in-Finder action.
function CardShell({
  icon,
  title,
  subtitle,
  onClick,
  action,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  onClick?: () => void
  action?: React.ReactNode
}) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
      title={title}
      className="group my-2 flex w-full cursor-pointer items-center gap-3.5 rounded-xl border border-border/60 bg-card py-3 pl-3.5 pr-3 text-left transition-all hover:border-border hover:bg-accent/40 hover:shadow-sm"
    >
      {icon}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium leading-tight text-foreground">{title}</div>
        <div className="truncate pt-0.5 text-[11.5px] leading-tight text-muted-foreground">{subtitle}</div>
      </div>
      {action}
    </div>
  )
}

function OpenAction({ filePath, showReveal }: { filePath: string; showReveal?: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {showReveal && (
        <button
          type="button"
          title="Reveal in Finder"
          aria-label="Reveal in Finder"
          onClick={(e) => {
            e.stopPropagation()
            void window.ipc.invoke('shell:showItemInFolder', { path: filePath })
          }}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
        >
          <FolderOpen className="size-4" />
        </button>
      )}
      <Button variant="outline" size="sm" className="pointer-events-none h-8 shrink-0 rounded-lg text-xs">
        Open
      </Button>
    </div>
  )
}

// --- Knowledge File Card ---

function KnowledgeFileCard({ filePath }: { filePath: string }) {
  const { onOpenKnowledgeFile } = useFileCard()
  const { setActiveSection } = useSidebarSection()
  const label = wikiLabel(filePath)
  const ext = getExtension(filePath)
  const extLabel = getExtLabel(ext)

  return (
    <CardShell
      icon={<PageGlyph ext={ext} />}
      title={label}
      subtitle={extLabel ? `Knowledge · ${extLabel}` : 'Knowledge'}
      onClick={() => { setActiveSection('knowledge'); onOpenKnowledgeFile(filePath) }}
      action={<OpenAction filePath={filePath} />}
    />
  )
}

// --- Audio File Card ---

function AudioFileCard({ filePath }: { filePath: string }) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const ext = getExtension(filePath)
  const extLabel = getExtLabel(ext)

  const handlePlayPause = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isPlaying && audioRef.current) {
      audioRef.current.pause()
      setIsPlaying(false)
      return
    }

    if (!audioRef.current) {
      setIsLoading(true)
      try {
        const result = await window.ipc.invoke('shell:readFileBase64', { path: filePath })
        const dataUrl = `data:${result.mimeType};base64,${result.data}`
        const audio = new Audio(dataUrl)
        audio.addEventListener('ended', () => setIsPlaying(false))
        audioRef.current = audio
      } catch (err) {
        console.error('Failed to load audio:', err)
        setIsLoading(false)
        return
      }
      setIsLoading(false)
    }

    audioRef.current.play()
    setIsPlaying(true)
  }, [filePath, isPlaying])

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

  const handleOpen = async () => {
    await window.ipc.invoke('shell:openPath', { path: filePath })
  }

  return (
    <CardShell
      icon={
        <PageGlyph ext={ext}>
          <button
            onClick={handlePlayPause}
            disabled={isLoading}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="flex h-full w-full items-center justify-center text-foreground"
          >
            {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
        </PageGlyph>
      }
      title={getFileNameWithoutExt(filePath)}
      subtitle={`Audio · ${extLabel}`}
      onClick={handleOpen}
      action={<OpenAction filePath={filePath} showReveal />}
    />
  )
}

// --- System File Card ---

function SystemFileCard({ filePath }: { filePath: string }) {
  const ext = getExtension(filePath)
  const isImage = IMAGE_EXTENSIONS.has(ext)
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const categoryLabel = getCategoryLabel(ext)
  const extLabel = getExtLabel(ext)
  // PDFs open in Rowboat's own viewer (a file tab with the chat alongside);
  // everything else still hands off to the OS.
  const { onOpenKnowledgeFile: openInApp } = useFileCard()
  const isPdf = ext === '.pdf'

  useEffect(() => {
    if (!isImage) return
    let cancelled = false
    window.ipc.invoke('shell:readFileBase64', { path: filePath })
      .then((result) => {
        if (!cancelled) {
          setThumbnail(`data:${result.mimeType};base64,${result.data}`)
        }
      })
      .catch(() => {/* ignore thumbnail failures */})
    return () => { cancelled = true }
  }, [filePath, isImage])

  const handleOpen = async () => {
    if (isPdf) {
      openInApp(filePath)
      return
    }
    await window.ipc.invoke('shell:openPath', { path: filePath })
  }

  return (
    <CardShell
      icon={
        thumbnail
          ? <img src={thumbnail} alt="" className="h-11 w-11 shrink-0 rounded-md border border-border object-cover" />
          : <PageGlyph ext={ext} />
      }
      title={getFileNameWithoutExt(filePath)}
      subtitle={extLabel ? `${categoryLabel} · ${extLabel}` : categoryLabel}
      onClick={handleOpen}
      action={<OpenAction filePath={filePath} showReveal />}
    />
  )
}

// --- Main FilePathCard ---

export function FilePathCard({ filePath }: { filePath: string }) {
  const trimmed = filePath.trim()

  if (trimmed.startsWith('knowledge/')) {
    return <KnowledgeFileCard filePath={trimmed} />
  }

  const ext = getExtension(trimmed)
  if (AUDIO_EXTENSIONS.has(ext)) {
    return <AudioFileCard filePath={trimmed} />
  }

  return <SystemFileCard filePath={trimmed} />
}
