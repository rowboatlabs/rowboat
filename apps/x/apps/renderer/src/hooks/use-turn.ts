import { useEffect, useState } from 'react'
import type { TurnState } from '@x/shared/src/turns.js'
import { subscribeTurnFeed } from '@/lib/turn-feed'
import { followTurn } from '@/lib/turn-follower'

export interface UseTurnResult {
  state: TurnState | null
  error: string | null
}

// Live view of one turn by id: snapshot via sessions:getTurn, then durable
// events from the turns:events spine (see lib/turn-follower.ts for the join
// protocol). Works for any turn — session chat, headless runners, spawned
// sub-agents.
export function useTurn(
  turnId: string | undefined,
  opts?: { enabled?: boolean },
): UseTurnResult {
  const enabled = opts?.enabled ?? true
  const [state, setState] = useState<TurnState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!turnId) {
      setState(null)
      setError(null)
      return
    }
    if (!enabled) {
      // Keep the last rendered state while hidden; re-enabling refetches.
      return
    }
    return followTurn(turnId, {
      fetchTurn: (id) => window.ipc.invoke('sessions:getTurn', { turnId: id }),
      subscribe: subscribeTurnFeed,
      onState: (next) => {
        setState(next)
        setError(null)
      },
      onError: (message) => setError(message),
    })
  }, [turnId, enabled])

  return { state, error }
}
