import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import {
    ListChecks, Play, Square, Loader2, Trash2, Plus, X, AlertCircle,
    Repeat, Clock, Zap, ChevronLeft, ChevronDown, ChevronRight,
    Pencil, Check, PanelRightClose, PanelRightOpen, Sparkles,
} from 'lucide-react'
import type { z } from 'zod'
import type { BackgroundTask, BackgroundTaskSummary, Triggers } from '@x/shared/dist/background-task.js'
import type { Run } from '@x/shared/dist/runs.js'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useBackgroundTaskAgentStatus } from '@/hooks/use-bg-task-agent-status'
import { formatRelativeTime } from '@/lib/relative-time'
import { toast } from '@/lib/toast'
import type { ConversationItem } from '@/lib/chat-conversation'
import { runLogToConversation } from '@/lib/run-to-conversation'
import { CompactConversation } from '@/components/compact-conversation'
import { RichMarkdownViewer } from '@/components/rich-markdown-viewer'

// ---------------------------------------------------------------------------
// Trigger helpers (inlined; extract to shared <TriggersEditor> as a follow-up)
// ---------------------------------------------------------------------------

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/

const CRON_PHRASES: Record<string, string> = {
    '* * * * *': 'Every minute',
    '*/5 * * * *': 'Every 5 minutes',
    '*/15 * * * *': 'Every 15 minutes',
    '*/30 * * * *': 'Every 30 minutes',
    '0 * * * *': 'Hourly, on the hour',
    '0 */2 * * *': 'Every 2 hours',
    '0 */6 * * *': 'Every 6 hours',
    '0 */12 * * *': 'Every 12 hours',
    '0 0 * * *': 'Daily at midnight',
    '0 8 * * *': 'Daily at 8 AM',
    '0 9 * * *': 'Daily at 9 AM',
    '0 12 * * *': 'Daily at noon',
    '0 18 * * *': 'Daily at 6 PM',
    '0 9 * * 1-5': 'Weekdays at 9 AM',
    '0 17 * * 1-5': 'Weekdays at 5 PM',
}

function describeCron(expr: string): string {
    return CRON_PHRASES[expr.trim()] ?? expr
}

function summarizeSchedule(triggers: Triggers | undefined): string {
    if (!triggers) return 'Manual only'
    const parts: string[] = []
    if (triggers.cronExpr) parts.push(describeCron(triggers.cronExpr))
    if (triggers.windows && triggers.windows.length > 0) {
        parts.push(triggers.windows.length === 1
            ? `${triggers.windows[0].startTime}–${triggers.windows[0].endTime}`
            : `${triggers.windows.length} windows`)
    }
    if (triggers.eventMatchCriteria) parts.push('events')
    return parts.length === 0 ? 'Manual only' : parts.join(' · ')
}

function formatRunAt(iso: string): string {
    const d = new Date(iso)
    const date = d.toLocaleString('en-US', { month: 'short', day: 'numeric' })
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    return `${date} · ${time}`
}

// `formatRelativeTime` returns "just now" for sub-minute, otherwise compact
// units like "5 m" / "3 h" / "2 d". Naively appending " ago" reads wrong for
// "just now"; this helper handles both shapes.
function relativeLabel(iso: string | undefined | null): string | null {
    if (!iso) return null
    const rel = formatRelativeTime(iso)
    if (!rel) return null
    if (rel === 'just now') return rel
    return `${rel} ago`
}

function TriggersEditor({
    value,
    onChange,
}: {
    value: Triggers | undefined
    onChange: (next: Triggers | undefined) => void
}) {
    const triggers: Triggers = value ?? {}
    const [editingEvents, setEditingEvents] = useState(false)
    const hasCron = typeof triggers.cronExpr === 'string'
    const hasWindows = Array.isArray(triggers.windows) && triggers.windows.length > 0
    const hasEvent = typeof triggers.eventMatchCriteria === 'string'

    const updateTriggers = (next: Partial<Triggers>) => {
        const merged: Triggers = { ...triggers, ...next }
        ;(Object.keys(merged) as (keyof Triggers)[]).forEach(key => {
            if (merged[key] === undefined) delete merged[key]
        })
        onChange(Object.keys(merged).length === 0 ? undefined : merged)
    }

    return (
        <div className="grid grid-cols-[74px_1fr] items-start gap-x-3 gap-y-4">
            <div className="flex items-center gap-1.5 pt-1.5 text-xs text-muted-foreground">
                <Repeat className="size-3.5" /> Cron
            </div>
            <div>
                {hasCron ? (
                    <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                            <Input
                                value={triggers.cronExpr ?? ''}
                                onChange={e => updateTriggers({ cronExpr: e.target.value })}
                                placeholder="0 * * * *"
                                className="h-7 max-w-[160px] font-mono text-xs"
                            />
                            <button
                                type="button"
                                onClick={() => updateTriggers({ cronExpr: undefined })}
                                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                                aria-label="Remove cron"
                            >
                                <X className="size-3" />
                            </button>
                        </div>
                        {triggers.cronExpr && (
                            <div className="text-[11px] text-muted-foreground">{describeCron(triggers.cronExpr)}</div>
                        )}
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => updateTriggers({ cronExpr: '0 * * * *' })}
                        className="inline-flex items-center gap-1 pt-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                        <Plus className="size-3" /> Cron
                    </button>
                )}
            </div>

            <div className="flex items-center gap-1.5 pt-1.5 text-xs text-muted-foreground">
                <Clock className="size-3.5" /> Windows
            </div>
            <div>
                {hasWindows && triggers.windows ? (
                    <div className="space-y-1.5">
                        {triggers.windows.map((w, idx) => (
                            <div key={idx} className="flex items-center gap-1.5">
                                <Input
                                    value={w.startTime}
                                    onChange={e => {
                                        const next = [...(triggers.windows ?? [])]
                                        next[idx] = { ...next[idx], startTime: e.target.value }
                                        updateTriggers({ windows: next })
                                    }}
                                    placeholder="09:00"
                                    className={`h-7 w-20 font-mono text-xs ${HH_MM.test(w.startTime) ? '' : 'border-destructive'}`}
                                />
                                <span className="text-xs text-muted-foreground">–</span>
                                <Input
                                    value={w.endTime}
                                    onChange={e => {
                                        const next = [...(triggers.windows ?? [])]
                                        next[idx] = { ...next[idx], endTime: e.target.value }
                                        updateTriggers({ windows: next })
                                    }}
                                    placeholder="12:00"
                                    className={`h-7 w-20 font-mono text-xs ${HH_MM.test(w.endTime) ? '' : 'border-destructive'}`}
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        const next = (triggers.windows ?? []).filter((_, i) => i !== idx)
                                        updateTriggers({ windows: next.length === 0 ? undefined : next })
                                    }}
                                    className="ml-auto inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                                    aria-label="Remove window"
                                >
                                    <X className="size-3" />
                                </button>
                            </div>
                        ))}
                        <button
                            type="button"
                            onClick={() => updateTriggers({
                                windows: [...(triggers.windows ?? []), { startTime: '13:00', endTime: '15:00' }],
                            })}
                            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                            <Plus className="size-3" /> Window
                        </button>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => updateTriggers({ windows: [{ startTime: '09:00', endTime: '12:00' }] })}
                        className="inline-flex items-center gap-1 pt-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                        <Plus className="size-3" /> Window
                    </button>
                )}
            </div>

            <div className="flex items-center gap-1.5 pt-1.5 text-xs text-muted-foreground">
                <Zap className="size-3.5" /> Events
            </div>
            <div>
                {hasEvent ? (
                    editingEvents ? (
                        <div className="space-y-1.5">
                            <Textarea
                                value={triggers.eventMatchCriteria ?? ''}
                                onChange={e => updateTriggers({ eventMatchCriteria: e.target.value })}
                                rows={5}
                                autoFocus
                                placeholder="Emails or calendar events about…"
                                className="text-xs"
                            />
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setEditingEvents(false)}
                                    className="text-[11px] font-medium text-foreground hover:underline"
                                >
                                    Done
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        updateTriggers({ eventMatchCriteria: undefined })
                                        setEditingEvents(false)
                                    }}
                                    className="text-[11px] text-muted-foreground hover:text-destructive"
                                >
                                    Remove
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="text-xs leading-relaxed text-foreground/85">
                            {triggers.eventMatchCriteria || <span className="italic text-muted-foreground">No criteria yet.</span>}
                            <button
                                type="button"
                                onClick={() => setEditingEvents(true)}
                                className="ml-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                            >
                                {triggers.eventMatchCriteria ? 'Edit rule →' : 'Add →'}
                            </button>
                        </div>
                    )
                ) : (
                    <button
                        type="button"
                        onClick={() => {
                            updateTriggers({ eventMatchCriteria: '' })
                            setEditingEvents(true)
                        }}
                        className="inline-flex items-center gap-1 pt-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                        <Plus className="size-3" /> Event rule
                    </button>
                )}
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// New Task dialog
// ---------------------------------------------------------------------------

