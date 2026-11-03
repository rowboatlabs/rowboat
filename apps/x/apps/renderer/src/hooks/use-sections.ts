import { useCallback, useEffect, useState } from 'react'

// Todo and Apps are optional sections (2026-11-03, spaces-first desktop):
// hidden from the sidebar, palette, Go menu and tour until switched on in
// Settings. Main owns the value (config/sections.ts); one shared copy here
// keeps every reader in step when Settings changes it.

export type Sections = { todo: boolean; apps: boolean }

const CHANGED_EVENT = 'x:sections-changed'
let current: Sections | null = null
let loading: Promise<Sections> | null = null

function load(): Promise<Sections> {
  // Through a resolved promise, so a throwing invoke can't take the sidebar down.
  loading ??= Promise.resolve()
    .then(() => window.ipc.invoke('sections:get', null))
    .then((sections) => {
      current = sections
      window.dispatchEvent(new Event(CHANGED_EVENT))
      return sections
    })
    .catch(() => {
      loading = null
      return { todo: false, apps: false }
    })
  return loading
}

export async function setSections(patch: Partial<Sections>): Promise<void> {
  current = await window.ipc.invoke('sections:set', patch)
  window.dispatchEvent(new Event(CHANGED_EVENT))
}

/** The current sections; both off until main answers. */
export function useSections(): Sections & { set: (patch: Partial<Sections>) => Promise<void> } {
  const [sections, setState] = useState<Sections>(current ?? { todo: false, apps: false })
  useEffect(() => {
    const sync = () => { if (current) setState(current) }
    window.addEventListener(CHANGED_EVENT, sync)
    if (current) sync()
    else void load()
    return () => window.removeEventListener(CHANGED_EVENT, sync)
  }, [])
  const set = useCallback((patch: Partial<Sections>) => setSections(patch), [])
  return { ...sections, set }
}
