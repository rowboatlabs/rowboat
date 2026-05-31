/**
 * Single source of truth for which file types the knowledge viewer renders.
 *
 * Both the App.tsx loader-skip check and the render-switch consume this so
 * adding a new extension is a one-place edit. The persistent-viewer-cache
 * also uses it to decide what to keep mounted.
 */

export type ViewerType = 'html' | 'image' | 'video' | 'audio' | 'pdf' | 'docx'

const VIEWER_BY_EXT: Record<string, ViewerType> = {
  html: 'html',
  htm: 'html',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  svg: 'image',
  avif: 'image',
  bmp: 'image',
  ico: 'image',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  m4v: 'video',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  ogg: 'audio',
  flac: 'audio',
  aac: 'audio',
  pdf: 'pdf',
  docx: 'docx',
}

function extensionOf(path: string): string {
  const lower = path.toLowerCase()
  const dot = lower.lastIndexOf('.')
  return dot >= 0 ? lower.slice(dot + 1) : ''
}

/** Returns the viewer type for a path, or null if no media viewer handles it. */
export function getViewerType(path: string): ViewerType | null {
  return VIEWER_BY_EXT[extensionOf(path)] ?? null
}

/** True if the path is rendered by one of the dedicated media viewers. */
export function isMediaPath(path: string): boolean {
  return getViewerType(path) !== null
}

/** True if the viewer for this path participates in the persistent mount cache. */
export function isCacheableViewerPath(path: string): boolean {
  const t = getViewerType(path)
  return t === 'html' || t === 'pdf'
}
