import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Bot, Globe, Loader2, ShieldCheck, Terminal } from 'lucide-react'
import type { spaces } from '@x/shared'
import { cn } from '@/lib/utils'
import { Textarea } from '@/components/ui/textarea'
import { ModelSelector } from '@/components/model-selector'
import type { ModelSelection } from '@/hooks/use-models'
import { MemberAvatar } from '@/components/spaces/atoms'
import { containsRowboatAddress } from '@/lib/spaces-mentions'

// The space composer. A plain message box — Enter sends, Shift+Enter breaks a
// line — with two things layered on: `@` autocompletes members and @rowboat,
// and the moment the draft addresses @rowboat, a strip of agent options
// (model · permissions · search · terminal) appears; they ride along with the
// invocation for that one turn. The message itself always goes to the team.

/** Per-turn agent options, sent with the invocation when the draft addresses @rowboat. */
export interface AgentOptions {
    model?: { provider: string; model: string; effort?: 'low' | 'medium' | 'high' }
    permissionMode?: 'auto' | 'manual'
    searchEnabled?: boolean
    codeMode?: 'claude' | 'codex'
}

interface MentionCandidate {
    id: string
    /** Shown in the picker. */
    label: string
    /** What gets typed into the message — a NAME, never the opaque member id. */
    insert: string
    hint: string
    isAgent?: boolean
}

