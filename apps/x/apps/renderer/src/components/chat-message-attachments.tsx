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

function ImageAttachmentPreview({ attachment }: { attachment: MessageAttachment }) {
  const fallbackFileUrl = useMemo(() => toFileUrl(attachment.path), [attachment.path])
  const [src, setSrc] = useState(attachment.thumbnailUrl || fallbackFileUrl)
  const [triedBase64, setTriedBase64] = useState(Boolean(attachment.thumbnailUrl))

  useEffect(() => {
    const nextSrc = attachment.thumbnailUrl || fallbackFileUrl
    setSrc(nextSrc)
    setTriedBase64(Boolean(attachment.thumbnailUrl))
  }, [attachment.thumbnailUrl, fallbackFileUrl])

  const loadBase64 = useMemo(
    () => async () => {
      try {
        const result = await window.ipc.invoke('shell:readFileBase64', { path: attachment.path })
        const mimeType = result.mimeType || attachment.mimeType || 'image/*'
        setSrc(`data:${mimeType};base64,${result.data}`)
      } catch {
        // Keep current src; fallback rendering (broken image icon) is better than crashing.
      }
    },
    [attachment.mimeType, attachment.path]
  )

  useEffect(() => {
    if (attachment.thumbnailUrl || triedBase64) return
    setTriedBase64(true)
    void loadBase64()
  }, [attachment.thumbnailUrl, loadBase64, triedBase64])

  return (
    <img
      src={src}
      alt="Image attachment"
      className="h-44 w-auto max-w-[300px] rounded-2xl border border-border/70 bg-muted object-cover"
      onError={() => {
        if (triedBase64) return
        setTriedBase64(true)
        void loadBase64()
      }}
    />
  )
}

interface ChatMessageAttachmentsProps {
  attachments: MessageAttachment[]
  className?: string
}

export function ChatMessageAttachments({ attachments, className }: ChatMessageAttachmentsProps) {
  if (attachments.length === 0) return null

  const imageAttachments = attachments.filter((attachment) => isImageMime(attachment.mimeType))
  const fileAttachments = attachments.filter((attachment) => !isImageMime(attachment.mimeType))

  return (
    <div className={cn('flex flex-col items-end gap-2', className)}>
      {imageAttachments.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {imageAttachments.map((attachment, index) => (
            <ImageAttachmentPreview key={`${attachment.path}-${index}`} attachment={attachment} />
          ))}
        </div>
      )}
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
