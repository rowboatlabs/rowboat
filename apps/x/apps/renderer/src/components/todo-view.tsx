import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Bot, Check, ChevronDown, FileText, LayoutGrid, ListPlus, Loader2, MessageCircle, Plus, RotateCcw, Sparkles, Square, SquarePen, Trash2, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import type { TodoBlock, TodoChatBubble, TodoEventType, TodoItem, TodoLink, TodoList } from '@x/shared/dist/todo.js'
import type { HomeThread } from '@x/shared/dist/home-threads.js'

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
  /** Start a brand-new chat (the app's canonical new-chat flow). */
  onNewChat?: () => void
  /** Focus the page-bottom composer — the "c" shortcut's landing spot. */
  onFocusComposer?: () => void
  /** The real assistant composer, mounted by App (full features, submits
   * through the app's chat machinery). Falls back to a basic input. */
  composer?: React.ReactNode
  /** Route a ＋/reply affordance into the composer with a destination chip. */
  onComposeTodo?: (target: ComposeTarget) => void
  /** "View all →" in the Conversations section — the chat history view. */
  onOpenChatHistory?: () => void
  /** The composer's current destination (from App) — drives the spotlight
   * connecting the source row to the composer while a reply is composed. */
  composeTarget?: ComposeTarget | null
  /** The composer's live model pick (model + paired effort) — run/retry
   * chips and inline comments honor it, same as composer-born runs. */
  getRunModel?: () => { provider: string; model: string; effort?: 'low' | 'medium' | 'high' } | undefined
  /** A code strip's door: the Code section (diffs, terminal, worktree),
   * focused on the session. Falls back to the chat dock when absent. */
  onOpenCodeSession?: (sessionId: string) => void
}

type ComposeTarget =
  | { kind: 'todo'; prefill?: string }
  | { kind: 'sub'; parentKey: string; parentText: string; prefill?: string }
  | { kind: 'comment'; key: string; itemText: string; quote?: string }
  | { kind: 'chatReply'; sessionId: string; title: string; quote?: string }

const ROWBOAT_MENTION_RE = /(^|\s)@rowboat\b/i
const CHIP = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4'
const CALLOUT_KEY = 'todo.firstReceiptCalloutDone'

function mentionsRowboat(text: string): boolean {
  return ROWBOAT_MENTION_RE.test(text)
}

// True when a keyboard event originated in a text-entry context, so
// single-letter shortcuts must stay inert (email-view's convention).
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return Boolean(
    el
    && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable),
  )
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

// Real tooltips for icon-only buttons (native title is too slow to teach).
function IconTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
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

