import { useEffect, useState } from 'react'
import { DEFAULT_QUICK_ASK_SHORTCUT } from '@x/shared/src/quick-ask-shortcut.js'

export type QuickAskShortcutState = {
  accelerator: string
  registered: boolean
  isDefault: boolean
}

/**
 * The current global quick-ask chord, live: seeded via quickAsk:getShortcut
 * and updated on every rebind through the quick-ask:shortcut-changed push.
 * Works in any window (app, companion) — same preload bridge.
 */
export function useQuickAskShortcut(): QuickAskShortcutState {
  const [state, setState] = useState<QuickAskShortcutState>({
    accelerator: DEFAULT_QUICK_ASK_SHORTCUT,
    registered: true,
    isDefault: true,
  })
  useEffect(() => {
    let alive = true
    try {
      void window.ipc
        .invoke('quickAsk:getShortcut', null)
        .then((s) => {
          if (alive) setState(s)
        })
        .catch(() => {})
    } catch {
      // Stale preload (app not restarted since the channel was added) throws
      // synchronously from schema validation — keep the default silently.
    }
    let off: (() => void) | undefined
    try {
      off = window.ipc.on('quick-ask:shortcut-changed', ({ accelerator, registered }) => {
        setState({
          accelerator,
          registered,
          isDefault: accelerator === DEFAULT_QUICK_ASK_SHORTCUT,
        })
      })
    } catch {
      // Same stale-preload guard.
    }
    return () => {
      alive = false
      off?.()
    }
  }, [])
  return state
}
