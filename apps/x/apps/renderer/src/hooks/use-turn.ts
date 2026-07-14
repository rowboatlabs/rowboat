import { useEffect, useRef, useState } from 'react'
import type { TurnState } from '@x/shared/src/turns.js'
import { subscribeTurnFeed } from '@/lib/turn-feed'
import { followTurn } from '@/lib/turn-follower'

export interface UseTurnResult {
  state: TurnState | null
  error: string | null
  // Snapshot retries exhausted with no state — the id may not be a turn at
  // all (e.g. a pre-migration legacy run id). Clears if a later feed event
  // recovers the turn.
  snapshotFailed: boolean
}

// Live view of one turn by id: snapshot via sessions:getTurn, then durable
// events from the turns:events spine (see lib/turn-follower.ts for the join
// protocol). Works for any turn — session chat, headless runners, spawned
// sub-agents.
export function useTurn(
  turnId: string | undefined,
  opts?: { enabled?: boolean; maxRetries?: number },
): UseTurnResult {
  const enabled = opts?.enabled ?? true
  const maxRetries = opts?.maxRetries
  const [state, setState] = useState<TurnState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [snapshotFailed, setSnapshotFailed] = useState(false)
  const lastTurnId = useRef<string | undefined>(undefined)

  useEffect(() => {
    // A different turn means the previous turn's state is stale; a mere
    // enabled toggle keeps the last rendered state while hidden.
    if (turnId !== lastTurnId.current) {
      lastTurnId.current = turnId
      setState(null)
      setError(null)
      setSnapshotFailed(false)
    }
    if (!turnId || !enabled) {
      return
    }
    return followTurn(turnId, {
      fetchTurn: (id) => window.ipc.invoke('sessions:getTurn', { turnId: id }),
      subscribe: subscribeTurnFeed,
      onState: (next) => {
        setState(next)
        setError(null)
        setSnapshotFailed(false)
      },
      onError: (message) => setError(message),
      onSnapshotFailed: () => setSnapshotFailed(true),
      ...(maxRetries === undefined ? {} : { maxRetries }),
    })
  }, [turnId, enabled, maxRetries])

  return { state, error, snapshotFailed }
}
