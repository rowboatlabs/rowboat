import type { spaces } from '@x/shared'
import { blobAppUrl } from './spaces-presentation'
import { toast } from './toast'

type FileInfo = Pick<spaces.SpacesAssetEntry, 'path' | 'blob'>
type FileRef = { orgId: string; spaceId: string; assetId: string }

const TEXT_EXTENSIONS = new Set([
  'md', 'markdown', 'mdx', 'txt', 'text', 'log', 'csv', 'tsv',
  'json', 'jsonl', 'yaml', 'yml', 'toml', 'xml', 'html', 'htm', 'css', 'scss',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java',
  'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'sql',
  'ini', 'cfg', 'conf', 'env', 'excalidraw',
])

/** Inline documents are text; uploaded files need a text MIME type or a known extension. */
export function spaceFileCopyLabel(file: FileInfo): 'Copy Markdown' | 'Copy content' | null {
  const name = file.path.split('/').pop()?.toLowerCase() ?? ''
  const ext = name.split('.').pop() ?? ''
  const mime = file.blob?.mime.split(';')[0].trim().toLowerCase()
  // SVG is source text, but is presented as an image alongside the other binary previews.
  if (mime?.startsWith('image/') || mime?.startsWith('audio/') || mime?.startsWith('video/')) return null
  const textMime = mime?.startsWith('text/') || mime === 'application/json' || mime === 'application/xml'
    || mime === 'application/javascript' || mime === 'application/x-yaml'
    || mime?.endsWith('+json') || mime?.endsWith('+xml')
  const genericMime = !mime || mime === 'application/octet-stream'
  const knownText = TEXT_EXTENSIONS.has(ext) || /^(readme|license|dockerfile|makefile)$/.test(name)
  if (file.blob && !textMime && !(genericMime && knownText)) return null
  return ext === 'md' || ext === 'markdown' || ext === 'mdx' || mime === 'text/markdown'
    ? 'Copy Markdown' : 'Copy content'
}

export async function copySpaceFile(ref: FileRef): Promise<void> {
  try {
    const asset = await window.ipc.invoke('spaces:readAsset', ref)
    const label = spaceFileCopyLabel(asset)
    if (!label) throw new Error('This file cannot be copied as text')
    let content = asset.content
    if (asset.blob) {
      const response = await fetch(blobAppUrl(ref, asset.blob.hash))
      if (!response.ok) throw new Error('Could not load file contents')
      content = await response.text()
    }
    await navigator.clipboard.writeText(content)
    toast(label === 'Copy Markdown' ? 'Markdown copied' : 'Content copied', 'success')
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Could not copy file contents', 'error')
  }
}

export async function downloadSpaceFile(ref: FileRef): Promise<void> {
  try {
    const result = await window.ipc.invoke('spaces:saveAsset', ref)
    if (result.saved) toast('Saved', 'success')
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Could not download', 'error')
  }
}
