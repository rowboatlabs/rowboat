import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Textarea } from '@/components/ui/textarea'
import { containsRowboatAddress } from '@/lib/spaces-mentions'

// ---------------------------------------------------------------------------
// Composer — one shape for "start a topic" and "reply": rounded box, @rowboat
// chip, round send. ⌘/Ctrl+Enter or the button sends; Enter inserts a newline.
// ---------------------------------------------------------------------------

export function Composer({ placeholder, onSend, busy, autoFocus, onType, seed }: {
    placeholder: string
    onSend: (body: string) => Promise<void>
    busy: boolean
    autoFocus?: boolean
    /** Called on every keystroke — drives the typing presence lease. */
    onType?: () => void
    /** Prefill (e.g. "Ask @rowboat about this"); a new nonce re-applies it. */
    seed?: { text: string; nonce: number } | null
}) {
    const [draft, setDraft] = useState('')
    const [appliedSeed, setAppliedSeed] = useState<number | null>(null)
    const ref = useRef<HTMLTextAreaElement | null>(null)

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

    const send = async () => {
        const body = draft.trim()
        if (!body || busy) return
        await onSend(body)
        setDraft('')
    }

    const insertMention = () => {
        const el = ref.current
        const mention = '@rowboat '
        if (!el) {
            setDraft((d) => (d.includes('@rowboat') ? d : `${mention}${d}`))
            return
        }
        const start = el.selectionStart ?? draft.length
        const end = el.selectionEnd ?? draft.length
        const before = draft.slice(0, start)
        const after = draft.slice(end)
        const needsSpace = before.length > 0 && !/\s$/.test(before)
        const next = `${before}${needsSpace ? ' ' : ''}${mention}${after}`
        setDraft(next)
        requestAnimationFrame(() => {
            el.focus()
            const pos = before.length + (needsSpace ? 1 : 0) + mention.length
            el.setSelectionRange(pos, pos)
        })
    }

    const mentioned = containsRowboatAddress(draft)

    return (
        <div className="px-3 pb-3 pt-1 shrink-0">
            <div className="rounded-xl border border-border bg-background shadow-sm focus-within:border-foreground/30">
                <Textarea
                    ref={ref}
                    autoFocus={autoFocus}
                    value={draft}
                    placeholder={placeholder}
                    rows={1}
                    className="min-h-9 max-h-40 resize-none border-0 bg-transparent dark:bg-transparent px-3 pt-2.5 pb-1 text-sm shadow-none focus-visible:ring-0 field-sizing-content"
                    onChange={(e) => {
                        setDraft(e.target.value)
                        onType?.()
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault()
                            void send()
                        }
                    }}
                />
                <div className="flex items-center gap-2 px-2 pb-2">
                    <button
                        type="button"
                        onClick={insertMention}
                        title="Address your Rowboat — it acts only when asked"
                        className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
                            mentioned ? 'bg-foreground text-background' : 'bg-muted text-foreground/80 hover:bg-accent',
                        )}
                    >
                        @rowboat
                    </button>
                    <div className="flex-1" />
                    <button
                        type="button"
                        onClick={() => void send()}
                        disabled={busy || !draft.trim()}
                        aria-label="Send"
                        title="Send (⌘↵)"
                        className="inline-flex size-7 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-30 transition-opacity"
                    >
                        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" />}
                    </button>
                </div>
            </div>
        </div>
    )
}