type DialogMode = 'describe' | 'manual'

function NewTaskDialog({
    open,
    onClose,
    onCreated,
    onCreateWithCopilot,
}: {
    open: boolean
    onClose: () => void
    onCreated: (slug: string) => void
    /**
     * Optional Copilot hand-off. When provided, the dialog opens in
     * free-form "describe" mode and the user can punt to Copilot with a
     * single-sentence description. Falls back to the manual form if absent.
     */
    onCreateWithCopilot?: (description: string) => void
}) {
    const copilotEnabled = Boolean(onCreateWithCopilot)
    const [mode, setMode] = useState<DialogMode>(copilotEnabled ? 'describe' : 'manual')
    const [description, setDescription] = useState('')
    const [name, setName] = useState('')
    const [instructions, setInstructions] = useState('')
    const [triggers, setTriggers] = useState<Triggers | undefined>(undefined)
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        if (open) {
            setMode(copilotEnabled ? 'describe' : 'manual')
            setDescription('')
            setName('')
            setInstructions('')
            setTriggers(undefined)
        }
    }, [open, copilotEnabled])

    const canSubmitDescribe = description.trim().length > 0 && !submitting
    const canSubmitManual = name.trim().length > 0 && instructions.trim().length > 0 && !submitting

    const submitDescribe = () => {
        if (!canSubmitDescribe || !onCreateWithCopilot) return
        onCreateWithCopilot(description.trim())
        onClose()
    }

    const submitManual = async () => {
        if (!canSubmitManual) return
        setSubmitting(true)
        try {
            const result = await window.ipc.invoke('bg-task:create', {
                name: name.trim(),
                instructions: instructions.trim(),
                ...(triggers ? { triggers } : {}),
            })
            if (result.success && result.slug) {
                onCreated(result.slug)
            } else {
                toast(result.error ?? 'Failed to create task', 'error')
            }
        } catch (err) {
            toast(err instanceof Error ? err.message : String(err), 'error')
        } finally {
            setSubmitting(false)
        }
    }

    if (!open) return null

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={onClose}
        >
            <div
                className="w-full max-w-xl rounded-md border bg-background p-5 shadow-xl"
                onClick={e => e.stopPropagation()}
            >
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-base font-semibold">New background task</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                        <X className="size-4" />
                    </button>
                </div>

                {mode === 'describe' ? (
                    <>
                        <Textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            onKeyDown={e => {
                                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                    e.preventDefault()
                                    submitDescribe()
                                }
                            }}
                            placeholder="Describe what this task should do — when it should fire, what it should produce or which action it should take. Copilot will fill in the rest.

Example: every morning at 7, summarize my unread Gmail into a one-paragraph brief plus a bulleted list of action items."
                            rows={8}
                            autoFocus
                            className="resize-y text-[13px] leading-relaxed"
                        />
                        <p className="mt-2 text-[11px] text-muted-foreground">
                            Tip: be specific about the cadence and the format you want. <kbd className="rounded border bg-muted px-1 py-0.5 text-[10px] font-mono">⌘↵</kbd> to submit.
                        </p>

                        <div className="mt-5 flex items-center justify-between gap-2">
                            <button
                                type="button"
                                onClick={() => setMode('manual')}
                                className="text-[11px] text-muted-foreground hover:text-foreground"
                            >
                                Configure manually →
                            </button>
                            <div className="flex items-center gap-2">
                                <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>Cancel</Button>
                                <Button size="sm" onClick={submitDescribe} disabled={!canSubmitDescribe}>
                                    <Sparkles className="size-3" /> Set up with Copilot
                                </Button>
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="space-y-4">
                            <div>
                                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Name</label>
                                <Input
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    placeholder="Morning weather brief"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Instructions</label>
                                <Textarea
                                    value={instructions}
                                    onChange={e => setInstructions(e.target.value)}
                                    placeholder="Show SF weather as one line: `<temp>°F, <conditions>`"
                                    rows={4}
                                    className="font-mono text-[12.5px]"
                                />
                                <p className="mt-1 text-[11px] text-muted-foreground">
                                    The agent reads the verbs each run to decide whether to update <code className="font-mono">index.md</code> (OUTPUT) or perform an action and journal it (ACTION).
                                </p>
                            </div>
                            <div>
                                <label className="mb-2 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Triggers</label>
                                <TriggersEditor value={triggers} onChange={setTriggers} />
                                <p className="mt-2 text-[11px] text-muted-foreground">
                                    No triggers = manual-only.
                                </p>
                            </div>
                        </div>

                        <div className="mt-5 flex items-center justify-between gap-2">
                            {copilotEnabled ? (
                                <button
                                    type="button"
                                    onClick={() => setMode('describe')}
                                    className="text-[11px] text-muted-foreground hover:text-foreground"
                                >
                                    ← Describe instead
                                </button>
                            ) : <span />}
                            <div className="flex items-center gap-2">
                                <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>Cancel</Button>
                                <Button size="sm" onClick={submitManual} disabled={!canSubmitManual}>
                                    {submitting && <Loader2 className="mr-1 size-3 animate-spin" />}
                                    Create
                                </Button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Shared UI bits
// ---------------------------------------------------------------------------

function TabButton({
    active,
    onClick,
    disabled,
    children,
}: {
    active: boolean
    onClick: () => void
    disabled?: boolean
    children: React.ReactNode
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`relative px-3 py-2.5 text-xs font-medium transition-colors ${
                active
                    ? 'text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-foreground'
                    : disabled
                        ? 'text-muted-foreground/50 cursor-not-allowed'
                        : 'text-muted-foreground hover:text-foreground'
            }`}
        >
            {children}
        </button>
    )
}

