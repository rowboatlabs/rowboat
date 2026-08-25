import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, Download, FileIcon, FileSpreadsheet, FileText, Image, Maximize2, Music, Pause, Play, Video } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ImageLightbox, ImageOverlayButton } from '@/components/image-lightbox'
import { useFileCard } from '@/contexts/file-card-context'
import { useSidebarSection } from '@/contexts/sidebar-context'
import { isImageFilePath } from '@/lib/file-utils'
import { canOpenInApp } from '@/lib/file-types'
import { wikiLabel } from '@/lib/wiki-links'

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.ogg', '.flac', '.aac'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm'])
const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf', '.csv'])
const SPREADSHEET_EXTENSIONS = new Set(['.csv', '.tsv', '.xls', '.xlsx'])

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : ''
}

function getFileNameWithoutExt(filePath: string): string {
  const name = filePath.split('/').pop() || filePath
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function getFileCategory(ext: string): { label: string; icon: typeof FileIcon } {
  if (AUDIO_EXTENSIONS.has(ext)) return { label: 'Audio', icon: Music }
  if (IMAGE_EXTENSIONS.has(ext)) return { label: 'Image', icon: Image }
  if (VIDEO_EXTENSIONS.has(ext)) return { label: 'Video', icon: Video }
  if (DOCUMENT_EXTENSIONS.has(ext)) return { label: 'Document', icon: FileText }
  if (ext === '.md') return { label: 'Markdown', icon: FileText }
  return { label: 'File', icon: FileIcon }
}

function getExtLabel(ext: string): string {
  return ext ? ext.slice(1).toUpperCase() : ''
}

// --- Opening a card's file ---

// Workspace root fetched once per session; cards use it to map absolute paths
// back to workspace-relative ones for the in-app file view. A failed lookup
// clears the cache so the next click retries instead of degrading for good.
let workspaceRootPromise: Promise<string> | null = null
function getWorkspaceRoot(): Promise<string> {
  workspaceRootPromise ??= window.ipc.invoke('workspace:getRoot', null)
    .then((r) => r.root)
    .catch((err) => { workspaceRootPromise = null; throw err })
  return workspaceRootPromise
}

/**
 * The workspace-relative form of a card's path, or null when it isn't a
 * workspace file the app can address — an absolute path outside the root, a
 * `~`/drive-letter path, or a root lookup that failed.
 */
async function workspaceRelPath(filePath: string): Promise<string | null> {
  const isAbsolute = filePath.startsWith('/') || filePath.startsWith('~') || /^[A-Za-z]:[\\/]/.test(filePath)
  if (!isAbsolute) return filePath
  if (!filePath.startsWith('/')) return null
  try {
    const root = await getWorkspaceRoot()
    const prefix = root.endsWith('/') ? root : `${root}/`
    return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : null
  } catch {
    return null
  }
}

/**
 * Opens a card's file the way the app itself would: a workspace file whose type
 * the app can show goes to the in-app file view, so an assistant-written deck
 * lands in the slide editor rather than Keynote. Everything else — outside the
 * workspace, no in-app view, or a host surface that doesn't offer the in-app
 * route — goes to the OS opener.
 */
function useOpenFilePath(filePath: string): () => Promise<void> {
  const { onOpenFile } = useFileCard()
  return useCallback(async () => {
    if (onOpenFile && canOpenInApp(filePath)) {
      const rel = await workspaceRelPath(filePath)
      if (rel !== null) {
        onOpenFile(rel)
        return
      }
    }
    await window.ipc.invoke('shell:openPath', { path: filePath })
  }, [filePath, onOpenFile])
}

// Shared card shell used by all variants
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
      className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 pr-4 text-left transition-colors hover:bg-accent/50 cursor-pointer w-full my-2"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
      </div>
      {action}
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
      icon={<BookOpen className="h-5 w-5 text-muted-foreground" />}
      title={label}
      subtitle={extLabel ? `Knowledge \u00b7 ${extLabel}` : 'Knowledge'}
      onClick={() => { setActiveSection('knowledge'); onOpenKnowledgeFile(filePath) }}
      action={
        <Button variant="outline" size="sm" className="shrink-0 text-xs h-8 rounded-lg pointer-events-none">
          Open
        </Button>
      }
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

  const handleOpen = useOpenFilePath(filePath)

  return (
    <CardShell
      icon={
        <button
          onClick={handlePlayPause}
          disabled={isLoading}
          className="flex h-full w-full items-center justify-center"
        >
          {isPlaying
            ? <Pause className="h-5 w-5 text-muted-foreground" />
            : <Play className="h-5 w-5 text-muted-foreground" />
          }
        </button>
      }
      title={getFileNameWithoutExt(filePath)}
      subtitle={`Audio \u00b7 ${extLabel}`}
      onClick={() => { void handleOpen() }}
      action={
        <Button variant="outline" size="sm" className="shrink-0 text-xs h-8 rounded-lg pointer-events-none">
          Open
        </Button>
      }
    />
  )
}

// --- Spreadsheet File Card ---

