import { getExtension } from '@/lib/file-utils'

export type AttachmentLike = {
  filename?: string
  path: string
  mimeType: string
}

export type AttachmentIconKind =
  | 'audio'
  | 'video'
  | 'spreadsheet'
  | 'archive'
  | 'code'
  | 'text'
  | 'file'

const ARCHIVE_EXTENSIONS = new Set([
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz',
])

const SPREADSHEET_EXTENSIONS = new Set([
  'csv', 'tsv', 'xls', 'xlsx',
])

const CODE_EXTENSIONS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'json', 'yaml', 'yml', 'toml', 'xml',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'cpp', 'h', 'hpp',
  'cs', 'php', 'swift', 'sh', 'sql', 'html', 'css', 'scss', 'md',
])

export function getAttachmentDisplayName(attachment: AttachmentLike): string {
  if (attachment.filename) return attachment.filename
  const fromPath = attachment.path.split(/[\\/]/).pop()
  return fromPath || attachment.path
}

export function getAttachmentTypeLabel(attachment: AttachmentLike): string {
  const ext = getExtension(getAttachmentDisplayName(attachment))
  if (ext) return ext.toUpperCase()

  const mediaType = attachment.mimeType.toLowerCase()
  if (mediaType.startsWith('audio/')) return 'AUDIO'
  if (mediaType.startsWith('video/')) return 'VIDEO'
  if (mediaType.startsWith('text/')) return 'TEXT'
  if (mediaType.startsWith('image/')) return 'IMAGE'

  const [, subtypeRaw = 'file'] = mediaType.split('/')
  const subtype = subtypeRaw.split(';')[0].split('+').pop() || 'file'
  const cleaned = subtype.replace(/[^a-z0-9]/gi, '')
  return cleaned ? cleaned.toUpperCase() : 'FILE'
}

export function getAttachmentIconKind(attachment: AttachmentLike): AttachmentIconKind {
  const mediaType = attachment.mimeType.toLowerCase()
  const ext = getExtension(attachment.filename || attachment.path)

  if (mediaType.startsWith('audio/')) return 'audio'
  if (mediaType.startsWith('video/')) return 'video'
  if (mediaType.includes('spreadsheet') || SPREADSHEET_EXTENSIONS.has(ext)) return 'spreadsheet'
  if (mediaType.includes('zip') || mediaType.includes('compressed') || ARCHIVE_EXTENSIONS.has(ext)) return 'archive'
  if (
    mediaType.includes('json')
    || mediaType.includes('javascript')
    || mediaType.includes('typescript')
    || mediaType.includes('xml')
    || CODE_EXTENSIONS.has(ext)
  ) {
    return 'code'
  }
  if (mediaType.startsWith('text/') || mediaType.includes('pdf') || mediaType.includes('document')) {
    return 'text'
  }

  return 'file'
}

export function getAttachmentToneClass(typeLabel: string): string {
  switch (typeLabel) {
    case 'PDF':
      return 'bg-red-500 text-white'
    case 'CSV':
    case 'XLS':
    case 'XLSX':
    case 'TSV':
      return 'bg-emerald-500 text-white'
    case 'ZIP':
    case 'RAR':
    case '7Z':
    case 'TAR':
    case 'GZ':
      return 'bg-amber-500 text-white'
    case 'MP3':
    case 'WAV':
    case 'M4A':
    case 'FLAC':
    case 'AAC':
      return 'bg-fuchsia-500 text-white'
    case 'MP4':
    case 'MOV':
    case 'AVI':
    case 'WEBM':
      return 'bg-violet-500 text-white'
    default:
      return 'bg-primary/85 text-primary-foreground'
  }
}
