import { useEffect, useMemo, useState } from 'react'
import {
  runToTranscript,
  turnStateToTranscript,
  type AgentRunTranscript,
} from '@/lib/agent-transcript'
import { useTurn } from '@/hooks/use-turn'

export interface UseAgentRunTranscriptResult {
  transcript: AgentRunTranscript | null
  loading: boolean
  error: string | null
}

// Live transcript of a headless agent run (background task, live note) by
// run id. Run ids are turn ids since the runs→turns migration, so useTurn
// keeps the transcript live via the turns:events spine; ids whose turn
// snapshot definitively fails (pre-migration legacy files) fall back to one
// runs:fetch. Callers open this for runs that already exist, so a failed
// snapshot means "not a turn", not "not created yet" — maxRetries 0 makes
// the legacy fallback immediate.
export function useAgentRunTranscript(
  runId: string | undefined | null,
): UseAgentRunTranscriptResult {
  const id = runId ?? undefined
  const { state, error: turnError, snapshotFailed } = useTurn(id, { maxRetries: 0 })
  const [legacy, setLegacy] = useState<AgentRunTranscript | null>(null)
  const [legacyError, setLegacyError] = useState<string | null>(null)

  useEffect(() => {
    setLegacy(null)
    setLegacyError(null)
    if (!id || !snapshotFailed) {
      return
    }
    let alive = true
    window.ipc
      .invoke('runs:fetch', { runId: id })
      .then((run) => {
        if (alive) setLegacy(runToTranscript(run))
      })
      .catch((err: unknown) => {
        if (alive) setLegacyError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [id, snapshotFailed])

  const transcript = useMemo(() => {
    if (id && state) {
      return turnStateToTranscript(id, state)
    }
    return legacy
  }, [id, state, legacy])

  const error = transcript ? null : (turnError ?? legacyError)
  const loading = !!id && !transcript && !error

  return { transcript, loading, error }
}
