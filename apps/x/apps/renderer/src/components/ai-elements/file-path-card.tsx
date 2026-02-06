import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, ExternalLink, FileIcon, Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useFileCard } from '@/contexts/file-card-context'
import { wikiLabel } from '@/lib/wiki-links'

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.ogg', '.flac', '.aac'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'])

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : ''
}

function getFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath
}

function truncatePath(filePath: string, maxLen = 40): string {
  if (filePath.length <= maxLen) return filePath
  const parts = filePath.split('/')
  if (parts.length <= 2) return filePath
  return `.../${parts.slice(-2).join('/')}`
}

// --- Knowledge File Card ---

function KnowledgeFileCard({ filePath }: { filePath: string }) {
  const { onOpenKnowledgeFile } = useFileCard()
  const label = wikiLabel(filePath)

  return (
    <button
      onClick={() => onOpenKnowledgeFile(filePath)}
      className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 hover:bg-accent max-w-xs text-left transition-colors cursor-pointer w-full"
    >
      <BookOpen className="h-5 w-5 shrink-0 text-primary" />
      <span className="truncate text-sm font-medium">{label}</span>
    </button>
  )
}

// --- Audio File Card ---

function AudioFileCard({ filePath }: { filePath: string }) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const handlePlayPause = useCallback(async () => {
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
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 max-w-xs w-full">
      <Button
        size="icon"
        variant="ghost"
        onClick={handlePlayPause}
        disabled={isLoading}
        className="h-8 w-8 shrink-0"
      >
        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm font-medium">{getFileName(filePath)}</div>
        <div className="truncate text-xs text-muted-foreground">{truncatePath(filePath)}</div>
      </div>
      <Button
        size="icon"
        variant="ghost"
        onClick={handleOpen}
        className="h-7 w-7 shrink-0"
        title="Open externally"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

// --- System File Card ---

function SystemFileCard({ filePath }: { filePath: string }) {
  const ext = getExtension(filePath)
  const isImage = IMAGE_EXTENSIONS.has(ext)
  const [thumbnail, setThumbnail] = useState<string | null>(null)

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
    <button
      onClick={handleOpen}
      className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 hover:bg-accent max-w-xs text-left transition-colors cursor-pointer w-full"
    >
      {thumbnail ? (
        <img src={thumbnail} alt="" className="h-10 w-10 rounded object-cover shrink-0" />
      ) : (
        <FileIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
      )}
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm font-medium">{getFileName(filePath)}</div>
        <div className="truncate text-xs text-muted-foreground">{truncatePath(filePath)}</div>
      </div>
      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </button>
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
