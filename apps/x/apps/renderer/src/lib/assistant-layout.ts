import { useCallback, useEffect, useReducer } from 'react'
import { readAssistantPreference, writeAssistantPreference } from './assistant-dock'

export type ChatLocation = 'assistant' | 'sidebar' | 'floating'
export interface WindowSize { width: number; height: number }
/** Floating windows sit in a row above the bottom strip (Gmail compose style):
 *  each keeps its own size; its position follows its place in the strip. */
export interface FloatingChat extends WindowSize { id: string; minimized: boolean; layer: number }
export interface AssistantLayout {
  assistant: string | null
  sidebar: string | null
  /** The sidebar can be hidden while retaining the conversation it owns. */
  sidebarVisible: boolean
  floating: FloatingChat[]
  focused: string | null
}
export type LayoutAction =
  | { type: 'place'; id: string; location: ChatLocation; replacing?: string; size: WindowSize }
  | { type: 'close'; id: string }
  | { type: 'focus'; id: string }
  | { type: 'hide-sidebar' }
  | { type: 'show-sidebar' }
  | { type: 'minimize'; id: string }
  | { type: 'resize'; id: string; size: WindowSize }
  | { type: 'reorder'; id: string; index: number }

export function initialAssistantLayout(id: string): AssistantLayout {
  return { assistant: id, sidebar: null, sidebarVisible: false, floating: [], focused: id }
}

export function chatLocation(layout: AssistantLayout, id: string): ChatLocation | null {
  if (layout.assistant === id) return 'assistant'
  if (layout.sidebar === id) return 'sidebar'
  return layout.floating.some((entry) => entry.id === id) ? 'floating' : null
}

export function assistantLayoutReducer(state: AssistantLayout, action: LayoutAction): AssistantLayout {
  const layer = Math.max(0, ...state.floating.map((entry) => entry.layer)) + 1
  switch (action.type) {
    case 'place': {
      const previous = state.floating.find((entry) => entry.id === (action.replacing ?? action.id))
      const next = {
        ...state,
        assistant: state.assistant === action.id ? null : state.assistant,
        sidebar: state.sidebar === action.id ? null : state.sidebar,
        sidebarVisible: state.sidebar === action.id ? false : state.sidebarVisible,
        floating: state.floating.filter((entry) => entry.id !== action.id && entry.id !== action.replacing),
        focused: action.id,
      }
      if (action.location === 'floating') {
        const { width, height } = previous ?? action.size
        const entry = { id: action.id, width, height, minimized: false, layer }
        const index = previous ? state.floating.indexOf(previous) : next.floating.length
        next.floating.splice(Math.min(index, next.floating.length), 0, entry)
      } else {
        next[action.location] = action.id
        if (action.location === 'sidebar') next.sidebarVisible = true
      }
      return next
    }
    case 'close': return {
      ...state,
      assistant: state.assistant === action.id ? null : state.assistant,
      sidebar: state.sidebar === action.id ? null : state.sidebar,
      sidebarVisible: state.sidebar === action.id ? false : state.sidebarVisible,
      floating: state.floating.filter((entry) => entry.id !== action.id),
      focused: state.focused === action.id ? null : state.focused,
    }
    case 'focus': return { ...state, focused: action.id, floating: state.floating.map((entry) => entry.id === action.id ? { ...entry, minimized: false, layer } : entry) }
    case 'hide-sidebar': return { ...state, sidebarVisible: false }
    case 'show-sidebar': return state.sidebar ? { ...state, sidebarVisible: true, focused: state.sidebar } : state
    case 'minimize': return { ...state, focused: state.focused === action.id ? null : state.focused, floating: state.floating.map((entry) => entry.id === action.id ? { ...entry, minimized: true } : entry) }
    case 'resize': return { ...state, floating: state.floating.map((entry) => entry.id === action.id ? { ...entry, ...action.size } : entry) }
    case 'reorder': {
      const entry = state.floating.find((item) => item.id === action.id)
      if (!entry) return state
      const floating = state.floating.filter((item) => item !== entry)
      floating.splice(Math.max(0, Math.min(action.index, floating.length)), 0, entry)
      return { ...state, floating }
    }
  }
}

/** Clamp a window's size into the viewport so a shrunk window never strands it offscreen. */
export function fitWindow(size: WindowSize, width: number, height: number): WindowSize {
  return {
    width: Math.min(Math.max(320, size.width), Math.max(160, width - 24)),
    height: Math.min(Math.max(280, size.height), Math.max(160, height - 100)),
  }
}

export function defaultWindowSize(): WindowSize {
  return { width: Math.min(460, window.innerWidth - 32), height: Math.min(600, window.innerHeight - 110) }
}

export const ASSISTANT_LAYOUT_KEY = 'rowboat-assistant-layout-v1'

export function restoreAssistantLayout(raw: string | null, ids: string[]): AssistantLayout {
  const fallback = initialAssistantLayout(ids[0])
  try {
    const saved = JSON.parse(raw ?? 'null')
    if (!saved || !Array.isArray(saved.floating)) return fallback
    const available = new Set(ids)
    const take = (id: unknown) => {
      if (typeof id !== 'string' || !available.delete(id)) return null
      return id
    }
    const assistant = take(saved.assistant)
    const sidebar = take(saved.sidebar)
    const floating: FloatingChat[] = []
    for (const entry of saved.floating) {
      if (!entry || !['width', 'height', 'layer'].every((key) => Number.isFinite(entry[key]))) continue
      if (entry.width <= 0 || entry.height <= 0) continue
      const id = take(entry.id)
      if (id) floating.push({ id, width: entry.width, height: entry.height, layer: entry.layer, minimized: !!entry.minimized })
    }
    const focused = [assistant, sidebar, ...floating.filter((entry) => !entry.minimized).map((entry) => entry.id)].includes(saved.focused) ? saved.focused : assistant
    // The sidebar starts hidden on every app launch. Its remembered chat stays
    // assigned so an explicit open can restore that same conversation.
    return { assistant, sidebar, sidebarVisible: false, floating, focused }
  } catch { return fallback }
}

export function useAssistantLayout(ids: string[]) {
  const [layout, dispatch] = useReducer(assistantLayoutReducer, ids, (ids) => restoreAssistantLayout(readAssistantPreference(ASSISTANT_LAYOUT_KEY), ids))
  useEffect(() => writeAssistantPreference(ASSISTANT_LAYOUT_KEY, JSON.stringify(layout)), [layout])
  const place = useCallback((id: string, location: ChatLocation, replacing?: string) => {
    dispatch({ type: 'place', id, location, replacing, size: defaultWindowSize() })
  }, [])
  return { layout, dispatch, place }
}