// Render @rowboat mentions as chips, [label](target) links as buttons, and
// light inline markdown (**bold**, `code`) inside a read-only text row.
function TextWithMentions({ text, onOpenLink }: { text: string; onOpenLink?: (link: TodoLink) => void }) {
  const parts = text.split(/(@rowboat|\[[^\]]+\]\([^)]+\)|\*\*[^*\n]+\*\*|`[^`\n]+`)/i)
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
        const bold = /^\*\*([^*\n]+)\*\*$/.exec(part)
        if (bold) return <strong key={i}>{bold[1]}</strong>
        const code = /^`([^`\n]+)`$/.exec(part)
        if (code) {
          return <code key={i} className="rounded bg-muted px-1 font-mono text-[0.92em]">{code[1]}</code>
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

// The agent references files with ```filepath fences (one path per line) —
// render those as clickable file chips, any other fence as a code block,
// and the text between through TextWithMentions.
function BubbleText({ text, onOpenNote }: { text: string; onOpenNote: (path: string) => void }) {
  const fence = /```([\w-]*)[ \t]*\n?([\s\S]*?)```/g
  const nodes: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  const pushText = (seg: string) => {
    const trimmed = seg.replace(/^\n/, '').replace(/\n$/, '')
    if (trimmed) nodes.push(<TextWithMentions key={k++} text={trimmed} onOpenLink={(l) => openLink(l, onOpenNote)} />)
  }
  while ((m = fence.exec(text)) !== null) {
    if (m.index > last) pushText(text.slice(last, m.index))
    const lang = (m[1] ?? '').toLowerCase()
    const body = m[2].replace(/\n$/, '')
    if (lang === 'filepath') {
      const paths = body.split('\n').map((s) => s.trim()).filter(Boolean)
      nodes.push(
        <span key={k++} className="my-1 flex flex-wrap gap-1.5">
          {paths.map((p, j) => (
            <button
              key={j}
              type="button"
              title={p}
              onClick={() => onOpenNote(p)}
              className="inline-flex items-center gap-1 rounded-md bg-background px-1.5 py-0.5 text-[12px] font-medium text-foreground shadow-sm ring-1 ring-border hover:bg-accent"
            >
              <FileText className="size-3" /> {p.split('/').pop()}
            </button>
          ))}
        </span>,
      )
    } else {
      nodes.push(
        <pre key={k++} className="my-1 overflow-x-auto rounded-md bg-muted px-2 py-1.5 font-mono text-[12px] leading-relaxed">
          {body}
        </pre>,
      )
    }
    last = m.index + m[0].length
  }
  if (last < text.length) pushText(text.slice(last))
  return <>{nodes}</>
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
    <div className="mt-0.5 flex flex-col gap-0.5">
      {item.receipts.map((r, i) => {
        if (r.kind === 'question') {
          return (
            <button
              key={i}
              type="button"
              onClick={onOpenThread}
              title="Answer in the thread"
              className="flex items-baseline gap-1.5 text-left text-[12.5px] text-amber-600 hover:underline dark:text-amber-400"
            >
              <span className="select-none text-muted-foreground/50">↳</span>
              <span><span className="font-medium">needs you:</span> {r.text}</span>
            </button>
          )
        }
        if (r.kind === 'error') {
          return (
            <div key={i} className="flex items-baseline gap-1.5 text-[12.5px] text-red-600 dark:text-red-400">
              <span className="select-none text-muted-foreground/50">↳</span>
              <span className="min-w-0 flex-1 truncate" title={r.text}>failed: {r.text}</span>
              <button type="button" onClick={onRetry} className="shrink-0 font-medium hover:underline">
                retry
              </button>
            </div>
          )
        }
        return (
          <div key={i} className="flex flex-wrap items-baseline gap-1.5 text-[12.5px] text-muted-foreground">
            <span className="select-none text-muted-foreground/50">↳</span>
            {r.links.map((l, j) => (
              <button
                key={j}
                type="button"
                onClick={() => openLink(l, onOpenNote)}
                className="font-medium text-foreground hover:underline"
              >
                {l.label}
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

function SubComposer({ onSubmit, onCancel, onHandoff }: {
  onSubmit: (text: string) => void
  onCancel: () => void
  onHandoff?: (text: string) => void
}) {
  const [text, setText] = useState('')
  const mention = useMention(text, setText)
  useEffect(() => {
    if (onHandoff && mentionsRowboat(text)) {
      onHandoff(text)
      setText('')
    }
  }, [text, onHandoff])
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
            // Stay open, like the main add-row: Enter lands the step and
            // the cursor is already on the next one. Escape closes.
            setText('')
          }
          if (e.key === 'Enter' && !text.trim()) onCancel()
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

// Hard ceiling for the Conversations stream — active threads (running or
// unread) win the slots, but nothing pushes the section past this. The rest
// live in "View all".
const STREAM_CAP = 8

function Bubble({ b, onOpenNote, onRetry }: {
  b: TodoChatBubble
  onOpenNote: (path: string) => void
  onRetry?: () => void
}) {
  // Flat message rows, Slack-style: avatar + name, no chat bubbles.
  const isUser = b.role === 'user'
  return (
    <div className="flex gap-2">
      <span
        className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md text-[10px] font-bold ${
          isUser ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground'
        }`}
      >
        {isUser ? 'A' : 'R'}
      </span>
      <div
        className={`min-w-0 whitespace-pre-wrap text-[13px] ${
          b.kind === 'error'
            ? 'text-red-600 dark:text-red-400'
            : 'text-foreground'
        }`}
      >
        <span className="mr-1.5 text-[12px] font-bold">{isUser ? 'you' : 'rowboat'}</span>
        {b.kind === 'error' ? `failed: ${b.text}` : <BubbleText text={b.text} onOpenNote={onOpenNote} />}
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

function ItemRow({ item, isRunning, needsApproval = null, commentOpen, sessionId, bubbles, depth = 0, changed = false, dimmed = false, spotlight = false, collapsed = false, onToggleCollapsed, childRows, onAddSub, onToggle, onCommitText, onDismiss, onRun, onStop, onOpenNote, onToggleComment, onComment, onOpenInChat, onEnterNext }: {
  item: TodoItem
  isRunning: boolean
  /** The live run is suspended on a permission prompt — approve from the chat. */
  needsApproval?: string | null
  commentOpen: boolean
  sessionId: string | null
  bubbles: TodoChatBubble[]
  /** 0 = top-level, 1 = sub-item. One level only. */
  depth?: number
  /** Activity since the user last looked — renders the unread dot. */
  changed?: boolean
  /** Triage filter active and this row doesn't match. */
  dimmed?: boolean
  /** The composer is replying to this row — lift it gently. */
  spotlight?: boolean
  /** Collapsed = just the line + a one-line preview; content hidden. */
  collapsed?: boolean
  onToggleCollapsed?: () => void
  /** Rendered sub-item rows (built by the parent view) + sub composer. */
  childRows?: React.ReactNode
  /** Top-level only: open the "add sub-task" input. */
  onAddSub?: () => void
  onToggle: (checked: boolean) => void
  onCommitText: (text: string) => void
  onDismiss: () => void
  onRun: () => void
  /** Stop the live run — the mistaken-assign escape hatch. */
  onStop?: () => void
  onOpenNote: (path: string) => void
  onToggleComment: () => void
  onComment: (message: string) => void
  onOpenInChat: (sessionId: string) => void
  /** Sub-items only: Enter while editing continues the indented list —
   * commit this line, open the next step's composer (bullet-list muscle
   * memory). */
  onEnterNext?: () => void
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
  // Anything under the line makes the row collapsible.
  const collapsible = bubbles.length > 0 || item.children.length > 0 || item.receipts.length > 0
  const isCollapsed = collapsed && collapsible
  const collapsedPreview = isCollapsed && bubbles.length > 0 ? previewLine(bubbles) : null

  return (
    <div data-todo-key={item.key} className={`group/todo relative flex items-start gap-2.5 px-2 py-2 transition-[opacity,transform,box-shadow] duration-200 hover:bg-accent/30 ${depth === 0 ? 'border-b border-border/40' : 'rounded-lg'} ${dimmed ? 'opacity-35' : ''} ${
      spotlight ? 'scale-[1.005] bg-card shadow-md ring-1 ring-primary/25 motion-reduce:transform-none' : ''
    }`}>
      {changed && (
        <span
          title="Changed since you last looked"
          className="absolute -left-1 top-[15px] size-1.5 rounded-full bg-primary"
        />
      )}
      {!item.checked && item.receipts.some((r) => r.kind === 'question') && (
        /* Needs-you tick: short, beside the title only — never tall enough
           to read as a structural rail. */
        <span title="Rowboat needs an answer from you" className="absolute -left-3 top-[9px] h-4 w-[2.5px] rounded bg-amber-500/80" />
      )}
      {collapsible && onToggleCollapsed && (
        <IconTip label={isCollapsed ? 'Expand' : 'Collapse'}>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            className={`absolute -left-5 top-[7px] rounded p-0.5 text-muted-foreground/40 transition-[opacity,color] hover:text-foreground ${
              isCollapsed ? '' : 'opacity-0 focus-visible:opacity-100 group-hover/todo:opacity-100'
            }`}
          >
            <ChevronDown className={`size-3.5 transition-transform ${isCollapsed ? '-rotate-90' : ''} motion-reduce:transition-none`} />
          </button>
        </IconTip>
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
                if (e.key === 'Enter') {
                  commit()
                  if (draft.trim() && onEnterNext) onEnterNext()
                }
                if (e.key === 'Escape') { setDraft(item.text); setEditing(false) }
              }}
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
        ) : (
          <div
            onClick={() => { if (!item.checked) { setDraft(item.text); setEditing(true) } }}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return
              if ((e.key === 'Enter' || e.key === ' ') && !item.checked) {
                e.preventDefault()
                setDraft(item.text)
                setEditing(true)
              }
            }}
            role={item.checked ? undefined : 'button'}
            tabIndex={item.checked ? undefined : 0}
            aria-label={item.checked ? undefined : `Edit to-do: ${item.text}`}
            className={`cursor-text rounded text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${item.checked ? 'text-muted-foreground line-through' : changed ? 'font-semibold' : ''}`}
          >
            <TextWithMentions text={item.text} onOpenLink={(l) => openLink(l, onOpenNote)} />
            {item.proposed && (
              <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 align-middle text-[10px] font-medium text-muted-foreground">via rowboat</span>
            )}
            {item.children.length > 0 && (
              <span
                className={`${CHIP} ml-2 ${allChildrenDone && !item.checked ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground/70'}`}
                title={allChildrenDone && !item.checked ? 'All steps done — check it off?' : undefined}
              >
                {doneChildren}/{item.children.length}
              </span>
            )}
            {isRunning && needsApproval && (
              /* Suspended on a permission prompt — the prompt itself renders
                 in the chat surface, so the chip is a door, not a form. */
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); if (sessionId) onOpenInChat(sessionId) }}
                className={`${CHIP} ml-2 bg-amber-500/15 font-medium text-amber-600 hover:bg-amber-500/25 dark:text-amber-400`}
                title={needsApproval}
              >
                <Bot className="size-3" /> approve in chat
              </button>
            )}
            {isRunning && !needsApproval && (
              <span className={`${CHIP} ml-2 animate-pulse bg-primary/10 text-primary`}>
                <Loader2 className="size-3 animate-spin" /> working…
              </span>
            )}
            {isRunning && onStop && (
              /* Always visible while running — a mistaken assign must be
                 stoppable without hunting through a hover tray. */
              <IconTip label="Stop this run">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onStop() }}
                  aria-label="Stop this run"
                  className={`${CHIP} ml-1 border border-border text-muted-foreground hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400`}
                >
                  <Square className="size-2.5 fill-current" /> stop
                </button>
              </IconTip>
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
                className={`${CHIP} ml-2 border border-border text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/todo:opacity-100`}
              >
                <Bot className="size-3" /> assign
              </button>
            )}
          </div>
        )}
        {isCollapsed ? (
          // The stream's trick: one muted line says where this ended up;
          // clicking it (or the chevron) expands.
          collapsedPreview && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className={`block w-full truncate text-left text-[12.5px] ${
                bubbles[bubbles.length - 1]?.kind === 'error'
                  ? 'text-red-600/80 dark:text-red-400/80'
                  : 'text-muted-foreground'
              } hover:text-foreground`}
            >
              <span className="text-muted-foreground/50">↳ </span>
              {bubbles.length} repl{bubbles.length === 1 ? 'y' : 'ies'} · {collapsedPreview}
            </button>
          )
        ) : (
          <>
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
          </>
        )}
      </div>
      {/* One floating action tray on hover or keyboard focus — Slack's
          grammar: zero resting clutter, one surface to learn. Kept inside
          the row's own band so it never reads as the previous row's
          controls. Opacity (not display) so Tab can reach the buttons. */}
      <div className="pointer-events-none absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5 opacity-0 shadow-md transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover/todo:pointer-events-auto group-hover/todo:opacity-100">
        {!showConversation && (
          <IconTip label="Reply — tell @rowboat something about this">
            <button
              type="button"
              onClick={onToggleComment}
              aria-label="Reply to this item"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </button>
          </IconTip>
        )}
        {onAddSub && depth === 0 && (
          <IconTip label="Add a sub-task">
            <button
              type="button"
              onClick={onAddSub}
              aria-label="Add a sub-task"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ListPlus className="size-3.5" />
            </button>
          </IconTip>
        )}
        {sessionId && (
          <IconTip label="Open the full conversation in the sidebar">
            <button
              type="button"
              onClick={() => onOpenInChat(sessionId)}
              aria-label="Open the full conversation in the sidebar"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ArrowUpRight className="size-3.5" />
            </button>
          </IconTip>
        )}
        <IconTip label="Dismiss — moves to Done & dismissed, restorable">
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </IconTip>
      </div>
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
// the list. Enter appends the line — no model, no modes. The header's
// "New to-do" button and the N shortcut land here via focusSignal.
function AddItemRow({ onAdd, onHandoff, focusSignal }: {
  onAdd: (text: string) => void
  onHandoff?: (text: string) => void
  focusSignal?: number
}) {
  const [text, setText] = useState('')
  const mention = useMention(text, setText)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!focusSignal) return
    inputRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center',
    })
    inputRef.current?.focus()
  }, [focusSignal])
  // Delegation is a message to the agent — the moment the mention lands,
  // composition moves to the full composer where model/attachments apply.
  useEffect(() => {
    if (onHandoff && mentionsRowboat(text)) {
      onHandoff(text)
      setText('')
    }
  }, [text, onHandoff])
  return (
    <div className="group/add relative mt-1 flex items-center gap-2.5 rounded-lg px-2 py-1.5 focus-within:bg-accent/30">
      {mention.show && <MentionPopup onPick={mention.complete} />}
      <Plus className="size-4 shrink-0 text-muted-foreground/50" />
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Tab' && mention.show) { e.preventDefault(); mention.complete(); return }
          if (e.key === 'Enter' && text.trim()) {
            e.preventDefault()
            onAdd(text.trim())
            setText('')
          }
          if (e.key === 'Escape') e.currentTarget.blur()
        }}
        placeholder="Add a to-do… @rowboat hands it off"
        aria-label="Add a to-do"
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
      />
      {!text && (
        <kbd className="rounded border border-border bg-muted px-1 py-px font-mono text-[10px] text-muted-foreground/70 group-focus-within/add:hidden">
          N
        </kbd>
      )}
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

