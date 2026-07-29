import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Bot, CircleAlert, LayoutGrid, ListPlus, Loader2, MessageCircle, Plus, RotateCcw, X } from 'lucide-react'
import type { TodoBlock, TodoChatBubble, TodoEventType, TodoItem, TodoLink, TodoList } from '@x/shared/dist/todo.js'

// ---------------------------------------------------------------------------
// The home to-do list — one rolling ~/.rowboat/todo.md shared with @rowboat.
// The file is the truth: items, receipts (agent outcomes as indented "→"
// lines), checked state. This view is a lens over it plus ephemeral overlays
// (working spinners) from todo:events. Tagging @rowboat in a line delegates
// it; the agent's receipt lands under the item when the run finishes.
// ---------------------------------------------------------------------------

type TodoViewProps = {
  onOpenNote: (path: string) => void
  /** Bind the chat dock to an item's session — the full thread view. */
  onOpenInChat: (sessionId: string) => void
  onShowOverview: () => void
  /** The real assistant composer, mounted by App (full features, submits
   * through the app's chat machinery). Falls back to a basic input. */
  composer?: React.ReactNode
  /** Route a ＋ affordance into the composer with a destination chip. */
  onComposeTodo?: (target: { kind: 'todo' } | { kind: 'sub'; parentKey: string; parentText: string }) => void
}

const ROWBOAT_MENTION_RE = /(^|\s)@rowboat\b/i
const CHIP = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4'
const CALLOUT_KEY = 'todo.firstReceiptCalloutDone'

function mentionsRowboat(text: string): boolean {
  return ROWBOAT_MENTION_RE.test(text)
}

// Mirrors core fileops key derivation — the renderer computes keys locally
// only for optimistic UI; core re-keys authoritatively on save.
function normKey(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

// ---------------------------------------------------------------------------
// @rowboat autocomplete — shared by every composer (main, reply, sub-task).
// A trailing "@" or partial "@row…" offers the completion; Tab or click
// completes it. Slack/Notion muscle memory, everywhere text is typed.
// ---------------------------------------------------------------------------

function useMention(text: string, setText: (t: string) => void) {
  const match = /(^|\s)@(r(o(w(b(o(a(t?)?)?)?)?)?)?)?$/i.exec(text)
  const show = match !== null && !/(^|\s)@rowboat$/i.test(text)
  const complete = () => {
    if (!match) return
    setText(`${text.slice(0, match.index)}${match[1]}@rowboat `)
  }
  return { show, complete }
}

function MentionPopup({ onPick }: { onPick: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onPick() }}
      className="absolute bottom-full left-3 z-10 mb-1.5 flex items-center gap-2 rounded-lg border border-border bg-popover px-3 py-1.5 text-sm shadow-md hover:bg-accent"
    >
      <Bot className="size-3.5 text-primary" />
      <span className="font-medium">@rowboat</span>
      <span className="text-xs text-muted-foreground">hand this off — Tab</span>
    </button>
  )
}

function childKey(parentText: string, subText: string): string {
  return `${normKey(parentText)} :: ${normKey(subText)}`
}

function openLink(link: TodoLink, onOpenNote: (path: string) => void) {
  if (link.url) window.open(link.url, '_blank')
  else if (link.path) onOpenNote(link.path)
}

