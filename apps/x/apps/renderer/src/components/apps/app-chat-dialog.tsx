import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '@/components/ui/dialog'
import { getAppHistory } from '@/lib/app-history'

export type AppChatRequest = {
  folder: string
  prompt: string
  send?: boolean
  chatId?: string
  conversationId?: string
}
type Mode = 'claude' | 'codex'

export function AppChatDialog({
  request,
  onClose,
  onContinue
}: {
  request: AppChatRequest
  onClose: () => void
  onContinue: (
    request: AppChatRequest,
    mode?: Mode,
    startNew?: boolean
  ) => Promise<void>
}) {
  const [agents, setAgents] = useState<Mode[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode | ''>('')
  const [startNew, setStartNew] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const config = await window.ipc.invoke('codeMode:getConfig', null)
        const status = config.enabled
          ? await window.ipc.invoke('codeMode:checkAgentStatus', null)
          : null
        if (cancelled) return
        const available = (['claude', 'codex'] as const).filter(
          (agent) => status?.[agent].installed && status[agent].signedIn
        )
        setAgents(available)
        const saved = getAppHistory()[request.folder]?.codeMode
        if (saved && available.includes(saved)) setMode(saved)
      } catch {
        if (!cancelled)
          setError(
            'Could not check code mode availability. You can still continue with Copilot.'
          )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [request.folder])
  const proceed = async () => {
    setBusy(true)
    setError(null)
    try {
      await onContinue(request, mode || undefined, startNew)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent>
        <DialogTitle>
          {request.send ? 'Build your app' : 'Continue building'}
        </DialogTitle>
        <DialogDescription>
          Continue in the app’s existing conversation, or your current chat if
          this app has no conversation yet.
        </DialogDescription>
        {loading ? (
          <p role="status">Checking available coding agents…</p>
        ) : (
          agents.length > 0 && (
            <label className="grid gap-2 text-sm">
              Would you like to use code mode?
              <select
                aria-label="Building assistant"
                className="rounded-md border bg-background p-2"
                value={mode}
                onChange={(e) => setMode(e.target.value as Mode | '')}
              >
                <option value="">Copilot</option>
                {agents.map((agent) => (
                  <option key={agent} value={agent}>
                    {agent === 'claude' ? 'Claude Code' : 'Codex'}
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground">
                Your choice applies to this app conversation.
              </span>
            </label>
          )
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={startNew}
            onChange={(e) => setStartNew(e.target.checked)}
          />
          Start a new chat
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <button
          className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
          disabled={loading || busy}
          onClick={() => void proceed()}
        >
          {busy
            ? 'Opening…'
            : startNew
              ? 'Start new chat'
              : request.send
                ? 'Build in this chat'
                : 'Continue in this chat'}
        </button>
      </DialogContent>
    </Dialog>
  )
}