function SpreadsheetFileCard({ filePath }: { filePath: string }) {
  const ext = getExtension(filePath)
  const extLabel = getExtLabel(ext)
  const handleOpen = useOpenFilePath(filePath)

  return (
    <CardShell
      icon={<FileSpreadsheet className="h-5 w-5 text-muted-foreground" />}
      title={getFileNameWithoutExt(filePath)}
      subtitle={`Spreadsheet · ${extLabel}`}
      onClick={() => { void handleOpen() }}
      action={
        <Button variant="outline" size="sm" className="shrink-0 text-xs h-8 rounded-lg pointer-events-none">
          Open
        </Button>
      }
    />
  )
}

// --- System File Card ---

function SystemFileCard({ filePath }: { filePath: string }) {
  const ext = getExtension(filePath)
  const isImage = IMAGE_EXTENSIONS.has(ext)
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const { label: categoryLabel, icon: CategoryIcon } = getFileCategory(ext)
  const extLabel = getExtLabel(ext)

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

  const handleOpen = useOpenFilePath(filePath)

  return (
    <CardShell
      icon={
        thumbnail
          ? <img src={thumbnail} alt="" className="h-10 w-10 rounded-lg object-cover" />
          : <CategoryIcon className="h-5 w-5 text-muted-foreground" />
      }
      title={getFileNameWithoutExt(filePath)}
      subtitle={extLabel ? `${categoryLabel} \u00b7 ${extLabel}` : categoryLabel}
      onClick={() => { void handleOpen() }}
      action={
        <Button variant="outline" size="sm" className="shrink-0 text-xs h-8 rounded-lg pointer-events-none">
          Open
        </Button>
      }
    />
  )
}

// --- Inline Image ---

function isAbsolutePath(filePath: string): boolean {
  return /^([A-Za-z]:[\\/]|\/|\\\\)/.test(filePath)
}

// ChatGPT-style bare image for image filepaths: no card chrome, just the
// picture. Clicking expands it into the lightbox; hovering reveals download
// and expand controls. Any load failure falls back to the plain
// SystemFileCard — never a broken-image glyph.
function InlineImageFile({ filePath }: { filePath: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const name = filePath.split('/').pop() || filePath

  useEffect(() => {
    let cancelled = false
    window.ipc.invoke('shell:readFileBase64', { path: filePath })
      .then((result) => {
        if (!cancelled) {
          setDataUrl(`data:${result.mimeType};base64,${result.data}`)
        }
      })
      .catch((err) => {
        console.debug('InlineImageFile: falling back to file card', filePath, err)
        if (!cancelled) setFailed(true)
      })
    return () => { cancelled = true }
  }, [filePath])

  if (failed) {
    return <SystemFileCard filePath={filePath} />
  }

  if (!dataUrl) {
    return null
  }

  const handleOpenInSystem = () => {
    void window.ipc.invoke('shell:openPath', { path: filePath })
  }

  // Save a copy through the existing workspace export handler (native save
  // dialog, copies the file itself). It resolves workspace-relative paths
  // only, so anything absolute saves the bytes already held in memory —
  // Electron's default download flow prompts for a location either way.
  const handleDownload = async () => {
    if (!isAbsolutePath(filePath)) {
      try {
        const result = await window.ipc.invoke('workspace:exportCopy', { path: filePath })
        // Cancelling the dialog is not a failure — say nothing.
        if (result.error) toast.error(`Could not save the image: ${result.error}`)
        return
      } catch (err) {
        console.debug('workspace:exportCopy unavailable; saving from memory', filePath, err)
      }
    }
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = name
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  return (
    <>
      <div className="group relative my-2 w-fit max-w-full">
        <img
          src={dataUrl}
          alt={name}
          aria-label={name}
          role="button"
          tabIndex={0}
          onClick={() => setExpanded(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(true) } }}
          onError={() => setFailed(true)}
          className="block max-h-[420px] max-w-[min(100%,480px)] w-auto rounded-2xl object-contain cursor-pointer"
        />
        <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <ImageOverlayButton label={`Download ${name}`} onClick={() => { void handleDownload() }}>
            <Download className="h-3.5 w-3.5" />
          </ImageOverlayButton>
          <ImageOverlayButton label={`Expand ${name}`} onClick={() => setExpanded(true)}>
            <Maximize2 className="h-3.5 w-3.5" />
          </ImageOverlayButton>
        </div>
      </div>
      <ImageLightbox
        open={expanded}
        onOpenChange={setExpanded}
        src={dataUrl}
        name={name}
        onDownload={() => { void handleDownload() }}
        onOpenInSystem={handleOpenInSystem}
        onError={() => { setExpanded(false); setFailed(true) }}
      />
    </>
  )
}

// --- Main FilePathCard ---

export function FilePathCard({ filePath }: { filePath: string }) {
  const trimmed = filePath.trim()

  if (trimmed.startsWith('knowledge/')) {
    return <KnowledgeFileCard filePath={trimmed} />
  }

  const ext = getExtension(trimmed)
  if (SPREADSHEET_EXTENSIONS.has(ext)) {
    return <SpreadsheetFileCard filePath={trimmed} />
  }

  if (AUDIO_EXTENSIONS.has(ext)) {
    return <AudioFileCard filePath={trimmed} />
  }

  if (isImageFilePath(trimmed)) {
    return <InlineImageFile filePath={trimmed} />
  }

  return <SystemFileCard filePath={trimmed} />
}
