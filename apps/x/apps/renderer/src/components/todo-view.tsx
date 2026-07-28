import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Bot, CircleAlert, LayoutGrid, Loader2, RotateCcw, X } from 'lucide-react'
import type { TodoBlock, TodoEventType, TodoItem, TodoLink, TodoList } from '@x/shared/dist/todo.js'

// ---------------------------------------------------------------------------
// The home to-do list — one rolling ~/.rowboat/todo.md shared with @rowboat.
// The file is the truth: items, receipts (agent outcomes as indented "→"
// lines), checked state. This view is a lens over it plus ephemeral overlays
// (working spinners) from todo:events. Tagging @rowboat in a line delegates
// it; the agent's receipt lands under the item when the run finishes.
// ---------------------------------------------------------------------------

type TodoViewProps = {
  onOpenNote: (path: string) => void
  onShowOverview: () => void
}

const ROWBOAT_MENTION_RE = /(^|\s)@rowboat\b/i
const CHIP = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4'
const CALLOUT_KEY = 'todo.firstReceiptCalloutDone'

function mentionsRowboat(text: string): boolean {
  return ROWBOAT_MENTION_RE.test(text)
}

function openLink(link: TodoLink, onOpenNote: (path: string) => void) {
  if (link.url) window.open(link.url, '_blank')
  else if (link.path) onOpenNote(link.path)
}

