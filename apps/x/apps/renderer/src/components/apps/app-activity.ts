import { useCallback, useEffect, useRef, useState } from 'react'
import type { BackgroundTaskSummary } from '@x/shared/dist/background-task'
import { useBackgroundTaskAgentStatus } from '@/hooks/use-bg-task-agent-status'

export function useAppActivity() {
  const [tasks, setTasks] = useState<BackgroundTaskSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [failures, setFailures] = useState<Record<string, string>>({})
  const failedAt = useRef<Record<string, number>>({})
  const inFlight = useRef(new Set<string>())
  const live = useBackgroundTaskAgentStatus()
  const refresh = useCallback(async () => {
    try {
      const items: BackgroundTaskSummary[] = []
      let total = Infinity
      while (items.length < total) {
        const r = await window.ipc.invoke('bg-task:list', {
          offset: items.length,
          limit: 100
        })
        items.push(...r.items)
        total = r.total
        if (!r.items.length) break
      }
      setTasks(items)
      setFailures((previous) => {
        const next = { ...previous }
        for (const task of items)
          if (
            !task.lastRunError &&
            task.lastRunAt &&
            Date.parse(task.lastRunAt) >
              (failedAt.current[task.slug] ?? Infinity)
          )
            delete next[task.slug]
        return next
      })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])
  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 4000)
    return () => window.clearInterval(timer)
  }, [refresh])
  useEffect(() => {
    void refresh()
    setFailures((previous) => {
      const next = { ...previous }
      for (const [slug, state] of live)
        if (state.status === 'done') delete next[slug]
      return next
    })
  }, [live, refresh])
  const running = (slug: string) =>
    pending.has(slug) ||
    live.get(slug)?.status === 'running' ||
    !!tasks.find((t) => t.slug === slug)?.running
  const run = async (slug: string) => {
    if (inFlight.current.has(slug) || running(slug)) return
    inFlight.current.add(slug)
    setPending(new Set(inFlight.current))
    setFailures((prev) => {
      const next = { ...prev }
      delete next[slug]
      return next
    })
    try {
      const r = await window.ipc.invoke('bg-task:run', { slug })
      if (!r.success)
        throw new Error(
          r.error ||
            'The update failed. Try again or ask the copilot to fix it.'
        )
    } catch (e) {
      failedAt.current[slug] = Date.now()
      setFailures((prev) => ({
        ...prev,
        [slug]: e instanceof Error ? e.message : String(e)
      }))
    } finally {
      inFlight.current.delete(slug)
      setPending(new Set(inFlight.current))
      await refresh()
    }
  }
  const failure = (task: BackgroundTaskSummary) =>
    failures[task.slug] || live.get(task.slug)?.error || task.lastRunError
  return { tasks, error, refresh, running, run, failure }
}
export type AppActivity = ReturnType<typeof useAppActivity>
