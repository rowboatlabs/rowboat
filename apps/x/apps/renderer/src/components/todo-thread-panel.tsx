import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, FileText, Loader2, Send, X } from 'lucide-react'
import type { TodoEventType, TodoItem, TodoThreadEntry } from '@x/shared/dist/todo.js'

// ---------------------------------------------------------------------------
// The thread behind one to-do item — where the user steers @rowboat's work.
// Entries live human-readable at todo/threads/<slug>.md; a follow-up message
// reopens the item and re-runs it with the whole conversation as context.
// ---------------------------------------------------------------------------

type TodoThreadPanelProps = {
  item: TodoItem
  isRunning: boolean
  onClose: () => void
  onOpenRun: (runId: string) => void
}

function entryTime(at: string): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function TodoThreadPanel({ item, isRunning, onClose, onOpenRun }: TodoThreadPanelProps) {
  const [entries, setEntries] = useState<TodoThreadEntry[] | null>(null)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const refetch = useCallback(async () => {
    const res = await window.ipc.invoke('todo:getThread', { key: item.key })
    setEntries(res.entries)
  }, [item.key])

  useEffect(() => {
    setEntries(null)
    void refetch()
  }, [refetch])

  // A finished run appends its entry — refresh when this item's runs settle.
  useEffect(() => {
    const off = window.ipc.on('todo:events', (event: TodoEventType) => {
      if ('key' in event && event.key !== item.key) return
      void refetch()
    })
    return off
  }, [item.key, refetch])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [entries, isRunning])

  const send = useCallback(() => {
    const message = draft.trim()
    if (!message || isRunning) return
    setDraft('')
    // Optimistic append; the canonical entry arrives on the next refetch.
    setEntries((prev) => [
      ...(prev ?? []),
      { author: 'user', at: new Date().toISOString(), text: message },
    ])
    void window.ipc.invoke('todo:followUp', { key: item.key, message })
  }, [draft, isRunning, item.key])

  return (
    <div className="flex h-full w-[380px] shrink-0 flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Thread</div>
          <div className="truncate text-sm font-medium" title={item.text}>{item.text}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Entries */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {entries === null ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
        ) : entries.length === 0 && !isRunning ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No conversation yet. Give @rowboat direction below — it re-runs this item with the whole thread in mind.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {entries.map((entry, i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {entry.author === 'rowboat' && <Bot className="size-3" />}
                  <span className="font-medium">{entry.author === 'rowboat' ? 'rowboat' : 'you'}</span>
                  <span>· {entryTime(entry.at)}</span>
                  {entry.runId && (
                    <button
                      type="button"
                      onClick={() => onOpenRun(entry.runId!)}
                      title="Open the full run transcript"
                      className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
                    >
                      <FileText className="size-3" /> transcript
                    </button>
                  )}
                </div>
                <div
                  className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-[13px] ${
                    entry.author === 'user' ? 'bg-primary/10' : 'bg-muted/60'
                  }`}
                >
                  {entry.text}
                </div>
              </div>
            ))}
            {isRunning && (
              <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> @rowboat is working…
              </div>
            )}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2 rounded-xl border border-border bg-background px-3 py-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            rows={2}
            placeholder="Tell @rowboat what to change…"
            className="min-w-0 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={send}
            disabled={!draft.trim() || isRunning}
            title={isRunning ? 'Wait for the current run to finish' : 'Send (Enter)'}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground enabled:hover:bg-accent enabled:hover:text-foreground disabled:opacity-40"
          >
            <Send className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
