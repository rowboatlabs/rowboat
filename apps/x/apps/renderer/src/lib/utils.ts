import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Compact an absolute path to a right-anchored tail of whole segments within
 * `max` characters: "/Users/arjun/Work/space/rowboat/apps/x" → "…/rowboat/apps/x".
 * Same-named folders in different places stay tellable-apart without the UI
 * carrying the full path. Returns the path unchanged when it already fits.
 */
export function compactPath(p: string, max = 28): string {
  const normalized = p.replace(/\/+$/, '')
  if (normalized.length <= max) return normalized
  const parts = normalized.split('/').filter(Boolean)
  let tail = ''
  for (let i = parts.length - 1; i >= 0; i--) {
    const next = `/${parts[i]}${tail}`
    // Always keep at least the final segment, even when it alone overflows.
    if (tail && next.length > max - 1) break
    tail = next
  }
  return `…${tail}`
}

/** The directory containing `p` — for "name + where it lives" labels. */
export function parentPath(p: string): string {
  const normalized = p.replace(/\/+$/, '')
  const idx = normalized.lastIndexOf('/')
  return idx > 0 ? normalized.slice(0, idx) : ''
}