// Render @rowboat mentions as chips and [label](target) links as buttons
// inside a read-only text row.
function TextWithMentions({ text, onOpenLink }: { text: string; onOpenLink?: (link: TodoLink) => void }) {
  const parts = text.split(/(@rowboat|\[[^\]]+\]\([^)]+\))/i)
  return (
    <>
      {parts.map((part, i) => {
        if (/^@rowboat$/i.test(part)) {
          return (
            <span key={i} className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1 text-primary">
              <Bot className="size-3" />
              rowboat
            </span>
          )
        }
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
        if (link) {
          const target = link[2]
          const parsed: TodoLink = /^[a-z][a-z0-9+.-]*:\/\//i.test(target)
            ? { label: link[1], url: target }
            : { label: link[1], path: target }
          return (
            <button
              key={i}
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenLink?.(parsed) }}
              className="mx-0.5 inline-flex items-center gap-0.5 rounded bg-muted px-1 text-[12px] text-muted-foreground ring-1 ring-border hover:bg-accent hover:text-foreground"
            >
              <ArrowUpRight className="size-3" /> {link[1]}
            </button>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
// Receipt rows — the durable record of what @rowboat did
// ---------------------------------------------------------------------------

function ReceiptRow({ item, onOpenNote, onRetry, onOpenThread }: {
  item: TodoItem
  onOpenNote: (path: string) => void
  onRetry: () => void
  /** Opens the inline comment box (questions are answered right there). */
  onOpenThread: () => void
}) {
  if (item.receipts.length === 0) return null
  return (
    <div className="mt-1 flex flex-col gap-1">
      {item.receipts.map((r, i) => {
        if (r.kind === 'question') {
          return (
            <button
              key={i}
              type="button"
              onClick={onOpenThread}
              title="Answer in the thread"
              className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-left text-[13px] text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
            >
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span><span className="font-medium">needs you:</span> {r.text}</span>
            </button>
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

function SubComposer({ onSubmit, onCancel }: {
  onSubmit: (text: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState('')
  const mention = useMention(text, setText)
  return (
    <div className="relative mt-1 flex items-center gap-2 rounded-lg border border-dashed border-border px-2.5 py-1.5">
      {mention.show && <MentionPopup onPick={mention.complete} />}
      <ListPlus className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Tab' && mention.show) { e.preventDefault(); mention.complete(); return }
          if (e.key === 'Enter' && text.trim()) {
            e.preventDefault()
            onSubmit(text.trim())
          }
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="Add a step… mention @rowboat to hand it off"
        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
      />
    </div>
  )
}

function CommentComposer({ onSend, onCancel }: {
  onSend: (message: string) => void
  onCancel: () => void
}) {
  const [message, setMessage] = useState('')
  const mention = useMention(message, setMessage)
  return (
    <div className="relative mt-1.5 flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5">
      {mention.show && <MentionPopup onPick={mention.complete} />}
      <MessageCircle className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        autoFocus
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Tab' && mention.show) { e.preventDefault(); mention.complete(); return }
          if (e.key === 'Enter' && message.trim()) {
            e.preventDefault()
            onSend(message.trim())
          }
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="Tell @rowboat something about this…"
        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// The conversation under an item — WhatsApp-style bubbles derived from the
// item's session: yours on the right, @rowboat's on the left with its
// artifact links. Long threads cap here and continue in the chat dock.
// ---------------------------------------------------------------------------

const MAX_BUBBLES = 6

function Bubble({ b, onOpenNote, onRetry }: {
  b: TodoChatBubble
  onOpenNote: (path: string) => void
  onRetry?: () => void
}) {
  if (b.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3 py-1.5 text-[13px] text-primary-foreground">
          {b.text}
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-end gap-1.5">
      <Bot className="mb-1.5 size-3.5 shrink-0 text-muted-foreground" />
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md px-3 py-1.5 text-[13px] ${
          b.kind === 'error'
            ? 'bg-red-500/10 text-red-600 dark:text-red-400'
            : 'bg-muted text-foreground'
        }`}
      >
        {b.kind === 'error' ? `failed: ${b.text}` : b.text}
        {b.kind === 'error' && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="ml-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium hover:bg-red-500/15"
          >
            <RotateCcw className="size-3" /> retry
          </button>
        )}
        {b.links.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1.5">
            {b.links.map((l, j) => (
              <button
                key={j}
                type="button"
                onClick={() => openLink(l, onOpenNote)}
                className="inline-flex items-center gap-1 rounded-md bg-background px-1.5 py-0.5 text-[12px] font-medium text-foreground shadow-sm ring-1 ring-border hover:bg-accent"
              >
                <ArrowUpRight className="size-3" /> {l.label}
              </button>
            ))}
          </span>
        )}
      </div>
    </div>
  )
}

function ConversationView({ bubbles, sessionId, onOpenNote, onOpenInChat, onRetry, onReply, composerOpen }: {
  bubbles: TodoChatBubble[]
  sessionId: string | null
  onOpenNote: (path: string) => void
  onOpenInChat: (sessionId: string) => void
  /** Omitted on stream threads — error bubbles render without a retry. */
  onRetry?: () => void
  onReply: () => void
  composerOpen: boolean
}) {
  const shown = bubbles.slice(-MAX_BUBBLES)
  const hidden = bubbles.length - shown.length
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {hidden > 0 && sessionId && (
        <button
          type="button"
          onClick={() => onOpenInChat(sessionId)}
          className="self-center rounded-full px-2.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {hidden} earlier message{hidden === 1 ? '' : 's'} — open in chat
        </button>
      )}
      {shown.map((b, i) => (
        <Bubble key={i} b={b} onOpenNote={onOpenNote} onRetry={onRetry} />
      ))}
      {!composerOpen && (
        <button
          type="button"
          onClick={onReply}
          className="flex w-fit items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3" /> reply
        </button>
      )}
    </div>
  )
}

function ItemRow({ item, isRunning, commentOpen, sessionId, bubbles, depth = 0, changed = false, dimmed = false, childRows, onAddSub, onToggle, onCommitText, onDismiss, onRun, onOpenNote, onToggleComment, onComment, onOpenInChat }: {
  item: TodoItem
  isRunning: boolean
  commentOpen: boolean
  sessionId: string | null
  bubbles: TodoChatBubble[]
  /** 0 = top-level, 1 = sub-item. One level only. */
  depth?: number
  /** Activity since the user last looked — renders the unread dot. */
  changed?: boolean
  /** Triage filter active and this row doesn't match. */
  dimmed?: boolean
  /** Rendered sub-item rows (built by the parent view) + sub composer. */
  childRows?: React.ReactNode
  /** Top-level only: open the "add sub-task" input. */
  onAddSub?: () => void
  onToggle: (checked: boolean) => void
  onCommitText: (text: string) => void
  onDismiss: () => void
  onRun: () => void
  onOpenNote: (path: string) => void
  onToggleComment: () => void
  onComment: (message: string) => void
  onOpenInChat: (sessionId: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.text)
  const mention = useMention(draft, setDraft)
  // The live exchange renders as bubbles; a checked item collapses back to
  // its compact receipt lines so the list stays a list.
  const showConversation = !item.checked && bubbles.length > 0
  const doneChildren = item.children.filter((c) => c.checked).length
  const allChildrenDone = item.children.length > 0 && doneChildren === item.children.length

  const commit = () => {
    setEditing(false)
    const text = draft.trim()
    if (text === item.text) return
    onCommitText(text)
  }

  const lastReceipt = item.receipts[item.receipts.length - 1]
  const showGoChip = item.delegated && !item.checked && !isRunning && item.receipts.length === 0

  return (
    <div className={`group/todo relative flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-opacity hover:bg-accent/40 ${dimmed ? 'opacity-35' : ''}`}>
      {changed && (
        <span
          title="Changed since you last looked"
          className="absolute -left-1 top-[13px] size-1.5 rounded-full bg-primary"
        />
      )}
      <input
        type="checkbox"
        checked={item.checked}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-[3px] size-4 shrink-0 cursor-pointer accent-primary"
      />
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="relative">
            {mention.show && <MentionPopup onPick={mention.complete} />}
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Tab' && mention.show) { e.preventDefault(); mention.complete(); return }
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') { setDraft(item.text); setEditing(false) }
              }}
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
        ) : (
          <div
            onClick={() => { if (!item.checked) { setDraft(item.text); setEditing(true) } }}
            className={`cursor-text text-sm ${item.checked ? 'text-muted-foreground line-through' : ''}`}
          >
            <TextWithMentions text={item.text} onOpenLink={(l) => openLink(l, onOpenNote)} />
            {item.children.length > 0 && (
              <span
                className={`${CHIP} ml-2 ${allChildrenDone && !item.checked ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground/70'}`}
                title={allChildrenDone && !item.checked ? 'All steps done — check it off?' : undefined}
              >
                {doneChildren}/{item.children.length}
              </span>
            )}
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
            {/* One-click delegation — prepends the mention, which routes
                through the same "typed @rowboat" go path. */}
            {!item.delegated && !item.checked && !isRunning && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onCommitText(`@rowboat ${item.text}`) }}
                className={`${CHIP} ml-2 border border-border text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/todo:opacity-100`}
              >
                <Bot className="size-3" /> assign
              </button>
            )}
          </div>
        )}
        {showConversation ? (
          <ConversationView
            bubbles={bubbles}
            sessionId={sessionId}
            onOpenNote={onOpenNote}
            onOpenInChat={onOpenInChat}
            onRetry={onRun}
            onReply={onToggleComment}
            composerOpen={commentOpen}
          />
        ) : (
          <ReceiptRow item={item} onOpenNote={onOpenNote} onRetry={onRun} onOpenThread={onToggleComment} />
        )}
        {commentOpen && (
          <CommentComposer onSend={onComment} onCancel={onToggleComment} />
        )}
        {childRows}
      </div>
      {onAddSub && depth === 0 && (
        <button
          type="button"
          onClick={onAddSub}
          title="Add a sub-task"
          className="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground/50 opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/todo:opacity-100"
        >
          <ListPlus className="size-3.5" />
        </button>
      )}
      {/* ＋ is the standing way to comment on any item; once bubbles are
          shown, the in-thread "+ reply" chip takes over that job. */}
      {!showConversation && (
        <button
          type="button"
          onClick={onToggleComment}
          title="Comment — tell @rowboat something about this item"
          className="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground/50 opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/todo:opacity-100"
        >
          <Plus className="size-3.5" />
        </button>
      )}
      {/* 💬 appears only once a thread exists — then there is something to
          continue in the sidebar. */}
      {sessionId && (
        <button
          type="button"
          onClick={() => onOpenInChat(sessionId)}
          title="Open this conversation in the chat sidebar"
          className={`mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground/50 transition-opacity hover:bg-accent hover:text-foreground ${
            showConversation || isRunning ? '' : 'opacity-0 group-hover/todo:opacity-100'
          }`}
        >
          <MessageCircle className="size-3.5" />
        </button>
      )}
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

// The page-bottom composer is PURELY the assistant — no modes, nothing to
// remember. Tasks are born where tasks live (the add-row inside the list),
// or by meaning: an @rowboat mention here creates a delegated item, and
// "add X to my list" works because the copilot has the todo-add tool.
function Composer({ onSubmit }: { onSubmit: (text: string, kind: 'task' | 'chat') => void }) {
  const [text, setText] = useState('')
  const mention = useMention(text, setText)
  const isTask = mentionsRowboat(text)

  const submit = () => {
    const t = text.trim()
    if (!t) return
    setText('')
    onSubmit(t, isTask ? 'task' : 'chat')
  }

  return (
    <div className="relative">
      {mention.show && <MentionPopup onPick={mention.complete} />}
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Tab' && mention.show) { e.preventDefault(); mention.complete(); return }
            if (e.key === 'Enter') { e.preventDefault(); submit() }
          }}
          placeholder="Ask anything… mention @rowboat to hand off a task"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground enabled:hover:bg-accent disabled:opacity-40"
        >
          {isTask ? 'Add task' : 'Ask'}
        </button>
      </div>
    </div>
  )
}

// The to-do door, where to-dos live: a slim always-there row at the end of
// the list. Enter appends the line — no model, no modes.
function AddItemRow({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState('')
  const mention = useMention(text, setText)
  return (
    <div className="relative mt-1 flex items-center gap-2.5 rounded-lg px-2 py-1.5">
      {mention.show && <MentionPopup onPick={mention.complete} />}
      <Plus className="size-4 shrink-0 text-muted-foreground/50" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Tab' && mention.show) { e.preventDefault(); mention.complete(); return }
          if (e.key === 'Enter' && text.trim()) {
            e.preventDefault()
            onAdd(text.trim())
            setText('')
          }
        }}
        placeholder="Add a to-do… @rowboat hands it off"
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

type ArchivedEntry = {
  month: string
  blockIndex: number
  date: string | null
  item: TodoItem
}

// ---------------------------------------------------------------------------
// The stream — recent chat threads (sessions that aren't to-do threads).
// Same thread mechanics as items: expand → bubbles, inline reply, 💬 → dock.
// ---------------------------------------------------------------------------

type StreamThread = {
  sessionId: string
  title: string
  updatedAt: string
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return ''
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/** The trailing segment worth peeking at: Rowboat's most recent reply plus
 * anything the user sent after it. Never the history — that's the sidebar. */
function lastResponseTail(bubbles: TodoChatBubble[]): TodoChatBubble[] {
  let idx = -1
  for (let i = bubbles.length - 1; i >= 0; i--) {
    if (bubbles[i].role === 'rowboat') { idx = i; break }
  }
  const tail = idx >= 0 ? bubbles.slice(idx) : bubbles
  return tail.slice(-3)
}

function previewLine(bubbles: TodoChatBubble[]): string {
  const last = bubbles[bubbles.length - 1]
  if (!last) return ''
  if (last.role === 'user') return `You: ${last.text}`
  if (last.kind === 'error') return `failed: ${last.text}`
  const links = last.links.map((l) => l.label).join(', ')
  return last.text || links
}

function ConversationsSection({ threads, running, conversations, expanded, replyFor, onToggle, onReply, onSendReply, onOpenNote, onOpenInChat }: {
  threads: StreamThread[]
  running: Set<string>
  conversations: Record<string, TodoChatBubble[]>
  expanded: string | null
  replyFor: string | null
  onToggle: (sessionId: string) => void
  onReply: (sessionId: string) => void
  onSendReply: (sessionId: string, message: string) => void
  onOpenNote: (path: string) => void
  onOpenInChat: (sessionId: string) => void
}) {
  if (threads.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      <div className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Conversations</div>
      <div className="rounded-xl border border-border bg-card px-4 py-2">
        {threads.map((t) => {
          const isRunning = running.has(`chat:${t.sessionId}`)
          const isOpen = expanded === t.sessionId
          const bubbles = conversations[t.sessionId] ?? []
          const preview = previewLine(bubbles)
          return (
            <div key={t.sessionId} className="group/thread border-b border-border/40 py-1.5 last:border-b-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onToggle(t.sessionId)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="flex items-center gap-2">
                    <MessageCircle className="size-3.5 shrink-0 text-muted-foreground/60" />
                    <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                  </span>
                  {/* One glance = where this ended up. Click = the peek. */}
                  {preview && !isOpen && (
                    <span className="block truncate pl-[22px] text-[12px] text-muted-foreground/70">{preview}</span>
                  )}
                </button>
                {isRunning && <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />}
                <span className="shrink-0 text-[11px] text-muted-foreground/60">{relativeTime(t.updatedAt)}</span>
                <button
                  type="button"
                  onClick={() => onOpenInChat(t.sessionId)}
                  title="Open the full thread in the chat sidebar"
                  className="shrink-0 rounded-md p-1 text-muted-foreground/50 opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/thread:opacity-100"
                >
                  <ArrowUpRight className="size-3.5" />
                </button>
              </div>
              {isOpen && (
                <div className="flex flex-col gap-1.5 pb-1 pl-5 pt-1">
                  {/* The last response only — the full thread lives in the
                      sidebar, like Slack threads opening on the side. */}
                  {lastResponseTail(bubbles).map((b, i) => (
                    <Bubble key={i} b={b} onOpenNote={onOpenNote} />
                  ))}
                  {isRunning && (
                    <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" /> working…
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    {replyFor !== t.sessionId && (
                      <button
                        type="button"
                        onClick={() => onReply(t.sessionId)}
                        className="flex w-fit items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Plus className="size-3" /> reply
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpenInChat(t.sessionId)}
                      className="flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      view full thread →
                    </button>
                  </div>
                  {replyFor === t.sessionId && (
                    <CommentComposer
                      onSend={(m) => onSendReply(t.sessionId, m)}
                      onCancel={() => onReply(t.sessionId)}
                    />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Everything dismissed or cleared lands here (todo/archive/), listed below
// the composer and restorable — nothing typed into the list is ever lost.
function ArchivedSection({ entries, onRestore, onOpenNote }: {
  entries: ArchivedEntry[]
  onRestore: (entry: ArchivedEntry) => void
  onOpenNote: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (entries.length === 0) return null
  return (
    <div className="rounded-xl border border-border bg-card/60 px-4 py-2.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
        Done &amp; dismissed · {entries.length}
      </button>
      {open && (
        <div className="mt-2 flex flex-col">
          {entries.map((entry) => (
            <div key={`${entry.month}:${entry.blockIndex}`} className="group/arch flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-accent/40">
              <span className="mt-[3px] size-4 shrink-0 text-center text-[13px] leading-4 text-muted-foreground/60">
                {entry.item.checked ? '✓' : '·'}
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-sm text-muted-foreground ${entry.item.checked ? 'line-through' : ''}`}>
                  <TextWithMentions text={entry.item.text} onOpenLink={(l) => openLink(l, onOpenNote)} />
                  {entry.date && <span className="ml-2 text-[11px] text-muted-foreground/60">{entry.date}</span>}
                </div>
                {entry.item.receipts.length > 0 && (
                  <div className="mt-0.5 flex flex-wrap gap-1.5">
                    {entry.item.receipts.flatMap((r) => r.links).map((l, j) => (
                      <button
                        key={j}
                        type="button"
                        onClick={() => openLink(l, onOpenNote)}
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-border hover:bg-accent hover:text-foreground"
                      >
                        <ArrowUpRight className="size-3" /> {l.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onRestore(entry)}
                title="Bring this back onto the list"
                className="mt-0.5 flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/arch:opacity-100"
              >
                <RotateCcw className="size-3" /> restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function TodoView({ onOpenNote, onOpenInChat, onShowOverview, composer, onComposeTodo }: TodoViewProps) {
  const [blocks, setBlocks] = useState<TodoBlock[] | null>(null)
  const [running, setRunning] = useState<Set<string>>(new Set())
  const [sessions, setSessions] = useState<Record<string, string>>({})
  const [conversations, setConversations] = useState<Record<string, TodoChatBubble[]>>({})
  const [archived, setArchived] = useState<ArchivedEntry[]>([])
  const [showCallout, setShowCallout] = useState(false)
  const [commentKey, setCommentKey] = useState<string | null>(null)
  const [subDraftFor, setSubDraftFor] = useState<string | null>(null)
  // The stream: recent chat threads (non-todo sessions).
  const [streamThreads, setStreamThreads] = useState<StreamThread[]>([])
  const [streamConvs, setStreamConvs] = useState<Record<string, TodoChatBubble[]>>({})
  const [expandedThread, setExpandedThread] = useState<string | null>(null)
  const [chatReplyFor, setChatReplyFor] = useState<string | null>(null)
  // Attention: triage filter + changed-since-last-look baseline.
  const [triageFilter, setTriageFilter] = useState<'needs_you' | 'running' | 'done' | null>(null)
  const [sessionUpdatedAt, setSessionUpdatedAt] = useState<Record<string, string>>({})
  const [seenBaseline, setSeenBaseline] = useState<string>(() => localStorage.getItem('todo.seenBaseline') ?? new Date(0).toISOString())

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
    setSessions(res.sessions)
    void window.ipc.invoke('todo:listArchived', null).then((r) => setArchived(r.items)).catch(() => {})
    // The stream: every session that isn't a to-do thread, newest first.
    void window.ipc.invoke('sessions:list', {}).then(({ sessions: all }) => {
      const todoSessionIds = new Set(Object.values(res.sessions))
      setSessionUpdatedAt(Object.fromEntries(all.map((s) => [s.sessionId, s.updatedAt])))
      const threads = all
        .filter((s) => !todoSessionIds.has(s.sessionId))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 8)
        .map((s) => ({ sessionId: s.sessionId, title: s.title ?? 'New chat', updatedAt: s.updatedAt }))
      setStreamThreads(threads)
      for (const t of threads) {
        if (streamConvFetchedRef.current[t.sessionId] !== t.updatedAt) {
          void fetchStreamConv(t.sessionId, t.updatedAt)
        }
      }
    }).catch(() => {})
    // Conversations are derived per session; fetch them all (lists are small).
    const keys = Object.keys(res.sessions)
    const fetched = await Promise.all(
      keys.map(async (key) => {
        try {
          const conv = await window.ipc.invoke('todo:getConversation', { key })
          return [key, conv.bubbles] as const
        } catch {
          return [key, []] as const
        }
      }),
    )
    setConversations(Object.fromEntries(fetched))
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

  // Conversation cache keyed by the session's updatedAt — collapsed rows
  // need the last response for their preview line, so every visible thread
  // gets fetched, but only re-derived when it actually advanced.
  const streamConvFetchedRef = useRef<Record<string, string>>({})
  const fetchStreamConv = useCallback(async (sessionId: string, updatedAt?: string) => {
    try {
      const r = await window.ipc.invoke('todo:getSessionConversation', { sessionId })
      if (updatedAt) streamConvFetchedRef.current[sessionId] = updatedAt
      setStreamConvs((c) => ({ ...c, [sessionId]: r.bubbles }))
    } catch {
      // session may have been deleted
    }
  }, [])
  const expandedThreadRef = useRef<string | null>(null)
  useEffect(() => { expandedThreadRef.current = expandedThread }, [expandedThread])

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
        if (event.key.startsWith('chat:')) {
          const sid = event.key.slice('chat:'.length)
          if (expandedThreadRef.current === sid) void fetchStreamConv(sid)
        } else if (event.type === 'run_complete' && !localStorage.getItem(CALLOUT_KEY)) {
          setShowCallout(true)
        }
      }
      void refetch()
    })
    return off
  }, [refetch, fetchStreamConv])

  // "Seen" baseline: leaving the window marks everything current as seen —
  // what changes while you're away gets the dot and the catch-up strip.
  useEffect(() => {
    const markSeen = () => {
      const now = new Date().toISOString()
      localStorage.setItem('todo.seenBaseline', now)
      setSeenBaseline(now)
    }
    window.addEventListener('blur', markSeen)
    return () => window.removeEventListener('blur', markSeen)
  }, [])

  // Flush pending edits when the view unmounts
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (dirtyRef.current) void saveNowRef.current()
  }, [])

  // Dock chats advance without todo:events — follow the session index feed
  // (debounced: it fires per turn event) so the stream stays current.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = window.ipc.on('sessions:events', () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void refetch(), 600)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [refetch])

  const runItem = useCallback((key: string) => {
    setRunning((s) => new Set(s).add(key))
    void window.ipc.invoke('todo:runItem', { key })
  }, [])

  const commentOnItem = useCallback((key: string, message: string) => {
    setCommentKey(null)
    setRunning((s) => new Set(s).add(key))
    // Optimistic bubble; the canonical one arrives with the next refetch.
    setConversations((c) => ({ ...c, [key]: [...(c[key] ?? []), { role: 'user', text: message, links: [] }] }))
    void window.ipc.invoke('todo:comment', { key, message })
  }, [])

  const toggleThread = useCallback((sessionId: string) => {
    setExpandedThread((cur) => {
      const next = cur === sessionId ? null : sessionId
      if (next) void fetchStreamConv(next)
      return next
    })
    setChatReplyFor(null)
  }, [fetchStreamConv])

  const startChat = useCallback(async (text: string) => {
    const res = await window.ipc.invoke('todo:startChat', { text })
    if (res.success && res.sessionId) {
      const sid = res.sessionId
      setRunning((s) => new Set(s).add(`chat:${sid}`))
      setStreamConvs((c) => ({ ...c, [sid]: [{ role: 'user', text, links: [] }] }))
      setStreamThreads((t) => [{ sessionId: sid, title: text, updatedAt: new Date().toISOString() }, ...t])
      setExpandedThread(sid)
    }
  }, [])

  const sendChatReply = useCallback((sessionId: string, message: string) => {
    setChatReplyFor(null)
    setRunning((s) => new Set(s).add(`chat:${sessionId}`))
    setStreamConvs((c) => ({ ...c, [sessionId]: [...(c[sessionId] ?? []), { role: 'user', text: message, links: [] }] }))
    void window.ipc.invoke('todo:chatReply', { sessionId, message })
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

  const dismissKey = useCallback(async (key: string) => {
    // Flush edits so the archived copy matches the screen.
    if (dirtyRef.current) await saveNowRef.current()
    await window.ipc.invoke('todo:dismiss', { key })
    await refetch()
  }, [refetch])

  const addSub = useCallback(async (parentKey: string, text: string) => {
    setSubDraftFor(null)
    if (dirtyRef.current) await saveNowRef.current()
    await window.ipc.invoke('todo:addSubItem', { parentKey, text, run: mentionsRowboat(text) })
    await refetch()
  }, [refetch])

  // Apply a change to one sub-item (null = remove the row).
  const updateChild = useCallback((index: number, ci: number, updater: (c: TodoItem) => TodoItem | null) => {
    const next = [...blocksRef.current!]
    const blk = next[index]
    if (blk.kind !== 'item') return
    const children = [...blk.item.children]
    const updated = updater(children[ci])
    if (updated === null) children.splice(ci, 1)
    else children[ci] = updated
    next[index] = { kind: 'item', item: { ...blk.item, children } }
    mutate(next)
  }, [mutate])

  const itemBlocks = (blocks ?? []).map((b, i) => ({ block: b, index: i }))
  const hasCompleted = itemBlocks.some(({ block }) => block.kind === 'item' && block.item.checked)
  const todayLabel = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })

  // ---- Attention: triage counts + changed-since-last-look ----
  const allItems: TodoItem[] = itemBlocks.flatMap(({ block }) =>
    block.kind === 'item' ? [block.item, ...block.item.children] : [],
  )
  const needsYou = (i: TodoItem) => !i.checked && i.receipts.some((r) => r.kind === 'question')
  const triageMatch = (i: TodoItem): boolean => {
    if (triageFilter === 'needs_you') return needsYou(i)
    if (triageFilter === 'running') return running.has(i.key)
    if (triageFilter === 'done') return i.checked
    return true
  }
  // A parent stays visible when any of its steps match.
  const blockMatches = (i: TodoItem) => triageMatch(i) || i.children.some(triageMatch)
  const needsYouCount = allItems.filter(needsYou).length
  const runningCount = allItems.filter((i) => running.has(i.key)).length
  const doneCount = allItems.filter((i) => i.checked).length

  const isChanged = (key: string): boolean => {
    const sid = sessions[key]
    return !!sid && (sessionUpdatedAt[sid] ?? '') > seenBaseline
  }
  const changedItems = allItems.filter((i) => isChanged(i.key))
  const changedNeedsYou = changedItems.filter(needsYou).length
  const changedFinished = changedItems.length - changedNeedsYou

  const markSeenNow = () => {
    const now = new Date().toISOString()
    localStorage.setItem('todo.seenBaseline', now)
    setSeenBaseline(now)
  }

  const triagePill = (filter: 'needs_you' | 'running' | 'done', label: string, count: number, tone: string) => (
    count > 0 && (
      <button
        type="button"
        onClick={() => setTriageFilter(triageFilter === filter ? null : filter)}
        className={`${CHIP} border transition-colors ${
          triageFilter === filter ? 'border-primary/40 bg-primary/10 text-primary' : `border-border ${tone} hover:bg-accent`
        }`}
      >
        {count} {label}
      </button>
    )
  )

  return (
    <div className="flex h-full flex-col overflow-hidden bg-muted/30">
      <div className="flex-1 overflow-y-auto px-9 py-7">
        <div className="mx-auto flex max-w-[720px] flex-col gap-4">

          {/* Header */}
          <div className="flex items-center gap-3">
            <h1 className="text-[28px] font-semibold tracking-tight">{todayLabel}</h1>
            <div className="flex items-center gap-1.5">
              {triagePill('needs_you', 'need you', needsYouCount, 'text-amber-600 dark:text-amber-400')}
              {triagePill('running', 'running', runningCount, 'text-primary')}
              {triagePill('done', 'done', doneCount, 'text-muted-foreground')}
            </div>
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

          {/* While you were away — dismissable catch-up */}
          {changedItems.length > 0 && (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm">
              <span className="size-1.5 shrink-0 rounded-full bg-primary" />
              <span className="flex-1">
                While you were away:
                {changedFinished > 0 && ` ${changedFinished} item${changedFinished === 1 ? '' : 's'} got updates`}
                {changedFinished > 0 && changedNeedsYou > 0 && ' ·'}
                {changedNeedsYou > 0 && ` ${changedNeedsYou} need${changedNeedsYou === 1 ? 's' : ''} you`}
                {' '}— marked with dots.
              </span>
              <button
                type="button"
                onClick={markSeenNow}
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}

          {/* First-completion callout — shown once, ever */}
          {showCallout && (
            <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm">
              <Bot className="size-4 shrink-0 text-primary" />
              <span className="flex-1">@rowboat finished an item — the → line under it links to what it did. Hit ＋ on the row to refine the work with a comment; 💬 opens the whole conversation in the sidebar.</span>
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
                    depth={0}
                    changed={isChanged(item.key)}
                    dimmed={triageFilter !== null && !blockMatches(item)}
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
                      const updated: TodoItem = { ...item, text, key: normKey(text), delegated: mentionsRowboat(text) }
                      next[index] = { kind: 'item', item: updated }
                      mutate(next)
                      // Typing @rowboat into a line is the go signal.
                      if (!wasDelegated && updated.delegated && !updated.checked) {
                        void saveNowRef.current().then(() => runItem(updated.key))
                      }
                    }}
                    onDismiss={() => void dismissKey(item.key)}
                    onRun={() => runItem(item.key)}
                    onOpenNote={onOpenNote}
                    commentOpen={commentKey === item.key}
                    sessionId={sessions[item.key] ?? null}
                    bubbles={conversations[item.key] ?? []}
                    onToggleComment={() => setCommentKey(commentKey === item.key ? null : item.key)}
                    onComment={(message) => commentOnItem(item.key, message)}
                    onOpenInChat={onOpenInChat}
                    onAddSub={() => (onComposeTodo
                      ? onComposeTodo({ kind: 'sub', parentKey: item.key, parentText: item.text })
                      : setSubDraftFor(subDraftFor === item.key ? null : item.key))}
                    childRows={(item.children.length > 0 || subDraftFor === item.key) && (
                      <div className="mt-1 flex flex-col border-l border-border/60 pl-1">
                        {item.children.map((child, ci) => (
                          <ItemRow
                            key={`${index}:${ci}:${child.key}`}
                            item={child}
                            depth={1}
                            changed={isChanged(child.key)}
                            dimmed={triageFilter !== null && !triageMatch(child)}
                            isRunning={running.has(child.key)}
                            onToggle={(checked) => updateChild(index, ci, (c) => ({ ...c, checked }))}
                            onCommitText={(text) => {
                              if (text === '') {
                                updateChild(index, ci, () => null)
                                return
                              }
                              const wasDelegated = child.delegated
                              const newKey = childKey(item.text, text)
                              updateChild(index, ci, (c) => ({ ...c, text, key: newKey, delegated: mentionsRowboat(text) }))
                              if (!wasDelegated && mentionsRowboat(text) && !child.checked) {
                                void saveNowRef.current().then(() => runItem(newKey))
                              }
                            }}
                            onDismiss={() => void dismissKey(child.key)}
                            onRun={() => runItem(child.key)}
                            onOpenNote={onOpenNote}
                            commentOpen={commentKey === child.key}
                            sessionId={sessions[child.key] ?? null}
                            bubbles={conversations[child.key] ?? []}
                            onToggleComment={() => setCommentKey(commentKey === child.key ? null : child.key)}
                            onComment={(message) => commentOnItem(child.key, message)}
                            onOpenInChat={onOpenInChat}
                          />
                        ))}
                        {subDraftFor === item.key && (
                          <SubComposer
                            onSubmit={(text) => void addSub(item.key, text)}
                            onCancel={() => setSubDraftFor(null)}
                          />
                        )}
                      </div>
                    )}
                  />
                )
              })
            )}
            {blocks !== null && (onComposeTodo ? (
              // Routes into the composer below with the "To-do" chip set —
              // one input, destination announced.
              <button
                type="button"
                onClick={() => onComposeTodo({ kind: 'todo' })}
                className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground/70 hover:bg-accent/40 hover:text-foreground"
              >
                <Plus className="size-4 shrink-0" />
                Add a to-do…
              </button>
            ) : (
              <AddItemRow onAdd={(text) => void addItem(text)} />
            ))}
          </div>

          {/* The stream — recent chat threads */}
          <ConversationsSection
            threads={streamThreads}
            running={running}
            conversations={streamConvs}
            expanded={expandedThread}
            replyFor={chatReplyFor}
            onToggle={toggleThread}
            onReply={(sid) => setChatReplyFor(chatReplyFor === sid ? null : sid)}
            onSendReply={sendChatReply}
            onOpenNote={onOpenNote}
            onOpenInChat={onOpenInChat}
          />

          {/* Done & dismissed — the archive, restorable */}
          <ArchivedSection
            entries={archived}
            onOpenNote={onOpenNote}
            onRestore={(entry) => {
              void (async () => {
                if (dirtyRef.current) await saveNowRef.current()
                await window.ipc.invoke('todo:restore', { month: entry.month, blockIndex: entry.blockIndex, key: entry.item.key })
                await refetch()
              })()
            }}
          />

          <div className="text-[11px] text-muted-foreground/60">
            Saved to <code className="rounded bg-muted px-1">~/.rowboat/todo.md</code> — done items archive to <code className="rounded bg-muted px-1">todo/archive/</code>.
          </div>
        </div>
      </div>

      {/* The assistant composer — pinned to the bottom like any chat
          surface; everything above scrolls. Tasks are born in the list's
          add-row or by @rowboat mention. */}
      <div className="shrink-0 px-9 pb-5 pt-2">
        <div className="mx-auto max-w-[720px]">
          {composer ?? <Composer onSubmit={(text, kind) => void (kind === 'task' ? addItem(text) : startChat(text))} />}
        </div>
      </div>
    </div>
  )
}