const MENTION_RE = /(^|[\s([{])@([\w.-]*)$/

export function Composer({ placeholder, onSend, busy, autoFocus, onType, seed, members = [], selfMemberId }: {
    placeholder: string
    onSend: (body: string, agent?: AgentOptions) => Promise<void>
    busy: boolean
    autoFocus?: boolean
    /** Called on every keystroke — drives the typing presence lease. */
    onType?: () => void
    /** Prefill (e.g. "Ask @rowboat about this"); a new nonce re-applies it. */
    seed?: { text: string; nonce: number } | null
    /** Space members, for @ autocomplete. */
    members?: spaces.Member[]
    selfMemberId?: string
}) {
    const [draft, setDraft] = useState('')
    const [appliedSeed, setAppliedSeed] = useState<number | null>(null)
    const ref = useRef<HTMLTextAreaElement | null>(null)

    // Agent options — only meaningful (and only shown) when @rowboat is addressed.
    const [model, setModel] = useState<ModelSelection | null>(null)
    const [permissionMode, setPermissionMode] = useState<'auto' | 'manual'>('auto')
    const [searchEnabled, setSearchEnabled] = useState(false)
    const [codeMode, setCodeMode] = useState<'claude' | 'codex' | null>(null)
    const [codeModeAvailable, setCodeModeAvailable] = useState(false)
    useEffect(() => {
        const load = () => {
            window.ipc.invoke('codeMode:getConfig', null)
                .then((r) => setCodeModeAvailable(r.enabled))
                .catch(() => setCodeModeAvailable(false))
        }
        load()
        window.addEventListener('code-mode-config-changed', load)
        return () => window.removeEventListener('code-mode-config-changed', load)
    }, [])

    // Apply a new seed during render (React's adjust-state-on-prop-change pattern).
    if (seed && seed.nonce !== appliedSeed) {
        setAppliedSeed(seed.nonce)
        setDraft(seed.text)
    }
    const seedNonce = seed?.nonce ?? null
    useEffect(() => {
        if (seedNonce === null) return
        const el = ref.current
        if (!el) return
        el.focus()
        const end = el.value.length
        el.setSelectionRange(end, end)
    }, [seedNonce])

    // --- @ autocomplete ------------------------------------------------------
    const [caret, setCaret] = useState(0)
    const [mentionOpen, setMentionOpen] = useState(false)
    const [mentionIndex, setMentionIndex] = useState(0)
    const mentionMatch = useMemo(() => {
        if (!mentionOpen) return null
        const before = draft.slice(0, caret)
        const m = MENTION_RE.exec(before)
        if (!m) return null
        return { query: (m[2] ?? '').toLowerCase(), start: caret - (m[2]?.length ?? 0) - 1 }
    }, [draft, caret, mentionOpen])
    const candidates = useMemo<MentionCandidate[]>(() => {
        if (!mentionMatch) return []
        const q = mentionMatch.query
        const list: MentionCandidate[] = []
        if ('rowboat'.startsWith(q)) list.push({ id: 'rowboat', label: 'rowboat', insert: 'rowboat', hint: 'your agent — acts only when asked', isAgent: true })
        for (const m of members) {
            const hay = `${m.id} ${m.displayName}`.toLowerCase()
            if (!q || hay.includes(q)) list.push({ id: m.id, label: m.displayName, insert: m.displayName, hint: m.id === selfMemberId ? 'you' : '' })
        }
        return list.slice(0, 8)
    }, [mentionMatch, members, selfMemberId])
    // Reset the highlighted row whenever the query changes (adjust-on-change, not an effect).
    const mentionQuery = mentionMatch?.query ?? null
    const [lastQuery, setLastQuery] = useState<string | null>(null)
    if (mentionQuery !== lastQuery) {
        setLastQuery(mentionQuery)
        setMentionIndex(0)
    }
    const showMentions = mentionOpen && !!mentionMatch && candidates.length > 0

    const insertAt = (start: number, end: number, text: string) => {
        const next = `${draft.slice(0, start)}${text}${draft.slice(end)}`
        setDraft(next)
        setMentionOpen(false)
        requestAnimationFrame(() => {
            const el = ref.current
            if (!el) return
            el.focus()
            const pos = start + text.length
            el.setSelectionRange(pos, pos)
            setCaret(pos)
        })
    }
    const pickCandidate = (c: MentionCandidate) => {
        if (!mentionMatch) return
        insertAt(mentionMatch.start, caret, `@${c.insert} `)
    }

    const insertRowboatChip = () => {
        const el = ref.current
        const mention = '@rowboat '
        if (!el) {
            setDraft((d) => (d.includes('@rowboat') ? d : `${mention}${d}`))
            return
        }
        const start = el.selectionStart ?? draft.length
        const end = el.selectionEnd ?? draft.length
        const before = draft.slice(0, start)
        const needsSpace = before.length > 0 && !/\s$/.test(before)
        insertAt(start, end, `${needsSpace ? ' ' : ''}${mention}`)
    }

    // --- send ----------------------------------------------------------------
    const mentioned = containsRowboatAddress(draft)
    const send = async () => {
        const body = draft.trim()
        if (!body || busy) return
        const agent: AgentOptions | undefined = mentioned
            ? {
                  ...(model ? { model: { provider: model.provider, model: model.model, ...(model.effort ? { effort: model.effort } : {}) } } : {}),
                  permissionMode,
                  ...(searchEnabled ? { searchEnabled: true } : {}),
                  ...(codeMode ? { codeMode } : {}),
              }
            : undefined
        await onSend(body, agent)
        setDraft('')
        setMentionOpen(false)
    }

    return (
        <div className="px-3 pb-3 pt-1 shrink-0">
            <div className="relative rounded-xl border border-border bg-background shadow-sm focus-within:border-foreground/30">
                {showMentions && (
                    <div className="absolute bottom-full left-2 z-20 mb-1 w-72 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-md">
                        {candidates.map((c, i) => (
                            <button
                                key={c.id}
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => pickCandidate(c)}
                                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left', i === mentionIndex ? 'bg-accent' : 'hover:bg-accent/60')}
                            >
                                {c.isAgent ? (
                                    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background"><Bot className="size-3.5" /></span>
                                ) : (
                                    <MemberAvatar id={c.id} name={c.label} size="sm" className="size-6 text-[10px]" />
                                )}
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[13px] font-medium">{c.label}</span>
                                    {c.hint && <span className="block truncate text-[11px] text-muted-foreground">{c.hint}</span>}
                                </span>
                            </button>
                        ))}
                        <div className="px-2 pb-0.5 pt-1 text-[10.5px] text-muted-foreground/80">↑↓ · ↵ or ⇥ to pick · esc</div>
                    </div>
                )}
                <Textarea
                    ref={ref}
                    autoFocus={autoFocus}
                    value={draft}
                    placeholder={placeholder}
                    rows={1}
                    className="min-h-9 max-h-40 resize-none border-0 bg-transparent dark:bg-transparent px-3 pt-2.5 pb-1 text-sm shadow-none focus-visible:ring-0 field-sizing-content"
                    onChange={(e) => {
                        setDraft(e.target.value)
                        const pos = e.target.selectionStart ?? e.target.value.length
                        setCaret(pos)
                        // Open on "@" at a word start; stay open while the query grows.
                        setMentionOpen(MENTION_RE.test(e.target.value.slice(0, pos)))
                        onType?.()
                    }}
                    onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
                    onKeyDown={(e) => {
                        if (showMentions) {
                            if (e.key === 'ArrowDown') {
                                e.preventDefault()
                                setMentionIndex((i) => (i + 1) % candidates.length)
                                return
                            }
                            if (e.key === 'ArrowUp') {
                                e.preventDefault()
                                setMentionIndex((i) => (i - 1 + candidates.length) % candidates.length)
                                return
                            }
                            if (e.key === 'Enter' || e.key === 'Tab') {
                                e.preventDefault()
                                const c = candidates[mentionIndex]
                                if (c) pickCandidate(c)
                                return
                            }
                            if (e.key === 'Escape') {
                                e.preventDefault()
                                setMentionOpen(false)
                                return
                            }
                        }
                        // Enter sends; Shift+Enter breaks a line.
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault()
                            void send()
                        }
                    }}
                />
                <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
                    <button
                        type="button"
                        onClick={insertRowboatChip}
                        title="Address your Rowboat — it acts only when asked"
                        className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
                            mentioned ? 'bg-foreground text-background' : 'bg-muted text-foreground/80 hover:bg-accent',
                        )}
                    >
                        @rowboat
                    </button>
                    {mentioned && (
                        <>
                            <span className="mx-0.5 h-4 w-px bg-border" />
                            <span className="text-[11px] text-muted-foreground">runs as your Rowboat</span>
                            <ModelSelector value={model} onChange={setModel} defaultOption={{ label: 'Assistant model' }} effortSelectable />
                            <button
                                type="button"
                                onClick={() => setPermissionMode((m) => (m === 'auto' ? 'manual' : 'auto'))}
                                title={permissionMode === 'auto' ? 'Auto-permission on — click for manual approval prompts' : 'Manual approval prompts — click for auto-permission'}
                                className={cn(
                                    'flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors',
                                    permissionMode === 'auto' ? 'bg-secondary text-foreground hover:bg-secondary/70' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                                )}
                            >
                                <ShieldCheck className="size-3.5 shrink-0" />
                                <span>{permissionMode === 'auto' ? 'Auto' : 'Manual'}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setSearchEnabled((v) => !v)}
                                aria-pressed={searchEnabled}
                                title="Web search"
                                className={cn(
                                    'flex h-7 shrink-0 items-center rounded-full border px-1.5 transition-colors',
                                    searchEnabled
                                        ? 'border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-400 dark:hover:bg-blue-900'
                                        : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
                                )}
                            >
                                <Globe className="size-4 shrink-0" />
                                {searchEnabled && <span className="ml-1.5 text-xs font-medium">Search</span>}
                            </button>
                            {codeModeAvailable && (
                                <button
                                    type="button"
                                    onClick={() => setCodeMode((m) => (m ? null : 'claude'))}
                                    aria-pressed={!!codeMode}
                                    title={codeMode ? 'Terminal on (Claude Code) — click to turn off' : 'Let it use the terminal / code tools'}
                                    className={cn(
                                        'flex h-7 shrink-0 items-center rounded-full border px-1.5 transition-colors',
                                        codeMode ? 'bg-secondary text-foreground border-transparent hover:bg-secondary/70' : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
                                    )}
                                >
                                    <Terminal className="size-4 shrink-0" />
                                    {codeMode && <span className="ml-1.5 text-xs font-medium">Terminal</span>}
                                </button>
                            )}
                        </>
                    )}
                    <div className="flex-1" />
                    <button
                        type="button"
                        onClick={() => void send()}
                        disabled={busy || !draft.trim()}
                        aria-label="Send"
                        title="Send (↵ · Shift+↵ for a new line)"
                        className="inline-flex size-7 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-30 transition-opacity"
                    >
                        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" />}
                    </button>
                </div>
            </div>
        </div>
    )
}