// Render @rowboat mentions as chips inside a read-only text row.
function TextWithMentions({ text }: { text: string }) {
  const parts = text.split(/(@rowboat)/i)
  return (
    <>
      {parts.map((part, i) =>
        /^@rowboat$/i.test(part) ? (
          <span key={i} className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1 text-primary">
            <Bot className="size-3" />
            rowboat
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Receipt rows — the durable record of what @rowboat did
// ---------------------------------------------------------------------------

function ReceiptRow({ item, onOpenNote, onRetry }: {
  item: TodoItem
  onOpenNote: (path: string) => void
  onRetry: () => void
}) {
  if (item.receipts.length === 0) return null
  return (
    <div className="mt-1 flex flex-col gap-1">
      {item.receipts.map((r, i) => {
        if (r.kind === 'question') {
          return (
            <div key={i} className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[13px] text-amber-700 dark:text-amber-400">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span><span className="font-medium">needs you:</span> {r.text}</span>
            </div>
          )
        }
        if (r.kind === 'error') {
          return (
            <div key={i} className="flex items-center gap-1.5 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[13px] text-red-600 dark:text-red-400">
              <CircleAlert className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate" title={r.text}>failed: {r.text}</span>
              <button type="button" onClick={onRetry} className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium hover:bg-red-500/15">
                <RotateCcw className="size-3" /> retry
              </button>
            </div>
          )
        }
        return (
          <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1.5 text-[13px] text-muted-foreground">
            <span className="select-none text-muted-foreground/60">→</span>
            {r.links.map((l, j) => (
              <button
                key={j}
                type="button"
                onClick={() => openLink(l, onOpenNote)}
                className="inline-flex items-center gap-1 rounded-md bg-background px-1.5 py-0.5 font-medium text-foreground shadow-sm ring-1 ring-border hover:bg-accent"
              >
                <ArrowUpRight className="size-3" /> {l.label}
              </button>
            ))}
            {r.text && <span className="min-w-0">{r.text}</span>}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// One item row — checkbox, editable text, chips, receipts, dismiss
// ---------------------------------------------------------------------------

function ItemRow({ item, isRunning, onToggle, onCommitText, onDismiss, onRun, onOpenNote }: {
  item: TodoItem
  isRunning: boolean
  onToggle: (checked: boolean) => void
  onCommitText: (text: string) => void
  onDismiss: () => void
  onRun: () => void
  onOpenNote: (path: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.text)

  const commit = () => {
    setEditing(false)
    const text = draft.trim()
    if (text === item.text) return
    onCommitText(text)
  }

  const lastReceipt = item.receipts[item.receipts.length - 1]
  const showGoChip = item.delegated && !item.checked && !isRunning && item.receipts.length === 0

  return (
    <div className="group/todo flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-accent/40">
      <input
        type="checkbox"
        checked={item.checked}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-[3px] size-4 shrink-0 cursor-pointer accent-primary"
      />
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') { setDraft(item.text); setEditing(false) }
            }}
            className="w-full bg-transparent text-sm outline-none"
          />
        ) : (
          <div
            onClick={() => { if (!item.checked) { setDraft(item.text); setEditing(true) } }}
            className={`cursor-text text-sm ${item.checked ? 'text-muted-foreground line-through' : ''}`}
          >
            <TextWithMentions text={item.text} />
            {isRunning && (
              <span className={`${CHIP} ml-2 animate-pulse bg-primary/10 text-primary`}>
                <Loader2 className="size-3 animate-spin" /> working…
              </span>
            )}
            {showGoChip && !lastReceipt && (
              <button type="button" onClick={(e) => { e.stopPropagation(); onRun() }} className={`${CHIP} ml-2 border border-border text-muted-foreground hover:bg-accent hover:text-foreground`}>
                <Bot className="size-3" /> run
              </button>
            )}
          </div>
        )}
        <ReceiptRow item={item} onOpenNote={onOpenNote} onRetry={onRun} />
      </div>
      <button
        type="button"
        onClick={onDismiss}
        title="Dismiss"
        className="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground/50 opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/todo:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Composer — with the @rowboat autocomplete popup
// ---------------------------------------------------------------------------

function Composer({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Trailing "@" or partial "@row…" (not already the full mention) → offer
  // the completion. Everyone has the Slack/Notion muscle memory for this.
  const mentionMatch = /(^|\s)@(r(o(w(b(o(a(t?)?)?)?)?)?)?)?$/i.exec(text)
  const showMention = mentionMatch !== null && !/(^|\s)@rowboat$/i.test(text)

  const completeMention = () => {
    if (!mentionMatch) return
    const upToAt = text.slice(0, mentionMatch.index) + mentionMatch[1]
    setText(`${upToAt}@rowboat `)
    inputRef.current?.focus()
  }

  const submit = () => {
    const t = text.trim()
    if (!t) return
    setText('')
    onSubmit(t)
  }

  return (
    <div className="relative">
      {showMention && (
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); completeMention() }}
          className="absolute bottom-full left-3 mb-1.5 flex items-center gap-2 rounded-lg border border-border bg-popover px-3 py-1.5 text-sm shadow-md hover:bg-accent"
        >
          <Bot className="size-3.5 text-primary" />
          <span className="font-medium">@rowboat</span>
          <span className="text-xs text-muted-foreground">hand this off — Tab</span>
        </button>
      )}
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Tab' && showMention) { e.preventDefault(); completeMention(); return }
            if (e.key === 'Enter') { e.preventDefault(); submit() }
          }}
          placeholder="Add a to-do… mention @rowboat to hand it off"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground enabled:hover:bg-accent disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export function TodoView({ onOpenNote, onShowOverview }: TodoViewProps) {
  const [blocks, setBlocks] = useState<TodoBlock[] | null>(null)
  const [running, setRunning] = useState<Set<string>>(new Set())
  const [showCallout, setShowCallout] = useState(false)

  const blocksRef = useRef<TodoBlock[] | null>(null)
  const dirtyRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const adopt = (list: TodoList) => {
    blocksRef.current = list.blocks
    setBlocks(list.blocks)
  }

  const refetch = useCallback(async () => {
    // Local edits win — the save round-trip merges and re-adopts.
    if (dirtyRef.current) return
    const res = await window.ipc.invoke('todo:get', null)
    adopt(res.list)
    setRunning(new Set(res.running))
  }, [])

  const saveNow = useCallback(async () => {
    if (!dirtyRef.current || !blocksRef.current) return
    dirtyRef.current = false
    try {
      const res = await window.ipc.invoke('todo:save', { list: { blocks: blocksRef.current } })
      if (res.success && res.list && !dirtyRef.current) adopt(res.list)
    } catch (err) {
      console.error('Todo: save failed', err)
      dirtyRef.current = true
    }
  }, [])
  const saveNowRef = useRef(saveNow)
  useEffect(() => { saveNowRef.current = saveNow }, [saveNow])

  const mutate = useCallback((next: TodoBlock[]) => {
    blocksRef.current = next
    setBlocks(next)
    dirtyRef.current = true
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => void saveNowRef.current(), 600)
  }, [])

  useEffect(() => {
    void refetch()
  }, [refetch])

  useEffect(() => {
    const off = window.ipc.on('todo:events', (event: TodoEventType) => {
      if (event.type === 'run_start') {
        setRunning((s) => new Set(s).add(event.key))
        return
      }
      if (event.type === 'run_complete' || event.type === 'run_error') {
        setRunning((s) => {
          const next = new Set(s)
          next.delete(event.key)
          return next
        })
        if (event.type === 'run_complete' && !localStorage.getItem(CALLOUT_KEY)) {
          setShowCallout(true)
        }
      }
      void refetch()
    })
    return off
  }, [refetch])

  // Flush pending edits when the view unmounts
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (dirtyRef.current) void saveNowRef.current()
  }, [])

  const runItem = useCallback((key: string) => {
    setRunning((s) => new Set(s).add(key))
    void window.ipc.invoke('todo:runItem', { key })
  }, [])

  const addItem = useCallback(async (text: string) => {
    // Flush edits first so the appended line lands on the saved file.
    if (dirtyRef.current) await saveNowRef.current()
    await window.ipc.invoke('todo:addItem', { text, run: mentionsRowboat(text) })
    await refetch()
  }, [refetch])

  const clearCompleted = useCallback(async () => {
    if (dirtyRef.current) await saveNowRef.current()
    await window.ipc.invoke('todo:clearCompleted', null)
    await refetch()
  }, [refetch])

  const itemBlocks = (blocks ?? []).map((b, i) => ({ block: b, index: i }))
  const hasCompleted = itemBlocks.some(({ block }) => block.kind === 'item' && block.item.checked)
  const todayLabel = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="flex h-full flex-col overflow-hidden bg-muted/30">
      <div className="flex-1 overflow-y-auto px-9 py-7">
        <div className="mx-auto flex max-w-[720px] flex-col gap-4">

          {/* Header */}
          <div className="flex items-center gap-3">
            <h1 className="text-[28px] font-semibold tracking-tight">{todayLabel}</h1>
            <div className="ml-auto flex items-center gap-2">
              {hasCompleted && (
                <button
                  type="button"
                  onClick={() => void clearCompleted()}
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  Clear done
                </button>
              )}
              <button
                type="button"
                onClick={onShowOverview}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <LayoutGrid className="size-3.5" /> Overview
              </button>
            </div>
          </div>

          {/* First-completion callout — shown once, ever */}
          {showCallout && (
            <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm">
              <Bot className="size-4 shrink-0 text-primary" />
              <span className="flex-1">@rowboat finished an item — the → line under it links to what it did. Reply by editing the item or re-running it.</span>
              <button
                type="button"
                onClick={() => { localStorage.setItem(CALLOUT_KEY, '1'); setShowCallout(false) }}
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}

          {/* The list */}
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            {blocks === null ? (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">Loading…</div>
            ) : (
              itemBlocks.map(({ block, index }) => {
                if (block.kind === 'raw') {
                  if (block.text.trim() === '') return <div key={index} className="h-2" />
                  return (
                    <div key={index} className="px-2 py-1 text-sm font-medium text-muted-foreground">
                      {block.text.replace(/^#+\s*/, '')}
                    </div>
                  )
                }
                const item = block.item
                return (
                  <ItemRow
                    key={`${index}:${item.key}`}
                    item={item}
                    isRunning={running.has(item.key)}
                    onToggle={(checked) => {
                      const next = [...blocksRef.current!]
                      next[index] = { kind: 'item', item: { ...item, checked } }
                      mutate(next)
                    }}
                    onCommitText={(text) => {
                      const next = [...blocksRef.current!]
                      if (text === '') {
                        next.splice(index, 1)
                        mutate(next)
                        return
                      }
                      const wasDelegated = item.delegated
                      const updated: TodoItem = { ...item, text, key: text.replace(/\s+/g, ' ').trim().toLowerCase(), delegated: mentionsRowboat(text) }
                      next[index] = { kind: 'item', item: updated }
                      mutate(next)
                      // Typing @rowboat into a line is the go signal.
                      if (!wasDelegated && updated.delegated && !updated.checked) {
                        void saveNowRef.current().then(() => runItem(updated.key))
                      }
                    }}
                    onDismiss={() => {
                      const next = [...blocksRef.current!]
                      next.splice(index, 1)
                      mutate(next)
                    }}
                    onRun={() => runItem(item.key)}
                    onOpenNote={onOpenNote}
                  />
                )
              })
            )}
          </div>

          {/* Composer */}
          <Composer onSubmit={(text) => void addItem(text)} />

          <div className="text-[11px] text-muted-foreground/60">
            Saved to <code className="rounded bg-muted px-1">~/.rowboat/todo.md</code> — done items archive to <code className="rounded bg-muted px-1">todo/archive/</code>.
          </div>
        </div>
      </div>
    </div>
  )
}
