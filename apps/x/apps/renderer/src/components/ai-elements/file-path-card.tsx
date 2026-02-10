import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, FileIcon, FileText, Image, Music, Pause, Play, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useFileCard } from '@/contexts/file-card-context'
import { useSidebarSection } from '@/contexts/sidebar-context'
import { wikiLabel } from '@/lib/wiki-links'

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.ogg', '.flac', '.aac'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm'])
const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf', '.csv'])

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

  const handleOpen = async () => {
    await window.ipc.invoke('shell:openPath', { path: filePath })
  }

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
      onClick={handleOpen}
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

  const handleOpen = async () => {
    await window.ipc.invoke('shell:openPath', { path: filePath })
  }

  return (
    <CardShell
      icon={
        thumbnail
          ? <img src={thumbnail} alt="" className="h-10 w-10 rounded-lg object-cover" />
          : <CategoryIcon className="h-5 w-5 text-muted-foreground" />
      }
      title={getFileNameWithoutExt(filePath)}
      subtitle={extLabel ? `${categoryLabel} \u00b7 ${extLabel}` : categoryLabel}
      onClick={handleOpen}
      action={
        <Button variant="outline" size="sm" className="shrink-0 text-xs h-8 rounded-lg pointer-events-none">
          Open
        </Button>
      }
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