/** Collapse bubble markup for one-line previews: filepath fences become
 * their filenames, other fences a [code] marker, inline markers drop. */
function stripBubbleMarkup(text: string): string {
  return text
    .replace(/```filepath[ \t]*\n?([\s\S]*?)```/g, (_all, body: string) =>
      body.split('\n').map((s) => s.trim()).filter(Boolean).map((p) => p.split('/').pop()).join(', '))
    .replace(/```[\w-]*[ \t]*\n?[\s\S]*?```/g, '[code]')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function previewLine(bubbles: TodoChatBubble[]): string {
  const last = bubbles[bubbles.length - 1]
  if (!last) return ''
  if (last.role === 'user') return `You: ${stripBubbleMarkup(last.text)}`
  if (last.kind === 'error') return `failed: ${last.text}`
  const links = last.links.map((l) => l.label).join(', ')
  return stripBubbleMarkup(last.text) || links
}

function ConversationsSection({ threads, total = 0, loaded = false, running, needsApproval, conversations, expanded, replyFor, spotlightSessionId, dimAll, changedSessionIds, onHide, onViewAll, onNewChat, onToggle, onReply, onSendReply, onOpenNote, onOpenInChat }: {
  threads: StreamThread[]
  /** Threads that exist beyond the cap — the footer says so when > shown. */
  total?: number
  /** The sessions list has answered at least once — distinguishes the
   * empty state from the initial load (which renders nothing). */
  loaded?: boolean
  running: Set<string>
  /** Runs suspended on a permission prompt, keyed `chat:<sessionId>`. */
  needsApproval?: Record<string, string>
  conversations: Record<string, TodoChatBubble[]>
  expanded: string | null
  replyFor: string | null
  /** The composer is replying to this thread — lift it, dim siblings. */
  spotlightSessionId?: string | null
  /** The composer's destination is in the other section — dim this one. */
  dimAll?: boolean
  /** Threads that advanced since the user last looked — unread dots. */
  changedSessionIds?: Set<string>
  /** Hide from Home (attention filter — the session stays in history). */
  onHide?: (sessionId: string) => void
  /** Everything, in the chat history view. */
  onViewAll?: () => void
  /** Start a brand-new chat. */
  onNewChat?: () => void
  onToggle: (sessionId: string) => void
  onReply: (sessionId: string) => void
  onSendReply: (sessionId: string, message: string) => void
  onOpenNote: (path: string) => void
  onOpenInChat: (sessionId: string) => void
}) {
  // Nothing renders until the sessions list has answered once — an empty
  // flash would read as "no chats" during load.
  if (threads.length === 0 && !loaded) return null
  return (
    <div className={`flex flex-col gap-1 transition-opacity duration-200 ${dimAll ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between px-1">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Conversations</div>
        {onNewChat && (
          <IconTip label="Start a new chat — ⌘N">
            <button
              type="button"
              onClick={onNewChat}
              aria-keyshortcuts="Meta+N"
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <SquarePen className="size-3" /> New chat
            </button>
          </IconTip>
        )}
      </div>
      {threads.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 px-3 py-3 text-[13px] text-muted-foreground">
          No conversations yet — ask anything in the composer below, or start a new chat. Every chat lands here.
        </div>
      ) : (
      <div>
        {threads.map((t) => {
          const isRunning = running.has(`chat:${t.sessionId}`)
          const approvalMsg = needsApproval?.[`chat:${t.sessionId}`] ?? null
          const isOpen = expanded === t.sessionId
          const bubbles = conversations[t.sessionId] ?? []
          const preview = previewLine(bubbles)
          const isSpot = spotlightSessionId === t.sessionId
          return (
            <div
              key={t.sessionId}
              className={`group/thread relative border-b border-border/40 py-1.5 transition-[opacity,transform,box-shadow] duration-200 last:border-b-0 ${
                isSpot ? 'scale-[1.005] rounded-lg bg-accent/30 px-2 ring-1 ring-primary/20 motion-reduce:transform-none' : ''
              } ${spotlightSessionId && !isSpot ? 'opacity-40' : ''}`}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    // ⌘click skips the peek and resumes the chat directly —
                    // the chat-history rows' gesture, same muscle memory.
                    if (e.metaKey || e.ctrlKey) { onOpenInChat(t.sessionId); return }
                    onToggle(t.sessionId)
                  }}
                  aria-expanded={isOpen}
                  className="relative min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {changedSessionIds?.has(t.sessionId) && (
                    <span
                      title="New activity since you last looked"
                      className="absolute -left-2.5 top-[7px] size-1.5 rounded-full bg-primary"
                    />
                  )}
                  <span className="flex items-center gap-2">
                    <MessageCircle className="size-3.5 shrink-0 text-muted-foreground/60" />
                    <span className={`min-w-0 flex-1 truncate text-sm ${changedSessionIds?.has(t.sessionId) ? 'font-semibold' : ''}`}>{t.title}</span>
                  </span>
                  {/* One glance = where this ended up. Click = the peek. */}
                  {preview && !isOpen && (
                    <span className="block truncate pl-[22px] text-[12px] text-muted-foreground/70">{preview}</span>
                  )}
                </button>
                {isRunning && approvalMsg && (
                  <button
                    type="button"
                    onClick={() => onOpenInChat(t.sessionId)}
                    className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600 hover:bg-amber-500/25 dark:text-amber-400"
                    title={approvalMsg}
                  >
                    approve in chat
                  </button>
                )}
                {isRunning && !approvalMsg && <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />}
                <span className="shrink-0 text-[11px] text-muted-foreground/60">{relativeTime(t.updatedAt)}</span>
                {/* Same floating tray as items — one grammar everywhere,
                    inside the row's own band (never over the previous row).
                    Opacity (not display) so Tab can reach the buttons. */}
                <div className="pointer-events-none absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5 opacity-0 shadow-md transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover/thread:pointer-events-auto group-hover/thread:opacity-100">
                  <IconTip label="Reply">
                    <button
                      type="button"
                      onClick={() => onReply(t.sessionId)}
                      aria-label="Reply"
                      className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </IconTip>
                  <IconTip label="Open the full thread in the sidebar">
                    <button
                      type="button"
                      onClick={() => onOpenInChat(t.sessionId)}
                      aria-label="Open the full thread in the sidebar"
                      className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <ArrowUpRight className="size-3.5" />
                    </button>
                  </IconTip>
                  {onHide && (
                    <IconTip label="Hide from Home — stays in your chat history">
                      <button
                        type="button"
                        onClick={() => onHide(t.sessionId)}
                        aria-label="Hide from Home"
                        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <X className="size-3.5" />
                      </button>
                    </IconTip>
                  )}
                </div>
              </div>
              {isOpen && (
                <div className="flex flex-col gap-1.5 pb-1 pl-5 pt-1">
                  {/* The last response only — the full thread lives in the
                      sidebar, like Slack threads opening on the side. */}
                  {lastResponseTail(bubbles).map((b, i) => (
                    <Bubble key={i} b={b} onOpenNote={onOpenNote} />
                  ))}
                  {isRunning && approvalMsg && (
                    <button
                      type="button"
                      onClick={() => onOpenInChat(t.sessionId)}
                      className="flex w-fit items-center gap-1.5 text-[12px] font-medium text-amber-600 hover:underline dark:text-amber-400"
                    >
                      waiting for your approval — open the chat to allow it →
                    </button>
                  )}
                  {isRunning && !approvalMsg && (
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
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="flex w-full items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-muted-foreground/70 hover:text-foreground"
          >
            {total > threads.length
              ? `latest ${threads.length} of ${total} — view all →`
              : 'View all →'}
          </button>
        )}
      </div>
      )}
    </div>
  )
}

// Everything dismissed or cleared lands here (todo/archive/), listed below
// the composer and restorable — nothing typed into the list is ever lost.
function ArchivedSection({ entries, onRestore, onDelete, onOpenNote }: {
  entries: ArchivedEntry[]
  onRestore: (entry: ArchivedEntry) => void
  onDelete: (entry: ArchivedEntry) => void
  onOpenNote: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (entries.length === 0) return null
  return (
    <div className="border-t border-border/60 px-1 py-2.5">
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
              <IconTip label="Bring this back onto the list">
                <button
                  type="button"
                  onClick={() => onRestore(entry)}
                  aria-label="Restore"
                  className="mt-0.5 flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/arch:opacity-100"
                >
                  <RotateCcw className="size-3" /> restore
                </button>
              </IconTip>
              <IconTip label="Delete forever">
                <button
                  type="button"
                  onClick={() => onDelete(entry)}
                  aria-label="Delete forever"
                  className="mt-0.5 flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-600 focus-visible:opacity-100 group-hover/arch:opacity-100 dark:hover:text-red-400"
                >
                  <Trash2 className="size-3" /> delete
                </button>
              </IconTip>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The Deck — the operator band above the ledger. Two bays in fixed order:
// "Needs you" (amber, oldest first — the queue J burns to zero) and
// "Underway" (live threads with a one-line activity feed). A strip is a
// projection of a thread — task, code session, or chat — never a second
// home: clicking one jumps to the item in place or opens the thread in the
// dock. The whole band collapses to nothing when both bays are empty.
// ---------------------------------------------------------------------------

/** Friendly labels for the registry's raw activity (a builtin tool name). */
const ACTIVITY_LABELS: Record<string, string> = {
  starting: 'starting…',
  thinking: 'thinking…',
  'web-search': 'searching the web…',
  'fetch-url': 'reading a page…',
  code_agent_run: 'coding…',
  executeCommand: 'running a command…',
  'file-readText': 'reading files…',
  'file-write': 'writing…',
  'file-grep': 'searching files…',
}

function activityLabel(activity?: string): string {
  if (!activity) return ''
  return ACTIVITY_LABELS[activity] ?? `${activity}…`
}

/** Strip titles are plain text: markdown links and the @rowboat mention
 * collapse away (the row below renders them properly). */
function stripTitle(thread: HomeThread): string {
  return thread.title
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(^|\s)@rowboat\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled'
}

function DeckStrip({ thread, onJump, onOpen }: {
  thread: HomeThread
  /** Click: spotlight the source in place (falls back to the dock). */
  onJump: () => void
  /** ⏎ / the ↗ button: the full conversation in the sidebar. */
  onOpen: () => void
}) {
  const needs = thread.status === 'needs-you' || thread.status === 'ready'
  const live = thread.status === 'underway'
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onJump}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onOpen() } }}
      className="group/strip relative flex cursor-pointer items-center gap-2 border-b border-border/40 px-2 py-1.5 transition-colors hover:bg-accent/30 focus-visible:bg-accent/30 focus-visible:outline-none"
    >
      <span className={`h-4 w-[2.5px] shrink-0 rounded ${needs ? 'bg-amber-500/80' : live ? 'bg-primary/50' : 'bg-border'}`} />
      <span className="w-9 shrink-0 font-mono text-[9.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground/70">{thread.kind}</span>
      {thread.unseen && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
      <span className="max-w-[40%] shrink-0 truncate text-[13px] font-medium">{stripTitle(thread)}</span>
      {thread.code && (
        <span className="shrink-0 rounded bg-accent/60 px-1.5 text-[10px] text-muted-foreground">
          {thread.code.branch ?? thread.code.projectId} · {thread.code.agent}
        </span>
      )}
      {live && <span className="size-1.5 shrink-0 rounded-full bg-primary motion-safe:animate-pulse" />}
      <span className={`min-w-0 flex-1 truncate text-[12px] ${needs ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
        {needs ? (thread.attention ?? 'waiting on you') : activityLabel(thread.activity)}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">{relativeTime(thread.startedAt ?? thread.updatedAt)}</span>
      <IconTip label={thread.kind === 'code' ? 'Open in the Code section — diffs, terminal, worktree' : 'Open the full conversation in the sidebar'}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen() }}
          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/strip:opacity-100"
        >
          <ArrowUpRight className="size-3.5" />
        </button>
      </IconTip>
    </div>
  )
}

export function TodoView({ onOpenNote, onOpenInChat, onShowOverview, onNewChat, onFocusComposer, composer, onComposeTodo, composeTarget, onOpenChatHistory, getRunModel, onOpenCodeSession }: TodoViewProps) {
  const [blocks, setBlocks] = useState<TodoBlock[] | null>(null)
  const [running, setRunning] = useState<Set<string>>(new Set())
  // Live runs suspended on a permission prompt (manual mode): key → message.
  // Ephemeral overlay — cleared when the run settles or the user heads to
  // the chat to approve.
  const [needsApproval, setNeedsApproval] = useState<Record<string, string>>({})
  const [sessions, setSessions] = useState<Record<string, string>>({})
  const [conversations, setConversations] = useState<Record<string, TodoChatBubble[]>>({})
  const [archived, setArchived] = useState<ArchivedEntry[]>([])
  const [showCallout, setShowCallout] = useState(false)
  const [plannerIntroSeen, setPlannerIntroSeen] = useState(() => !!localStorage.getItem('todo.plannerIntroSeen'))
  // The suggestion tray + the planner's Home controls.
  const [suggestions, setSuggestions] = useState<string[]>([])
  // The tray's DOM node — the header's count pill scrolls here.
  const suggestionsRef = useRef<HTMLDivElement>(null)
  const [planner, setPlanner] = useState<{ slug: string | null; active: boolean; frequency: 'morning' | 'twice' | 'thrice' } | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [plannerMenuOpen, setPlannerMenuOpen] = useState(false)
  const plannerMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!plannerMenuOpen) return
    const onDown = (e: MouseEvent) => {
      if (!plannerMenuRef.current?.contains(e.target as Node)) setPlannerMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPlannerMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [plannerMenuOpen])
  const [commentKey, setCommentKey] = useState<string | null>(null)
  const [subDraftFor, setSubDraftFor] = useState<string | null>(null)
  // The stream: recent chat threads (non-todo sessions).
  const [streamThreads, setStreamThreads] = useState<StreamThread[]>([])
  // How many threads exist beyond the cap — for the section's footer line.
  const [streamTotal, setStreamTotal] = useState(0)
  // Sessions list answered at least once — gates the stream's empty state.
  const [streamLoaded, setStreamLoaded] = useState(false)
  // Bumped by the header's "New to-do" button and the N shortcut; the
  // add-row scrolls into view and takes focus.
  const [addFocusSignal, setAddFocusSignal] = useState(0)
  const focusAddRow = useCallback(() => setAddFocusSignal((n) => n + 1), [])
  const [streamConvs, setStreamConvs] = useState<Record<string, TodoChatBubble[]>>({})
  const [expandedThread, setExpandedThread] = useState<string | null>(null)
  const [chatReplyFor, setChatReplyFor] = useState<string | null>(null)
  // Attention: triage filter + changed-since-last-look baseline.
  const [triageFilter, setTriageFilter] = useState<'needs_you' | 'running' | 'done' | null>(null)
  const [sessionUpdatedAt, setSessionUpdatedAt] = useState<Record<string, string>>({})
  const [seenBaseline, setSeenBaseline] = useState<string>(() => localStorage.getItem('todo.seenBaseline') ?? new Date(0).toISOString())
  const seenBaselineRef = useRef(seenBaseline)
  useEffect(() => { seenBaselineRef.current = seenBaseline }, [seenBaseline])
  // Per-session read marks: opening a thread (expand, or into the sidebar)
  // clears its dot immediately — the global baseline only advances on blur.
  const [sessionSeenAt, setSessionSeenAt] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('todo.sessionSeenAt') ?? '{}') as Record<string, string> } catch { return {} }
  })
  const sessionSeenAtRef = useRef(sessionSeenAt)
  useEffect(() => { sessionSeenAtRef.current = sessionSeenAt }, [sessionSeenAt])
  const markSessionSeen = useCallback((sessionId: string) => {
    // Dual-write while the seen-state migrates: the workspace registry is
    // what the Deck (and later Skipper/notifications) read; localStorage
    // still drives the row dots until phase 4 retires it.
    void window.ipc.invoke('home:markSeen', { sessionId }).catch(() => {})
    setSessionSeenAt((m) => {
      const next = { ...m, [sessionId]: new Date().toISOString() }
      // Bounded: drop the oldest marks past 300 — old sessions age out of
      // the dot logic via the blur baseline anyway.
      const keys = Object.keys(next)
      if (keys.length > 300) {
        for (const k of keys.sort((a, b) => next[a].localeCompare(next[b])).slice(0, keys.length - 300)) delete next[k]
      }
      localStorage.setItem('todo.sessionSeenAt', JSON.stringify(next))
      return next
    })
  }, [])
  // Threads hidden from Home — an attention filter, never a record: the
  // sessions stay whole in chat history; losing this file just makes
  // threads reappear.
  const hiddenThreadsRef = useRef<Set<string>>(new Set())
  // Per-row collapse (chevron) — a reading preference, persisted locally.
  const [collapsedRows, setCollapsedRows] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('todo.collapsedRows') ?? '{}') as Record<string, boolean> } catch { return {} }
  })
  const setRowCollapsed = useCallback((key: string, value: boolean) => {
    setCollapsedRows((m) => {
      const next = { ...m, [key]: value }
      localStorage.setItem('todo.collapsedRows', JSON.stringify(next))
      return next
    })
  }, [])

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
    setSuggestions(res.suggestions)
    void window.ipc.invoke('todo:listArchived', null).then((r) => setArchived(r.items)).catch(() => {})
    // The stream: recent non-todo sessions. STREAM_CAP is a hard ceiling —
    // active threads (running, or changed since the user last looked) win
    // the slots, everything else is in "View all".
    void window.ipc.invoke('sessions:list', {}).then(({ sessions: all }) => {
      setStreamLoaded(true)
      const todoSessionIds = new Set(Object.values(res.sessions))
      setSessionUpdatedAt(Object.fromEntries(all.map((s) => [s.sessionId, s.updatedAt])))
      const candidates = all
        .filter((s) => !todoSessionIds.has(s.sessionId) && !hiddenThreadsRef.current.has(s.sessionId))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      const isActive = (s: (typeof candidates)[number]) =>
        res.running.includes(`chat:${s.sessionId}`)
        || (s.updatedAt > seenBaselineRef.current && s.updatedAt > (sessionSeenAtRef.current[s.sessionId] ?? ''))
      const active = candidates.filter(isActive)
      const rest = candidates.filter((s) => !isActive(s))
      const threads = [...active, ...rest]
        .slice(0, STREAM_CAP)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((s) => ({ sessionId: s.sessionId, title: s.title ?? 'New chat', updatedAt: s.updatedAt }))
      setStreamTotal(candidates.length)
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
    // Load the hidden-threads filter, then the data (so the first stream
    // render already respects it).
    void window.ipc.invoke('workspace:readFile', { path: 'config/home-hidden-threads.json' })
      .then((r) => {
        const parsed: unknown = JSON.parse(r.data)
        if (Array.isArray(parsed)) {
          hiddenThreadsRef.current = new Set(parsed.filter((x): x is string => typeof x === 'string'))
        }
      })
      .catch(() => {})
      .finally(() => void refetch())
  }, [refetch])

  useEffect(() => {
    void window.ipc.invoke('todo:getPlanner', null).then(setPlanner).catch(() => {})
  }, [])

  const runPlannerNow = useCallback(async () => {
    if (!planner?.slug || suggesting) return
    setSuggesting(true)
    const before = suggestions.length
    try {
      const res = await window.ipc.invoke('bg-task:run', {
        slug: planner.slug,
        context: 'On-demand refresh from the Home surface — focus on what changed since your last run (new mail, meeting notes, calendar). Same bar as always: few and good, zero is fine.',
      })
      await refetch()
      if (!res.success) {
        toast.error('Suggestion run failed', { description: res.error ?? 'Check Background agents for details.' })
      }
    } finally {
      setSuggesting(false)
      // A beat for the refetch above; compare via fresh fetch result.
      void window.ipc.invoke('todo:get', null).then((r) => {
        if (r.suggestions.length <= before) toast('Nothing new worth suggesting', { description: 'Rowboat looked and came back empty-handed — that\'s a feature.' })
      }).catch(() => {})
    }
  }, [planner, suggesting, suggestions.length, refetch])

  const acceptSuggestion = useCallback(async (text: string) => {
    await window.ipc.invoke('todo:acceptSuggestion', { text })
    await refetch()
  }, [refetch])

  const declineSuggestion = useCallback(async (text: string) => {
    await window.ipc.invoke('todo:declineSuggestion', { text })
    await refetch()
    toast('Suggestion declined', {
      action: {
        label: "Don't suggest things like this",
        onClick: () => {
          void window.ipc.invoke('todo:teach', { text }).then(() => {
            toast.success('Noted — rule added to todo/preferences.md')
          })
        },
      },
    })
  }, [refetch])

  const hideThread = useCallback((sessionId: string) => {
    hiddenThreadsRef.current.add(sessionId)
    setStreamThreads((t) => t.filter((x) => x.sessionId !== sessionId))
    void window.ipc.invoke('workspace:writeFile', {
      path: 'config/home-hidden-threads.json',
      data: JSON.stringify([...hiddenThreadsRef.current].slice(-200), null, 2),
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const off = window.ipc.on('todo:events', (event: TodoEventType) => {
      if (event.type === 'run_start') {
        setRunning((s) => new Set(s).add(event.key))
        return
      }
      if (event.type === 'attention') {
        setNeedsApproval((a) => ({ ...a, [event.key]: event.message }))
        void refetch()
        return
      }
      if (event.type === 'run_complete' || event.type === 'run_error') {
        setRunning((s) => {
          const next = new Set(s)
          next.delete(event.key)
          return next
        })
        setNeedsApproval((a) => {
          if (!(event.key in a)) return a
          const next = { ...a }
          delete next[event.key]
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

  // Home's quick keys, inert while typing: N lands in the add-row, C in the
  // composer. Their visible counterparts live in the section headers, so
  // the keys are an accelerator, not the only door.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      if (isEditableTarget(e.target)) return
      if (e.key === 'n') {
        e.preventDefault()
        focusAddRow()
      } else if (e.key === 'c' && onFocusComposer) {
        e.preventDefault()
        onFocusComposer()
      } else if (e.key === 'j') {
        // The idle-worker key: cycle the needs-you queue, oldest first —
        // each press jumps to the next thread waiting on you.
        const strips = deckNeedsYouRef.current
        if (strips.length > 0) {
          e.preventDefault()
          const target = strips[deckCycleRef.current % strips.length]
          deckCycleRef.current += 1
          jumpToStripRef.current(target)
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [focusAddRow, onFocusComposer])

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

  // ---- The Deck: fed by the main-process thread registry ----
  const [deckThreads, setDeckThreads] = useState<HomeThread[]>([])
  // A strip jump flashes its source row with the spotlight treatment.
  const [flashKey, setFlashKey] = useState<string | null>(null)
  const deckCycleRef = useRef(0)
  useEffect(() => {
    let cancelled = false
    const fetchThreads = async () => {
      try {
        const res = await window.ipc.invoke('home:threads', {})
        if (!cancelled) setDeckThreads(res.threads)
      } catch {
        // Registry unavailable — the Deck simply stays empty.
      }
    }
    void fetchThreads()
    const off = window.ipc.on('home:threadsChanged', () => { void fetchThreads() })
    return () => { cancelled = true; off() }
  }, [])

  const runItem = useCallback((key: string) => {
    setRunning((s) => new Set(s).add(key))
    void window.ipc.invoke('todo:runItem', { key, model: getRunModel?.() })
  }, [getRunModel])

  const commentOnItem = useCallback((key: string, message: string) => {
    setCommentKey(null)
    setRunning((s) => new Set(s).add(key))
    // Optimistic bubble; the canonical one arrives with the next refetch.
    setConversations((c) => ({ ...c, [key]: [...(c[key] ?? []), { role: 'user', text: message, links: [] }] }))
    void window.ipc.invoke('todo:comment', { key, message, model: getRunModel?.() })
  }, [getRunModel])

  const toggleThread = useCallback((sessionId: string) => {
    // Opening IS reading — the dot clears the moment the thread expands.
    markSessionSeen(sessionId)
    setExpandedThread((cur) => {
      const next = cur === sessionId ? null : sessionId
      if (next) void fetchStreamConv(next)
      return next
    })
    setChatReplyFor(null)
  }, [fetchStreamConv, markSessionSeen])

  // Every door into a session marks it read — expand, or off to the sidebar.
  const openInChat = useCallback((sessionId: string) => {
    markSessionSeen(sessionId)
    onOpenInChat(sessionId)
  }, [markSessionSeen, onOpenInChat])

  // A Deck strip's click: spotlight the source item in place; threads with
  // no list row (chats, code sessions) open in the dock instead.
  const jumpToStrip = useCallback((thread: HomeThread) => {
    if (thread.todoKey) {
      const el = document.querySelector(`[data-todo-key="${CSS.escape(thread.todoKey)}"]`)
      if (el) {
        el.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          block: 'center',
        })
        const key = thread.todoKey
        setFlashKey(key)
        window.setTimeout(() => setFlashKey((k) => (k === key ? null : k)), 1800)
        return
      }
    }
    openInChat(thread.sessionId)
  }, [openInChat])
  const jumpToStripRef = useRef(jumpToStrip)
  useEffect(() => { jumpToStripRef.current = jumpToStrip }, [jumpToStrip])

  // ⏎ / ↗ on a strip: code threads open the Code section (diffs, terminal),
  // everything else the chat dock.
  const openStrip = useCallback((thread: HomeThread) => {
    if (thread.kind === 'code' && onOpenCodeSession) {
      markSessionSeen(thread.sessionId)
      onOpenCodeSession(thread.sessionId)
      return
    }
    openInChat(thread.sessionId)
  }, [onOpenCodeSession, openInChat, markSessionSeen])

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
    const itemText = (() => {
      for (const b of blocksRef.current ?? []) {
        if (b.kind !== 'item') continue
        if (b.item.key === key) return b.item.text
        const child = b.item.children.find((c) => c.key === key)
        if (child) return child.text
      }
      return null
    })()
    const res = await window.ipc.invoke('todo:dismiss', { key })
    await refetch()
    if (res.success && res.wasProposed && itemText) {
      // The dismissal already taught by example; this offers the durable rule.
      toast('Suggestion dismissed', {
        description: 'Rowboat won\'t re-suggest this one.',
        action: {
          label: "Don't suggest things like this",
          onClick: () => {
            void window.ipc.invoke('todo:teach', { text: itemText }).then(() => {
              toast.success('Noted — rule added to todo/preferences.md')
            })
          },
        },
      })
    }
  }, [refetch])

  const addSub = useCallback(async (parentKey: string, text: string) => {
    // The composer stays open — Enter lands this step with the cursor
    // already on the next one (bullet-list muscle memory); Escape ends it.
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

  // ---- Deck bays: projections of the registry, fixed order ----
  // Needs-you is the queue: oldest first, so J always serves the longest
  // wait. Underway orders by start; pinned idle threads keep their strip
  // (the watch flag).
  const deckNeedsYou = deckThreads
    .filter((t) => t.status === 'needs-you' || t.status === 'ready')
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
  const deckUnderway = deckThreads
    .filter((t) => t.status === 'underway' || (t.pinned && t.status === 'idle'))
    .sort((a, b) => (a.startedAt ?? a.updatedAt).localeCompare(b.startedAt ?? b.updatedAt))
  const deckNeedsYouRef = useRef(deckNeedsYou)
  deckNeedsYouRef.current = deckNeedsYou

  const isChanged = (key: string): boolean => {
    const sid = sessions[key]
    if (!sid) return false
    const updatedAt = sessionUpdatedAt[sid] ?? ''
    return updatedAt > seenBaseline && updatedAt > (sessionSeenAt[sid] ?? '')
  }

  // ---- Spotlight: connect the composer's destination to its source row ----
  const spotKey = composeTarget?.kind === 'comment' ? composeTarget.key
    : composeTarget?.kind === 'sub' ? composeTarget.parentKey
    : null
  const spotSession = composeTarget?.kind === 'chatReply' ? composeTarget.sessionId : null
  const blockContainsSpot = (i: TodoItem) => i.key === spotKey || i.children.some((c) => c.key === spotKey)
  const lastBubbleText = (bubbles: TodoChatBubble[] | undefined): string | undefined => {
    const last = bubbles?.[bubbles.length - 1]
    if (!last) return undefined
    return last.kind === 'error' ? `failed: ${last.text}` : last.text
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
        className={`rounded px-1 text-[12px] transition-colors ${
          triageFilter === filter ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <span className={`font-semibold ${tone}`}>{count}</span> {label}
      </button>
    )
  )

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
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
              {suggestions.length > 0 && (
                <IconTip label="Suggestions waiting for your accept — jump to them">
                  <button
                    type="button"
                    onClick={() => suggestionsRef.current?.scrollIntoView({
                      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
                      block: 'center',
                    })}
                    className={`${CHIP} bg-amber-500/15 font-medium text-amber-600 hover:bg-amber-500/25 dark:text-amber-400`}
                  >
                    <Sparkles className="size-3" /> {suggestions.length} suggested
                  </button>
                </IconTip>
              )}
              {planner?.slug && (
                <div ref={plannerMenuRef} className="relative flex items-center">
                  <IconTip label="Ask Rowboat for suggestions now">
                    <button
                      type="button"
                      onClick={() => void runPlannerNow()}
                      disabled={suggesting}
                      className="flex items-center gap-1.5 rounded-l-md border border-r-0 border-border px-2 py-1 text-xs font-medium text-muted-foreground enabled:hover:bg-accent enabled:hover:text-foreground disabled:opacity-60"
                    >
                      {suggesting ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                      Suggest
                    </button>
                  </IconTip>
                  <button
                    type="button"
                    onClick={() => setPlannerMenuOpen((v) => !v)}
                    aria-label="Suggestion settings"
                    className="rounded-r-md border border-border px-1 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                  {plannerMenuOpen && (
                    <div className="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-border bg-background p-3 shadow-md">
                      <div className="text-sm font-medium">Suggest automatically</div>
                      {/* Off is the default — the schedule spends tokens only
                          after an explicit opt-in. ✦ Suggest always works. */}
                      <div className="mt-2 flex flex-col gap-1.5 text-sm">
                        <label className="flex cursor-pointer items-center gap-2">
                          <input
                            type="radio"
                            name="planner-frequency"
                            checked={!planner.active}
                            onChange={() => {
                              void window.ipc.invoke('todo:setPlanner', { active: false }).then(setPlanner)
                            }}
                            className="size-3.5 accent-primary"
                          />
                          Don't run on its own
                        </label>
                        {([['morning', 'Every morning (6:30–9:30)'], ['twice', 'Morning & midday'], ['thrice', 'Morning, midday & evening']] as const).map(([value, label]) => (
                          <label key={value} className="flex cursor-pointer items-center gap-2">
                            <input
                              type="radio"
                              name="planner-frequency"
                              checked={planner.active && planner.frequency === value}
                              onChange={() => {
                                void window.ipc.invoke('todo:setPlanner', { active: true, frequency: value }).then(setPlanner)
                              }}
                              className="size-3.5 accent-primary"
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                      <div className="mt-2.5 text-[11px] text-muted-foreground">
                        Off by default. The ✦ Suggest button always works; suggestions wait for your accept either way.
                      </div>
                    </div>
                  )}
                </div>
              )}
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

          {/* The Deck — every thread needing eyes or underway, across the
              whole app (tasks, code sessions, chats). Collapses to nothing
              when quiet: a calm morning looks exactly like before. */}
          {(deckNeedsYou.length > 0 || deckUnderway.length > 0) && (
            <div className="flex flex-col gap-2.5">
              {deckNeedsYou.length > 0 && (
                <div>
                  <div className="flex items-baseline justify-between px-1 pb-1">
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-amber-600/90 dark:text-amber-400/90">
                      Needs you · {deckNeedsYou.length}
                    </div>
                    <div className="text-[10.5px] text-muted-foreground/60">J cycles the queue</div>
                  </div>
                  {deckNeedsYou.map((t) => (
                    <DeckStrip key={t.sessionId} thread={t} onJump={() => jumpToStrip(t)} onOpen={() => openStrip(t)} />
                  ))}
                </div>
              )}
              {deckUnderway.length > 0 && (
                <div>
                  <div className="px-1 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                    Underway · {deckUnderway.filter((t) => t.status === 'underway').length}
                  </div>
                  {deckUnderway.map((t) => (
                    <DeckStrip key={t.sessionId} thread={t} onJump={() => jumpToStrip(t)} onOpen={() => openStrip(t)} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* While you were away — dismissable catch-up */}
          {changedItems.length > 0 && (
            <div className="flex items-center gap-2 border-y border-border/60 px-1 py-2 text-[13px] text-muted-foreground">
              <span className="size-1.5 shrink-0 rounded-full bg-foreground" />
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

          {/* First-proposals explainer — shown once, ever */}
          {!plannerIntroSeen
            && (suggestions.length > 0 || itemBlocks.some(({ block }) => block.kind === 'item' && block.item.proposed && !block.item.checked)) && (
            <div className="flex items-center gap-2 border-y border-border/60 px-1 py-2 text-[13px] text-muted-foreground">
              <Bot className="size-3.5 shrink-0" />
              <span className="flex-1">Rowboat has suggestions from your mail and calendar — accept the useful ones to add them to your list; declining teaches it what not to suggest. Nothing is added or run without you.</span>
              <button
                type="button"
                onClick={() => { localStorage.setItem('todo.plannerIntroSeen', '1'); setPlannerIntroSeen(true) }}
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
          <div className={`transition-opacity duration-200 ${spotSession ? 'opacity-60' : ''}`}>
            <div className="flex items-center justify-between px-1 pb-1">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Tasks</div>
              <IconTip label="New to-do — press N">
                <button
                  type="button"
                  onClick={focusAddRow}
                  aria-keyshortcuts="n"
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Plus className="size-3" /> New to-do
                </button>
              </IconTip>
            </div>
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
                    dimmed={(triageFilter !== null && !blockMatches(item)) || (spotKey !== null && !blockContainsSpot(item))}
                    spotlight={item.key === spotKey || item.key === flashKey}
                    collapsed={collapsedRows[item.key] ?? (conversations[item.key]?.length ?? 0) > 0}
                    onToggleCollapsed={() => {
                      const wasCollapsed = collapsedRows[item.key] ?? (conversations[item.key]?.length ?? 0) > 0
                      // Expanding is reading — clear the row's dot.
                      if (wasCollapsed && sessions[item.key]) markSessionSeen(sessions[item.key])
                      setRowCollapsed(item.key, !wasCollapsed)
                    }}
                    isRunning={running.has(item.key)}
                    needsApproval={needsApproval[item.key] ?? null}
                    onToggle={(checked) => {
                      const next = [...blocksRef.current!]
                      // The parent carries its steps, both ways: checking it
                      // completes them, unchecking reopens them.
                      next[index] = {
                        kind: 'item',
                        item: { ...item, checked, children: item.children.map((c) => (c.checked === checked ? c : { ...c, checked })) },
                      }
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
                    onStop={() => void window.ipc.invoke('todo:stopRun', { key: item.key })}
                    onOpenNote={onOpenNote}
                    commentOpen={commentKey === item.key}
                    sessionId={sessions[item.key] ?? null}
                    bubbles={conversations[item.key] ?? []}
                    onToggleComment={() => {
                      setRowCollapsed(item.key, false)
                      if (onComposeTodo) onComposeTodo({ kind: 'comment', key: item.key, itemText: item.text, quote: lastBubbleText(conversations[item.key]) })
                      else setCommentKey(commentKey === item.key ? null : item.key)
                    }}
                    onComment={(message) => commentOnItem(item.key, message)}
                    onOpenInChat={openInChat}
                    onAddSub={() => {
                      setRowCollapsed(item.key, false)
                      setSubDraftFor(subDraftFor === item.key ? null : item.key)
                    }}
                    childRows={(item.children.length > 0 || subDraftFor === item.key) && (
                      <div className="ml-1 mt-1 flex flex-col border-l-2 border-border pl-3">
                        {item.children.map((child, ci) => (
                          <ItemRow
                            key={`${index}:${ci}:${child.key}`}
                            item={child}
                            depth={1}
                            changed={isChanged(child.key)}
                            dimmed={triageFilter !== null && !triageMatch(child)}
                            spotlight={child.key === spotKey || child.key === flashKey}
                            collapsed={collapsedRows[child.key] ?? (conversations[child.key]?.length ?? 0) > 0}
                            onToggleCollapsed={() => {
                              const wasCollapsed = collapsedRows[child.key] ?? (conversations[child.key]?.length ?? 0) > 0
                              if (wasCollapsed && sessions[child.key]) markSessionSeen(sessions[child.key])
                              setRowCollapsed(child.key, !wasCollapsed)
                            }}
                            isRunning={running.has(child.key)}
                            needsApproval={needsApproval[child.key] ?? null}
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
                            onStop={() => void window.ipc.invoke('todo:stopRun', { key: child.key })}
                            onOpenNote={onOpenNote}
                            onEnterNext={() => setSubDraftFor(item.key)}
                            commentOpen={commentKey === child.key}
                            sessionId={sessions[child.key] ?? null}
                            bubbles={conversations[child.key] ?? []}
                            onToggleComment={() => (onComposeTodo
                              ? onComposeTodo({ kind: 'comment', key: child.key, itemText: child.text, quote: lastBubbleText(conversations[child.key]) })
                              : setCommentKey(commentKey === child.key ? null : child.key))}
                            onComment={(message) => commentOnItem(child.key, message)}
                            onOpenInChat={openInChat}
                          />
                        ))}
                        {subDraftFor === item.key && (
                          <SubComposer
                            onSubmit={(text) => void addSub(item.key, text)}
                            onCancel={() => setSubDraftFor(null)}
                            onHandoff={onComposeTodo ? (text) => {
                              setSubDraftFor(null)
                              onComposeTodo({ kind: 'sub', parentKey: item.key, parentText: item.text, prefill: text })
                            } : undefined}
                          />
                        )}
                      </div>
                    )}
                  />
                )
              })
            )}
            {blocks !== null && !itemBlocks.some(({ block }) => block.kind === 'item') && (
              <div className="rounded-lg border border-dashed border-border/60 px-3 py-3 text-[13px] text-muted-foreground">
                <TextWithMentions text="Nothing on the list — add your first to-do below, or mention @rowboat to hand one off." />
              </div>
            )}
            {blocks !== null && (
              // Plain to-dos are typed in place — no chat chrome. Typing
              // @rowboat hands the text off to the composer below, where
              // model and attachments apply to the delegated run.
              <AddItemRow
                onAdd={(text) => void addItem(text)}
                onHandoff={onComposeTodo ? (text) => onComposeTodo({ kind: 'todo', prefill: text }) : undefined}
                focusSignal={addFocusSignal}
              />
            )}
          </div>

          {/* The suggestion tray — proposals awaiting your accept. Never
              part of the list until you say so. The amber tint is this
              surface's "needs your decision" color — the one tinted block
              on the page. */}
          {suggestions.length > 0 && (
            <div ref={suggestionsRef} className="flex flex-col gap-1 rounded-lg bg-amber-500/[0.06] px-2.5 py-2 ring-1 ring-amber-500/15">
              <div className="px-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-amber-600/80 dark:text-amber-400/80">Suggested</div>
              <div>
                {suggestions.map((text) => (
                  <div key={text} className="group/sugg flex items-center gap-2.5 border-b border-amber-500/10 px-2 py-2 last:border-0">
                    <Sparkles className="size-3.5 shrink-0 text-amber-500/70" />
                    <span className="min-w-0 flex-1 text-sm">
                      <TextWithMentions text={text} onOpenLink={(l) => openLink(l, onOpenNote)} />
                    </span>
                    <IconTip label="Add to your list">
                      <button
                        type="button"
                        onClick={() => void acceptSuggestion(text)}
                        aria-label="Accept suggestion"
                        className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Check className="size-3" /> Add
                      </button>
                    </IconTip>
                    <IconTip label="Decline — Rowboat learns from this">
                      <button
                        type="button"
                        onClick={() => void declineSuggestion(text)}
                        aria-label="Decline suggestion"
                        className="shrink-0 rounded-md p-1 text-muted-foreground/50 hover:bg-accent hover:text-foreground"
                      >
                        <X className="size-3.5" />
                      </button>
                    </IconTip>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* The stream — recent chat threads */}
          <ConversationsSection
            threads={streamThreads}
            total={streamTotal}
            loaded={streamLoaded}
            onNewChat={onNewChat}
            running={running}
            needsApproval={needsApproval}
            conversations={streamConvs}
            expanded={expandedThread}
            replyFor={chatReplyFor}
            spotlightSessionId={spotSession}
            dimAll={spotKey !== null}
            changedSessionIds={new Set(streamThreads
              .filter((t) => t.updatedAt > seenBaseline && t.updatedAt > (sessionSeenAt[t.sessionId] ?? ''))
              .map((t) => t.sessionId))}
            onHide={hideThread}
            onViewAll={onOpenChatHistory}
            onToggle={toggleThread}
            onReply={(sid) => (onComposeTodo
              ? onComposeTodo({ kind: 'chatReply', sessionId: sid, title: streamThreads.find((t) => t.sessionId === sid)?.title ?? 'conversation', quote: lastBubbleText(streamConvs[sid]) })
              : setChatReplyFor(chatReplyFor === sid ? null : sid))}
            onSendReply={sendChatReply}
            onOpenNote={onOpenNote}
            onOpenInChat={openInChat}
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
            onDelete={(entry) => {
              void (async () => {
                await window.ipc.invoke('todo:deleteArchived', { month: entry.month, blockIndex: entry.blockIndex, key: entry.item.key })
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
      <div className="shrink-0 border-t border-border/40 bg-background px-9 pb-5 pt-3">
        <div className="mx-auto max-w-[720px]">
          {composer ?? <Composer onSubmit={(text, kind) => void (kind === 'task' ? addItem(text) : startChat(text))} />}
        </div>
      </div>
    </div>
  )
}
