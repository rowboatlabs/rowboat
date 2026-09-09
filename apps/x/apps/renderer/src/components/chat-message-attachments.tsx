import {
  AudioLines,
  FileArchive,
  FileCode2,
  FileIcon,
  FileSpreadsheet,
  FileText,
  FileVideo,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { ImageLightbox } from '@/components/image-lightbox'
import type { MessageAttachment } from '@/lib/chat-conversation'
import {
  type AttachmentIconKind,
  getAttachmentDisplayName,
  getAttachmentIconKind,
  getAttachmentToneClass,
  getAttachmentTypeLabel,
} from '@/lib/attachment-presentation'
import { isImageMime, toFileUrl } from '@/lib/file-utils'
import { cn } from '@/lib/utils'

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

function useAttachmentImage(attachment?: MessageAttachment) {
  const path = attachment?.path
  const thumbnailUrl = attachment?.thumbnailUrl
  const mimeType = attachment?.mimeType
  const fallbackFileUrl = useMemo(() => path ? toFileUrl(path) : '', [path])
  const [loaded, setLoaded] = useState<{ path: string; src: string } | null>(null)

  useEffect(() => {
    if (!path || thumbnailUrl) return
    let cancelled = false
    window.ipc.invoke('shell:readFileBase64', { path })
      .then((result) => {
        if (!cancelled) setLoaded({ path, src: `data:${result.mimeType || mimeType || 'image/*'};base64,${result.data}` })
      })
      .catch(() => { /* Keep the file URL if the read fails. */ })
    return () => { cancelled = true }
  }, [path, thumbnailUrl, mimeType])

  return thumbnailUrl || (loaded?.path === path ? loaded?.src : undefined) || fallbackFileUrl
}

function ImageAttachmentPreview({ attachment, onOpen }: { attachment: MessageAttachment; onOpen: () => void }) {
  const src = useAttachmentImage(attachment)
  const name = getAttachmentDisplayName(attachment)
  return (
    <button type="button" aria-label={`Preview ${name}`} onClick={onOpen} className="rounded-2xl cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <img
        src={src}
        alt={name}
        className="h-44 w-auto max-w-[300px] rounded-2xl border border-border/70 bg-muted object-cover"
      />
    </button>
  )
}

interface ChatMessageAttachmentsProps {
  attachments: MessageAttachment[]
  className?: string
}

export function ChatMessageAttachments({ attachments, className }: ChatMessageAttachmentsProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const videoFrames = attachments.filter((attachment) => attachment.isVideoFrame)
  const imageAttachments = attachments.filter(
    (attachment) => !attachment.isVideoFrame && isImageMime(attachment.mimeType)
  )
  const fileAttachments = attachments.filter(
    (attachment) => !attachment.isVideoFrame && !isImageMime(attachment.mimeType)
  )

  const selected = selectedIndex === null ? undefined : imageAttachments[selectedIndex]
  const selectedSrc = useAttachmentImage(selected)
  const selectedName = selected ? getAttachmentDisplayName(selected) : ''

  if (attachments.length === 0) return null

  return (
    <div className={cn('flex flex-col items-end gap-2', className)}>
      {videoFrames.length > 0 && (
        <div className="flex max-w-[340px] flex-wrap justify-end gap-1">
          {videoFrames.map((frame, index) => (
            <img
              key={`frame-${index}`}
              src={frame.thumbnailUrl}
              alt={`Camera frame ${index + 1}`}
              className="h-12 w-auto rounded-md border border-border/60 bg-muted object-cover"
            />
          ))}
        </div>
      )}
      {imageAttachments.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {imageAttachments.map((attachment, index) => (
            <ImageAttachmentPreview key={`${attachment.path}-${index}`} attachment={attachment} onOpen={() => setSelectedIndex(index)} />
          ))}
        </div>
      )}
      <ImageLightbox
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open) setSelectedIndex(null) }}
        src={selectedSrc}
        name={selectedName}
        onDownload={() => {
          const link = document.createElement('a')
          link.href = selectedSrc
          link.download = selectedName
          document.body.appendChild(link)
          link.click()
          link.remove()
        }}
        onOpenInSystem={() => { if (selected) void window.ipc.invoke('shell:openPath', { path: selected.path }) }}
        navigation={{
          index: selectedIndex ?? 0,
          count: imageAttachments.length,
          onPrevious: () => setSelectedIndex((index) => index === null ? null : Math.max(0, index - 1)),
          onNext: () => setSelectedIndex((index) => index === null ? null : Math.min(imageAttachments.length - 1, index + 1)),
        }}
      />
      {fileAttachments.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {fileAttachments.map((attachment, index) => {
            const Icon = getAttachmentIcon(getAttachmentIconKind(attachment))
            const attachmentName = getAttachmentDisplayName(attachment)
            const attachmentType = getAttachmentTypeLabel(attachment)
            return (
              <span
                key={`${attachment.path}-${index}`}
                className="inline-flex min-w-[240px] max-w-[440px] items-center gap-3 rounded-2xl border border-border/50 bg-muted/75 px-3 py-2.5 text-sm text-foreground"
                title={attachmentName}
              >
                <span
                  className={cn(
                    'flex size-12 shrink-0 items-center justify-center rounded-xl',
                    getAttachmentToneClass(attachmentType)
                  )}
                >
                  <Icon className="size-6 shrink-0" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm leading-tight font-medium">{attachmentName}</span>
                  <span className="block pt-0.5 text-xs leading-tight text-muted-foreground">{attachmentType}</span>
                </span>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
