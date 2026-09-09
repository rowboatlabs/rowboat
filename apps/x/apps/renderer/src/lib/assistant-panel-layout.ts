export interface PanelSize { width: number; height: number }
export const DEFAULT_PANEL_SIZE: PanelSize = { width: 420, height: 600 }

export function clampPanelSize(size: PanelSize, viewport: PanelSize): PanelSize {
  const maxWidth = Math.max(0, viewport.width - 88)
  const maxHeight = Math.max(0, viewport.height - 108)
  return {
    width: Math.min(maxWidth, Math.max(Math.min(320, maxWidth), Number.isFinite(size.width) ? size.width : DEFAULT_PANEL_SIZE.width)),
    height: Math.min(maxHeight, Math.max(Math.min(280, maxHeight), Number.isFinite(size.height) ? size.height : DEFAULT_PANEL_SIZE.height)),
  }
}

export function layoutAssistantPanels(ids: string[], sizes: Record<string, PanelSize>, viewport: PanelSize, reservedWidth = 0, preferredId?: string) {
  const result: Record<string, PanelSize & { right: number }> = {}
  const ordered = [...new Set(ids)].reverse()
  const priority = preferredId && ordered.includes(preferredId) ? [preferredId, ...ordered.filter((id) => id !== preferredId)] : ordered
  const selected = new Map<string, PanelSize>()
  let used = 12 + reservedWidth
  for (const id of priority) {
    const size = clampPanelSize(sizes[id] ?? DEFAULT_PANEL_SIZE, { ...viewport, width: viewport.width - reservedWidth })
    if (used + size.width > viewport.width - 64) continue
    selected.set(id, size)
    used += size.width + 12
  }
  let right = 12 + reservedWidth
  for (const id of ordered) {
    const size = selected.get(id)
    if (!size) continue
    result[id] = { ...size, right }
    right += size.width + 12
  }
  return result
}

export function restorePanelPreferences(raw: string | null): { sizes: Record<string, PanelSize>; expanded: string[]; docked: string | null } {
  const fallback = { sizes: {}, expanded: [], docked: null }
  try {
    const value = JSON.parse(raw ?? 'null')
    if (!value || typeof value !== 'object') return fallback
    const sizes: Record<string, PanelSize> = {}
    if (value.sizes && typeof value.sizes === 'object') {
      for (const [id, size] of Object.entries(value.sizes)) {
        if (!size || typeof size !== 'object' || !('width' in size) || !('height' in size)) continue
        if (typeof size.width === 'number' && typeof size.height === 'number' && Number.isFinite(size.width) && Number.isFinite(size.height)) sizes[id] = { width: size.width, height: size.height }
      }
    }
    return { sizes, expanded: Array.isArray(value.expanded) ? value.expanded.filter((id: unknown): id is string => typeof id === 'string') : [], docked: typeof value.docked === 'string' ? value.docked : null }
  } catch { return fallback }
}
