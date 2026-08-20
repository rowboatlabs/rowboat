/**
 * Single source of truth for which file types the knowledge viewer renders.
 *
 * Both the App.tsx loader-skip check and the render-switch consume this so
 * adding a new extension is a one-place edit. The persistent-viewer-cache
 * also uses it to decide what to keep mounted.
 */

export type ViewerType = 'html' | 'image' | 'video' | 'audio' | 'pdf' | 'docx' | 'pptx'

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
  pptx: 'pptx',
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

/**
 * True if the app itself can show this path — the same set the file-view
 * router mounts: the markdown editor, the persistent HTML/PDF cache, and the
 * dedicated media viewers (image/video/audio/docx/pptx).
 *
 * File cards use this to choose between the in-app route and the OS opener, so
 * a card and the router can't drift: anything this returns true for lands on a
 * real viewer, and anything else is better off in the user's own app.
 */
export function canOpenInApp(path: string): boolean {
  return path.endsWith('.md') || getViewerType(path) !== null
}

/** True if the viewer for this path participates in the persistent mount cache. */
export function isCacheableViewerPath(path: string): boolean {
  const t = getViewerType(path)
  return t === 'html' || t === 'pdf'
}
