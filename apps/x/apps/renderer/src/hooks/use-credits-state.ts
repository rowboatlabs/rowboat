import { useCallback, useEffect, useState } from 'react'
import type { ElementType } from 'react'
import { AtSign, Bot, LayoutGrid, NotebookPen, Send } from 'lucide-react'
import type { CreditActivityCode, CreditsState } from '@x/shared/dist/credits.js'

export const CREDIT_ACTIVITY_ICONS: Record<CreditActivityCode, ElementType> = {
  first_gmail_connected: AtSign,
  first_email_sent: Send,
  first_meeting_note: NotebookPen,
  first_bg_agent: Bot,
  first_app_built: LayoutGrid,
}

/**
 * Credit-rewards state shared by every rewards surface (sidebar pill,
 * settings section). Fetches once on mount and refreshes when a grant is
 * confirmed (`credits:didActivate`) or when a connect event could change
 * eligibility/claimed state — rowboat sign-in/out and Google connects; other
 * providers can't affect rewards, so their events are ignored.
 */
export function useCreditsState() {
  const [state, setState] = useState<CreditsState | null>(null)

  const refresh = useCallback(async () => {
    try {
      setState(await window.ipc.invoke('credits:getState', null))
    } catch (error) {
      console.error('Failed to fetch credit rewards state:', error)
    }
  }, [])

  useEffect(() => {
    refresh()
    const offActivated = window.ipc.on('credits:didActivate', () => {
      refresh()
    })
    const offOAuth = window.ipc.on('oauth:didConnect', (event) => {
      if (event.provider === 'rowboat' || event.provider === 'google') {
        refresh()
      }
    })
    return () => {
      offActivated()
      offOAuth()
    }
  }, [refresh])

  return state
}