function SectionRegion({ label, children }: { label?: string; children: React.ReactNode }) {
    return (
        <div className="border-b border-sidebar-border px-4 py-4 last:border-b-0">
            {label && (
                <div className="mb-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {label}
                </div>
            )}
            {children}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Output pane — index.md (main pane content)
//
// Renders the task's `index.md` like a note: max-width 720px centered, same
// typography (~16px, 1.5 line-height, generous padding) as the note editor's
// ProseMirror rule in `editor.css`. No chrome above the body — just the
// markdown, with a small floating Source ⇄ Rendered toggle in the top-right.
// ---------------------------------------------------------------------------

function OutputPane({ slug, taskName, refreshKey }: { slug: string; taskName: string; refreshKey: number }) {
    const [body, setBody] = useState<string>('')
    const [loading, setLoading] = useState(true)
    const [viewSource, setViewSource] = useState(false)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        void (async () => {
            try {
                const result = await window.ipc.invoke('workspace:readFile', {
                    path: `bg-tasks/${slug}/index.md`,
                })
                if (!cancelled) setBody(result.data)
            } catch {
                if (!cancelled) setBody('')
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => { cancelled = true }
    }, [slug, refreshKey])

    const isEmpty = !body.trim() || body.trim() === `# ${taskName}`

    return (
        <div className="relative flex-1 overflow-hidden bg-background">
            {!isEmpty && !loading && (
                <button
                    type="button"
                    onClick={() => setViewSource(v => !v)}
                    className="absolute right-4 top-3 z-10 rounded-md bg-background/70 px-2 py-0.5 text-[11px] text-muted-foreground backdrop-blur hover:bg-accent hover:text-foreground"
                    aria-label={viewSource ? 'Show rendered output' : 'Show source markdown'}
                >
                    {viewSource ? 'Rendered' : 'Source'}
                </button>
            )}

            <div className="h-full overflow-y-auto">
                <div className="mx-auto max-w-[720px] px-16 py-8">
                    {loading ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="size-3 animate-spin" /> Loading…
                        </div>
                    ) : isEmpty ? (
                        <p className="text-sm italic text-muted-foreground">
                            No output yet. Click <span className="font-medium text-foreground">Run now</span> in the sidebar, or wait for a trigger to fire.
                        </p>
                    ) : viewSource ? (
                        <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[13px] leading-relaxed">{body}</pre>
                    ) : (
                        <RichMarkdownViewer content={body} />
                    )}
                </div>
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Setup tab — Instructions + Triggers + Advanced
// ---------------------------------------------------------------------------

function InstructionsBlock({
    draft,
    setDraft,
    editing,
    setEditing,
    onCancel,
    onSave,
    saving,
    dirty,
}: {
    draft: BackgroundTask
    setDraft: (next: BackgroundTask) => void
    editing: boolean
    setEditing: (v: boolean) => void
    onCancel: () => void
    onSave: () => void
    saving: boolean
    dirty: boolean
}) {
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    useEffect(() => {
        if (!editing) return
        const el = textareaRef.current
        if (!el) return
        el.focus()
        const len = el.value.length
        el.setSelectionRange(len, len)
    }, [editing])

    if (editing) {
        return (
            <div className="space-y-2">
                <Textarea
                    ref={textareaRef}
                    value={draft.instructions}
                    onChange={e => setDraft({ ...draft, instructions: e.target.value })}
                    onKeyDown={e => {
                        if (e.key === 'Escape') {
                            e.preventDefault()
                            onCancel()
                        }
                    }}
                    spellCheck
                    placeholder="What should this task keep doing?"
                    rows={8}
                    className="resize-y font-mono text-[12.5px] leading-relaxed"
                />
                <div className="flex items-center gap-2">
                    <Button size="sm" onClick={onSave} disabled={saving || !dirty}>
                        {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} Save
                    </Button>
                    <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
                        Cancel
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <div>
            <div className="mb-2 flex items-center justify-between">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Instructions</div>
                <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                    <Pencil className="size-3" /> Edit
                </button>
            </div>
            {draft.instructions.trim() ? (
                <Streamdown className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                    {draft.instructions}
                </Streamdown>
            ) : (
                <p className="text-sm italic text-muted-foreground">No instructions yet. Click Edit to write some.</p>
            )}
        </div>
    )
}

function SetupTab({
    draft,
    setDraft,
    editingInstructions,
    setEditingInstructions,
    onCancelInstructions,
    onSave,
    saving,
    dirty,
    showAdvanced,
    setShowAdvanced,
    confirmingDelete,
    setConfirmingDelete,
    onDelete,
}: {
    draft: BackgroundTask
    setDraft: (next: BackgroundTask) => void
    editingInstructions: boolean
    setEditingInstructions: (v: boolean) => void
    onCancelInstructions: () => void
    onSave: () => void
    saving: boolean
    dirty: boolean
    showAdvanced: boolean
    setShowAdvanced: (v: boolean) => void
    confirmingDelete: boolean
    setConfirmingDelete: (v: boolean) => void
    onDelete: () => void
}) {
    return (
        <div className="flex-1 overflow-auto">
            <SectionRegion>
                <InstructionsBlock
                    draft={draft}
                    setDraft={setDraft}
                    editing={editingInstructions}
                    setEditing={setEditingInstructions}
                    onCancel={onCancelInstructions}
                    onSave={onSave}
                    saving={saving}
                    dirty={dirty}
                />
            </SectionRegion>

            <SectionRegion label="Triggers">
                <TriggersEditor
                    value={draft.triggers}
                    onChange={(next) => setDraft({ ...draft, triggers: next })}
                />
            </SectionRegion>

            <div className="border-b border-sidebar-border px-4 py-3">
                <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex w-full items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    aria-expanded={showAdvanced}
                >
                    {showAdvanced ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                    Advanced
                </button>
                {showAdvanced && (
                    <div className="mt-3">
                        <div className="grid grid-cols-[74px_1fr] gap-x-3 gap-y-2.5 text-xs">
                            <span className="pt-1.5 text-muted-foreground">Model</span>
                            <Input
                                value={draft.model ?? ''}
                                onChange={e => setDraft({ ...draft, model: e.target.value || undefined })}
                                placeholder="(global default)"
                                className="h-7 font-mono text-xs"
                            />
                            <span className="pt-1.5 text-muted-foreground">Provider</span>
                            <Input
                                value={draft.provider ?? ''}
                                onChange={e => setDraft({ ...draft, provider: e.target.value || undefined })}
                                placeholder="(global default)"
                                className="h-7 font-mono text-xs"
                            />
                        </div>
                        <div className="mt-4">
                            {confirmingDelete ? (
                                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
                                    <span className="text-destructive">Delete this task and all its runs?</span>
                                    <div className="flex gap-2">
                                        <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(false)} disabled={saving}>
                                            Cancel
                                        </Button>
                                        <Button variant="destructive" size="sm" onClick={onDelete} disabled={saving}>
                                            {saving ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />} Delete
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setConfirmingDelete(true)}
                                    className="text-xs font-medium text-destructive hover:underline"
                                >
                                    Delete task →
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Runs history tab — list + drill-down transcript view
//
// Source of truth: `bg-tasks/<slug>/runs.log` — a plain-text file with one
// runId per line (newest first). The actual transcripts live at the global
// `$WorkDir/runs/<runId>.jsonl`, so this tab fetches runIds via the bg-task
// IPC, then loads each Run through the standard `runs:fetch`. No bg-task-
// specific transcript path or schema needed.
// ---------------------------------------------------------------------------

interface RunRowSummary {
    runId: string
    createdAt?: string
    trigger?: string
    summary?: string
    error?: string
}

// Pull the bits we want to display for a row out of a full Run's event log.
function summarizeRun(run: z.infer<typeof Run>): RunRowSummary {
    const out: RunRowSummary = { runId: run.id, createdAt: run.createdAt, trigger: run.subUseCase }
    for (const event of run.log) {
        if (event.type === 'error' && typeof event.error === 'string') {
            out.error = event.error
        } else if (event.type === 'message' && event.message?.role === 'assistant') {
            const content = event.message.content
            if (typeof content === 'string') {
                out.summary = content
            } else if (Array.isArray(content)) {
                const text = content
                    .filter((p) => p.type === 'text')
                    .map((p) => ('text' in p ? p.text : ''))
                    .join('')
                if (text) out.summary = text
            }
        }
    }
    return out
}

function RunsHistoryTab({ slug, task }: { slug: string; task: BackgroundTask }) {
    const [rows, setRows] = useState<RunRowSummary[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
    const agentStatus = useBackgroundTaskAgentStatus()

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const { runIds } = await window.ipc.invoke('bg-task:listRunIds', { slug, limit: 100 })
            // Fetch each Run in parallel via the canonical IPC. Runs whose
            // jsonl no longer exists (deleted manually, never written, …) are
            // dropped silently.
            const settled = await Promise.allSettled(
                runIds.map(runId => window.ipc.invoke('runs:fetch', { runId }))
            )
            const next: RunRowSummary[] = []
            for (let i = 0; i < settled.length; i++) {
                const r = settled[i]
                if (r.status === 'fulfilled' && r.value) {
                    next.push(summarizeRun(r.value))
                } else {
                    // Keep the row visible with just the id so the user knows it exists.
                    next.push({ runId: runIds[i] })
                }
            }
            setRows(next)
        } finally {
            setLoading(false)
        }
    }, [slug])

    useEffect(() => {
        void load()
    }, [load])

    // Re-load whenever a new attempt starts or finishes (flat-field changes).
    useEffect(() => {
        void load()
    }, [task.lastRunId, task.lastAttemptAt, task.lastRunAt, load])

    // Bus events are the ONLY source of truth for in-flight status. If the
    // renderer received a `start` event for this task and hasn't yet received
    // its `complete`, the run with that runId is running. Disk-derived signals
    // (lastAttemptAt vs lastRunAt) are deliberately ignored — even if it means
    // the UI is briefly out of sync after a late start or a missed event.
    const liveStatus = agentStatus.get(slug)
    const currentInFlightRunId = liveStatus?.status === 'running' ? liveStatus.runId ?? null : null

    if (selectedRunId) {
        return (
            <RunTranscriptView
                runId={selectedRunId}
                isInFlight={selectedRunId === currentInFlightRunId}
                onBack={() => setSelectedRunId(null)}
            />
        )
    }

    return (
        <div className="flex-1 overflow-auto">
            {loading ? (
                <div className="flex items-center gap-2 px-4 py-4 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" /> Loading…
                </div>
            ) : rows.length === 0 ? (
                <div className="px-6 py-12 text-center">
                    <p className="text-xs text-muted-foreground">
                        No runs yet. Click <span className="font-medium text-foreground">Run now</span> below.
                    </p>
                </div>
            ) : (
                <div className="divide-y divide-sidebar-border">
                    {rows.map(row => {
                        const inFlight = row.runId === currentInFlightRunId
                        const isError = !!row.error
                        return (
                            <button
                                key={row.runId}
                                type="button"
                                onClick={() => setSelectedRunId(row.runId)}
                                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/30"
                            >
                                <div className={`size-1.5 shrink-0 rounded-full ${
                                    inFlight ? 'bg-amber-500 animate-pulse'
                                        : isError ? 'bg-destructive'
                                            : 'bg-emerald-500'
                                }`} />
                                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                    <div className="flex items-center gap-2 text-xs">
                                        <span className="font-mono text-[10.5px] text-muted-foreground">
                                            {row.createdAt ? formatRunAt(row.createdAt) : row.runId}
                                        </span>
                                        {row.trigger && (
                                            <>
                                                <span className="text-[10.5px] text-muted-foreground">·</span>
                                                <span className="text-[10.5px] text-muted-foreground">{row.trigger}</span>
                                            </>
                                        )}
                                        {inFlight && (
                                            <span className="text-[10.5px] text-amber-600">· running</span>
                                        )}
                                    </div>
                                    {(row.error || row.summary) && (
                                        <div className={`truncate text-[11px] ${row.error ? 'text-destructive' : 'text-foreground/70'}`}>
                                            {row.error ?? row.summary}
                                        </div>
                                    )}
                                </div>
                                <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

function RunTranscriptView({
    runId,
    isInFlight,
    onBack,
}: {
    runId: string
    isInFlight: boolean
    onBack: () => void
}) {
    const [run, setRun] = useState<z.infer<typeof Run> | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        setError(null)
        void (async () => {
            try {
                // Bg-task transcripts now live at the global runs/ location —
                // same path resolution as every other run, no special handling.
                const r = await window.ipc.invoke('runs:fetch', { runId })
                if (cancelled) return
                setRun(r)
            } catch (err) {
                if (cancelled) return
                setError(err instanceof Error ? err.message : String(err))
                setRun(null)
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => { cancelled = true }
    }, [runId])

    const summary = run ? summarizeRun(run) : undefined
    const items: ConversationItem[] = run ? runLogToConversation(run.log) : []

    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center gap-2 border-b border-sidebar-border px-3 py-2">
                <button
                    type="button"
                    onClick={onBack}
                    className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label="Back to runs"
                >
                    <ChevronLeft className="size-3.5" />
                </button>
                <div className="min-w-0 flex-1">
                    <div className="font-mono text-[10.5px] text-muted-foreground">
                        {summary?.createdAt ? formatRunAt(summary.createdAt) : runId}
                        {summary?.trigger && ` · ${summary.trigger}`}
                        {isInFlight && <span className="ml-1 text-amber-600">· running</span>}
                    </div>
                </div>
            </div>

            <div className="flex-1 space-y-4 overflow-auto px-4 py-4">
                {/* Summary header — error or summary, mirrors live-note LastRunTab. */}
                <div>
                    {summary?.error && (
                        <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2">
                            <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                            <code className="break-all font-mono text-[11px] leading-relaxed text-destructive">
                                {summary.error}
                            </code>
                        </div>
                    )}
                    {summary?.summary && (
                        <Streamdown className="prose prose-sm dark:prose-invert max-w-none text-foreground/85 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2">
                            {summary.summary}
                        </Streamdown>
                    )}
                    {!summary?.error && !summary?.summary && !loading && (
                        <p className="text-xs italic text-muted-foreground">No summary recorded.</p>
                    )}
                </div>

                <div className="border-t border-sidebar-border" />

                {/* Transcript */}
                <div>
                    <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Transcript
                    </div>
                    {loading && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="size-3 animate-spin" /> Loading…
                        </div>
                    )}
                    {error && !loading && (
                        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                            Couldn&apos;t load transcript: {error}
                        </div>
                    )}
                    {run && !loading && items.length === 0 && (
                        <p className="text-xs italic text-muted-foreground">No messages or tool calls recorded.</p>
                    )}
                    {run && !loading && items.length > 0 && (
                        <CompactConversation items={items} />
                    )}
                </div>
            </div>
        </div>
    )
}


// ---------------------------------------------------------------------------
// Right sidebar — header + status strip + tabs + footer (mirror of live-note)
// ---------------------------------------------------------------------------

type Tab = 'setup' | 'runs'

function ControlSidebar({
    slug,
    task,
    draft,
    setDraft,
    isRunning,
    paused,
    saving,
    dirty,
    editingInstructions,
    setEditingInstructions,
    onCancelInstructions,
    onSave,
    showAdvanced,
    setShowAdvanced,
    confirmingDelete,
    setConfirmingDelete,
    onToggleActive,
    onRunNow,
    onStop,
    onDelete,
    onCollapse,
    onEditWithCopilot,
}: {
    slug: string
    task: BackgroundTask
    draft: BackgroundTask
    setDraft: (next: BackgroundTask) => void
    isRunning: boolean
    paused: boolean
    saving: boolean
    dirty: boolean
    editingInstructions: boolean
    setEditingInstructions: (v: boolean) => void
    onCancelInstructions: () => void
    onSave: () => void
    showAdvanced: boolean
    setShowAdvanced: (v: boolean) => void
    confirmingDelete: boolean
    setConfirmingDelete: (v: boolean) => void
    onToggleActive: (v: boolean) => void
    onRunNow: () => void
    onStop: () => void
    onDelete: () => void
    onCollapse: () => void
    onEditWithCopilot?: () => void
}) {
    const [tab, setTab] = useState<Tab>('setup')

    const lastRunLabel = task.lastRunAt
        ? relativeLabel(task.lastRunAt) ?? 'recently'
        : task.lastAttemptAt
            ? `started ${relativeLabel(task.lastAttemptAt) ?? 'just now'}`
            : 'Never'

    return (
        <aside className="flex w-[400px] max-w-[40vw] shrink-0 flex-col overflow-hidden border-l border-sidebar-border bg-sidebar text-sidebar-foreground">
            {/* Header */}
            <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-4">
                <ListChecks
                    className={`size-4 shrink-0 ${paused ? 'text-muted-foreground' : 'text-emerald-600 dark:text-emerald-400'}`}
                />
                <span className="truncate text-sm font-semibold">{task.name}</span>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    paused
                        ? 'bg-muted text-muted-foreground'
                        : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                }`}>
                    <span className={`size-1.5 rounded-full ${paused ? 'bg-muted-foreground/60' : 'bg-emerald-500'} ${isRunning ? 'animate-pulse' : ''}`} aria-hidden />
                    {paused ? 'Paused' : 'Active'}
                </span>
                <span className="ml-auto" />
                <Switch
                    checked={!paused}
                    onCheckedChange={onToggleActive}
                    disabled={saving}
                    aria-label="Active"
                />
                <button
                    type="button"
                    onClick={onCollapse}
                    className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label="Hide sidebar"
                    title="Hide sidebar"
                >
                    <PanelRightClose className="size-4" />
                </button>
            </div>

            {/* Status strip */}
            <div className="shrink-0 border-b border-sidebar-border px-4 py-3">
                <div className="grid grid-cols-2 gap-4">
                    <div className="min-w-0">
                        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Last run</div>
                        <div className="mt-0.5 truncate text-xs text-foreground">
                            {task.lastRunAt || task.lastAttemptAt ? (
                                <>
                                    {lastRunLabel}
                                    {task.lastRunError && <span className="text-destructive"> · error</span>}
                                </>
                            ) : (
                                <span className="text-muted-foreground">Never</span>
                            )}
                        </div>
                    </div>
                    <div className="min-w-0">
                        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Schedule</div>
                        <div className="mt-0.5 truncate text-xs text-foreground">{summarizeSchedule(task.triggers)}</div>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex shrink-0 border-b border-sidebar-border px-4">
                <TabButton active={tab === 'setup'} onClick={() => setTab('setup')}>Setup</TabButton>
                <TabButton active={tab === 'runs'} onClick={() => setTab('runs')}>Runs history</TabButton>
            </div>

            {tab === 'setup' && (
                <SetupTab
                    draft={draft}
                    setDraft={setDraft}
                    editingInstructions={editingInstructions}
                    setEditingInstructions={setEditingInstructions}
                    onCancelInstructions={onCancelInstructions}
                    onSave={onSave}
                    saving={saving}
                    dirty={dirty}
                    showAdvanced={showAdvanced}
                    setShowAdvanced={setShowAdvanced}
                    confirmingDelete={confirmingDelete}
                    setConfirmingDelete={setConfirmingDelete}
                    onDelete={onDelete}
                />
            )}
            {tab === 'runs' && (
                <RunsHistoryTab slug={slug} task={task} />
            )}

            {/* Footer — Edit with Copilot · Save (when dirty) · Run / Stop. */}
            <div className="flex shrink-0 items-center gap-2 border-t border-sidebar-border bg-sidebar-accent/20 px-4 py-2.5">
                {isRunning ? (
                    <>
                        <span className="inline-flex items-center gap-1.5 text-xs text-sidebar-foreground">
                            <Loader2 className="size-3 animate-spin" /> Running
                        </span>
                        <span className="ml-auto" />
                        <Button variant="destructive" size="sm" onClick={onStop} disabled={saving}>
                            <Square className="size-3" /> Stop
                        </Button>
                    </>
                ) : (
                    <>
                        {onEditWithCopilot && (
                            <Button variant="ghost" size="sm" onClick={onEditWithCopilot} disabled={saving}>
                                <Sparkles className="size-3" /> Edit with Copilot
                            </Button>
                        )}
                        {dirty && !editingInstructions && tab === 'setup' && (
                            <Button variant="outline" size="sm" onClick={onSave} disabled={saving}>
                                {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} Save
                            </Button>
                        )}
                        <span className="ml-auto" />
                        <Button size="sm" onClick={onRunNow} disabled={saving}>
                            <Play className="size-3" /> Run now
                        </Button>
                    </>
                )}
            </div>
        </aside>
    )
}

// ---------------------------------------------------------------------------
// Detail view — 2-pane layout
// ---------------------------------------------------------------------------

function TaskDetail({
    slug,
    onBack,
    onDeleted,
    onEditWithCopilot,
}: {
    slug: string
    onBack: () => void
    onDeleted: () => void
    onEditWithCopilot?: (slug: string) => void
}) {
    const [task, setTask] = useState<BackgroundTask | null>(null)
    const [draft, setDraft] = useState<BackgroundTask | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [editingInstructions, setEditingInstructions] = useState(false)
    const [showAdvanced, setShowAdvanced] = useState(false)
    const [confirmingDelete, setConfirmingDelete] = useState(false)
    const [sidebarOpen, setSidebarOpen] = useState(true)
    const [outputRefreshKey, setOutputRefreshKey] = useState(0)

    const agentStatus = useBackgroundTaskAgentStatus()
    const liveStatus = agentStatus.get(slug)
    // Bus events are the only source of truth for "is this task currently
    // running" — see RunsHistoryTab for the rationale.
    const isRunning = liveStatus?.status === 'running'
    const paused = task ? !task.active : false

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const result = await window.ipc.invoke('bg-task:get', { slug })
            if (result.success && result.task) {
                setTask(result.task)
                setDraft(result.task)
            }
        } finally {
            setLoading(false)
        }
    }, [slug])

    useEffect(() => {
        void load()
    }, [load])

    // Refetch when the agent completes a run — fresh flat fields, fresh index.md.
    useEffect(() => {
        if (liveStatus?.status === 'done' || liveStatus?.status === 'error') {
            void load()
            setOutputRefreshKey(k => k + 1)
        }
    }, [liveStatus?.status, load])

    const isDirty = useMemo(() => {
        if (!task || !draft) return false
        return JSON.stringify(task) !== JSON.stringify(draft)
    }, [task, draft])

    const save = async () => {
        if (!draft || !task) return
        setSaving(true)
        try {
            const partial: Partial<BackgroundTask> = {}
            if (draft.instructions !== task.instructions) partial.instructions = draft.instructions
            if (JSON.stringify(draft.triggers) !== JSON.stringify(task.triggers)) partial.triggers = draft.triggers
            if (draft.model !== task.model) partial.model = draft.model
            if (draft.provider !== task.provider) partial.provider = draft.provider
            const result = await window.ipc.invoke('bg-task:patch', { slug, partial })
            if (result.success && result.task) {
                setTask(result.task)
                setDraft(result.task)
                setEditingInstructions(false)
            } else {
                toast(result.error ?? 'Failed to save', 'error')
            }
        } finally {
            setSaving(false)
        }
    }

    const cancelInstructions = () => {
        if (!task) return
        setDraft(d => d ? { ...d, instructions: task.instructions } : d)
        setEditingInstructions(false)
    }

    const toggleActive = async (active: boolean) => {
        if (!task) return
        const result = await window.ipc.invoke('bg-task:patch', { slug, partial: { active } })
        if (result.success && result.task) {
            setTask(result.task)
            setDraft(result.task)
        }
    }

    const runNow = async () => {
        const result = await window.ipc.invoke('bg-task:run', { slug })
        if (!result.success) {
            toast(result.error ?? 'Run failed', 'error')
        }
    }

    const stopRun = async () => {
        await window.ipc.invoke('bg-task:stop', { slug })
    }

    const deleteTask = async () => {
        const result = await window.ipc.invoke('bg-task:delete', { slug })
        if (result.success) {
            onDeleted()
        } else {
            toast(result.error ?? 'Delete failed', 'error')
        }
    }

    if (loading || !task || !draft) {
        return (
            <div className="flex h-full items-center justify-center">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="flex h-full flex-col overflow-hidden">
            {/* Top bar — back to list, sidebar toggle when collapsed */}
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
                <button
                    type="button"
                    onClick={onBack}
                    className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label="Back to background tasks"
                >
                    <ChevronLeft className="size-4" />
                </button>
                <span className="truncate text-sm font-medium text-muted-foreground">Background tasks</span>
                <span className="ml-auto" />
                {!sidebarOpen && (
                    <button
                        type="button"
                        onClick={() => setSidebarOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs text-foreground hover:bg-accent hover:text-foreground"
                        aria-label="Show sidebar"
                    >
                        <PanelRightOpen className="size-3.5" />
                        <span>Show details</span>
                    </button>
                )}
            </div>

            {/* Body: main (output) + right sidebar */}
            <div className="flex flex-1 min-h-0">
                <OutputPane slug={slug} taskName={task.name} refreshKey={outputRefreshKey} />
                {sidebarOpen && (
                    <ControlSidebar
                        slug={slug}
                        task={task}
                        draft={draft}
                        setDraft={setDraft}
                        isRunning={isRunning}
                        paused={paused}
                        saving={saving}
                        dirty={isDirty}
                        editingInstructions={editingInstructions}
                        setEditingInstructions={setEditingInstructions}
                        onCancelInstructions={cancelInstructions}
                        onSave={save}
                        showAdvanced={showAdvanced}
                        setShowAdvanced={setShowAdvanced}
                        confirmingDelete={confirmingDelete}
                        setConfirmingDelete={setConfirmingDelete}
                        onToggleActive={toggleActive}
                        onRunNow={runNow}
                        onStop={stopRun}
                        onDelete={deleteTask}
                        onCollapse={() => setSidebarOpen(false)}
                        onEditWithCopilot={onEditWithCopilot ? () => onEditWithCopilot(slug) : undefined}
                    />
                )}
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

export interface BgTasksViewProps {
    /**
     * Optional Copilot hand-off. When provided, the "New task" dialog opens
     * in free-form "describe" mode and the user can punt to Copilot with a
     * single-sentence description. Hosted in App.tsx so it routes through
     * the same chat-submit pipeline as the rest of the app.
     */
    onCreateWithCopilot?: (description: string) => void
    /**
     * Optional Copilot hand-off for editing an existing task. Wired to the
     * "Edit with Copilot" button in the detail-view sidebar footer.
     */
    onEditWithCopilot?: (slug: string) => void
    /**
     * If provided, the view opens with this task already selected. Updates to
     * this prop sync into internal state so the sidebar can swap which task is
     * focused without remounting the view.
     */
    initialSlug?: string | null
    /**
     * Bump this counter to force a re-focus on `initialSlug` even when the
     * slug value itself didn't change (e.g. user clicks the same task in the
     * sidebar twice after navigating away inside the view).
     */
    slugVersion?: number
}

function formatLastRanLabel(iso: string | null | undefined): string {
    if (!iso) return 'Never'
    return formatRelativeTime(iso) || 'Never'
}

export function BgTasksView({ onCreateWithCopilot, onEditWithCopilot, initialSlug, slugVersion }: BgTasksViewProps = {}) {
    const [items, setItems] = useState<BackgroundTaskSummary[]>([])
    const [selectedSlug, setSelectedSlug] = useState<string | null>(initialSlug ?? null)
    useEffect(() => {
      setSelectedSlug(initialSlug ?? null)
    }, [initialSlug, slugVersion])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [showNewDialog, setShowNewDialog] = useState(false)
    // Per-row spinners while the corresponding IPC is in flight — same pattern
    // as `LiveNotesView` uses for its toggle / stop buttons.
    const [updatingSlugs, setUpdatingSlugs] = useState<Set<string>>(new Set())
    const [stoppingSlugs, setStoppingSlugs] = useState<Set<string>>(new Set())
    const agentStatus = useBackgroundTaskAgentStatus()

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const result = await window.ipc.invoke('bg-task:list', { limit: 200 })
            setItems(result.items)
            setError(null)
        } catch (err) {
            console.error('Failed to load background tasks:', err)
            setError('Could not load background tasks.')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void load()
    }, [load])

    useEffect(() => {
        if (agentStatus.size > 0) {
            void load()
        }
    }, [agentStatus, load])

    const handleToggleActive = useCallback(async (slug: string, active: boolean) => {
        setUpdatingSlugs(prev => new Set(prev).add(slug))
        try {
            const result = await window.ipc.invoke('bg-task:patch', { slug, partial: { active } })
            if (!result.success) {
                toast(result.error ?? 'Failed to update task', 'error')
                return
            }
            // Optimistically reflect the new state without re-fetching the whole list.
            setItems(prev => prev.map(t => t.slug === slug ? { ...t, active } : t))
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Failed to update task', 'error')
        } finally {
            setUpdatingSlugs(prev => {
                const next = new Set(prev)
                next.delete(slug)
                return next
            })
        }
    }, [])

    const handleStop = useCallback(async (slug: string) => {
        setStoppingSlugs(prev => new Set(prev).add(slug))
        try {
            const result = await window.ipc.invoke('bg-task:stop', { slug })
            if (!result.success && result.error) {
                toast(result.error, 'error')
            }
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Failed to stop run', 'error')
        } finally {
            setStoppingSlugs(prev => {
                const next = new Set(prev)
                next.delete(slug)
                return next
            })
        }
    }, [])

    if (selectedSlug) {
        return (
            <TaskDetail
                slug={selectedSlug}
                onBack={() => {
                    setSelectedSlug(null)
                    void load()
                }}
                onDeleted={() => {
                    setSelectedSlug(null)
                    void load()
                }}
                onEditWithCopilot={onEditWithCopilot}
            />
        )
    }

    return (
        <div className="flex h-full flex-col overflow-hidden">
            <div className="shrink-0 border-b border-border px-6 py-5">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                        <ListChecks className="size-5 text-primary" />
                        <h2 className="text-base font-semibold text-foreground">Background tasks</h2>
                    </div>
                    <Button size="sm" onClick={() => setShowNewDialog(true)}>
                        New task
                    </Button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                    Persistent agents that fire on a schedule or in response to events. Toggle a task inactive to pause it.
                </p>
            </div>
            <div className="flex-1 overflow-auto p-6">
                {loading ? (
                    <div className="flex h-full items-center justify-center">
                        <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                ) : error ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
                        <div className="rounded-full bg-muted p-3">
                            <ListChecks className="size-6 text-muted-foreground" />
                        </div>
                        <p className="text-sm text-muted-foreground">{error}</p>
                    </div>
                ) : items.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
                        <div className="rounded-full bg-muted p-3">
                            <ListChecks className="size-6 text-muted-foreground" />
                        </div>
                        <p className="text-sm text-muted-foreground">
                            No background tasks yet.
                        </p>
                        <Button size="sm" onClick={() => setShowNewDialog(true)}>
                            <Plus className="size-3" /> Create your first task
                        </Button>
                    </div>
                ) : (
                    <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
                        <table className="w-full table-fixed border-collapse">
                            <colgroup>
                                <col className="w-[45%]" />
                                <col className="w-[17%]" />
                                <col className="w-[13%]" />
                                <col className="w-[25%]" />
                            </colgroup>
                            <thead>
                                <tr className="border-b border-border/60 bg-muted/30 text-left">
                                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Task</th>
                                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Schedule</th>
                                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Last ran</th>
                                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">State</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map(task => {
                                    const live = agentStatus.get(task.slug)
                                    const isRunning = live?.status === 'running'
                                    const isUpdating = updatingSlugs.has(task.slug)
                                    const isStopping = stoppingSlugs.has(task.slug)
                                    const hasError = !isRunning && !!task.lastRunError
                                    const instructionsPreview = task.instructions.split('\n')[0].trim()
                                    return (
                                        <tr
                                            key={task.slug}
                                            className={`border-b border-border/50 last:border-b-0 transition-colors ${isRunning ? 'bg-primary/5' : 'hover:bg-muted/20'}`}
                                        >
                                            <td className="px-4 py-3 align-top">
                                                <div className="flex min-w-0 flex-col gap-1">
                                                    <div className="flex items-center gap-1.5">
                                                        {hasError && (
                                                            <AlertCircle
                                                                className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
                                                                aria-label="Last run failed"
                                                            >
                                                                <title>Last run failed: {task.lastRunError}</title>
                                                            </AlertCircle>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => setSelectedSlug(task.slug)}
                                                            className="truncate text-left text-sm font-medium text-foreground hover:text-primary"
                                                            title={task.name}
                                                        >
                                                            {task.name}
                                                        </button>
                                                    </div>
                                                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                                                        {task.slug}
                                                    </div>
                                                    {instructionsPreview && (
                                                        <div className="truncate text-xs text-muted-foreground/80" title={task.instructions}>
                                                            {instructionsPreview}
                                                        </div>
                                                    )}
                                                    {hasError && task.lastRunError && (
                                                        <div className="truncate text-xs text-amber-600 dark:text-amber-400" title={task.lastRunError}>
                                                            {task.lastRunError}
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-foreground/80">
                                                {summarizeSchedule(task.triggers)}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-foreground/80">
                                                {formatLastRanLabel(task.lastRunAt)}
                                            </td>
                                            <td className="px-4 py-3">
                                                {isRunning ? (
                                                    <div className="flex items-center gap-2">
                                                        <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-foreground animate-pulse">
                                                            <Loader2 className="size-3 animate-spin" />
                                                            Updating…
                                                        </span>
                                                        <Button
                                                            variant="destructive"
                                                            size="sm"
                                                            onClick={() => handleStop(task.slug)}
                                                            disabled={isStopping}
                                                        >
                                                            {isStopping ? <Loader2 className="size-3 animate-spin" /> : <Square className="size-3" />}
                                                            Stop
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-3">
                                                        {isUpdating ? (
                                                            <Loader2 className="size-4 animate-spin text-muted-foreground" />
                                                        ) : (
                                                            <span className="size-4 shrink-0" aria-hidden="true" />
                                                        )}
                                                        <Switch
                                                            checked={task.active}
                                                            onCheckedChange={(checked) => { void handleToggleActive(task.slug, checked) }}
                                                            disabled={isUpdating}
                                                        />
                                                        <span className="min-w-16 text-xs font-medium text-foreground/80">
                                                            {task.active ? 'Active' : 'Inactive'}
                                                        </span>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <NewTaskDialog
                open={showNewDialog}
                onClose={() => setShowNewDialog(false)}
                onCreated={(slug) => {
                    setShowNewDialog(false)
                    void load()
                    void window.ipc.invoke('bg-task:run', { slug })
                    setSelectedSlug(slug)
                }}
                onCreateWithCopilot={onCreateWithCopilot}
            />
        </div>
    )
}
