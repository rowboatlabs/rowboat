import { useState } from 'react'
import { ChevronRight, Pin } from 'lucide-react'
import type { spaces } from '@x/shared'
import { messageExcerpt } from '@/components/spaces/bookmarks'

/**
 * The pinned strip above the stream: one pin at a time, newest first, the
 * chevron steps through the rest (wrapping). Pins still ride the 📌 reaction
 * on the wire — this is the only place they show now; the chip row hides the
 * 📌 group and the picker no longer offers it, so "Pin message" is the sole
 * way in. Clicking the body jumps to the row.
 */
export function PinnedBanner({ pinned, memberNames, onJump }: {
    /** Already capped and ordered by the caller (newest first). */
    pinned: readonly spaces.Message[]
    memberNames: ReadonlyMap<string, string>
    onJump: (messageId: string) => void
}) {
    const [step, setStep] = useState(0)
    const count = pinned.length
    if (count === 0) return null
    // Derived, not synced: a pin removed under the cursor just wraps to the
    // newest, and the counter can never point past the end.
    const index = step % count
    const message = pinned[index]!
    const author = memberNames.get(message.author.memberId) ?? message.author.memberId

    return (
        <div className="mx-3 mb-1 flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-[var(--rowboat-panel-soft)] pl-2.5 pr-1 py-1 text-xs">
            <Pin className="size-3.5 shrink-0 text-[var(--stream-link)]" aria-hidden="true" />
            <button
                type="button"
                onClick={() => onJump(message.id)}
                title="Jump to the pinned message"
                className="flex min-w-0 flex-1 items-baseline gap-1.5 rounded px-1 py-0.5 text-left hover:bg-accent"
            >
                <span className="shrink-0 font-medium text-[var(--stream-link)]">
                    Pinned{count > 1 ? ` ${index + 1}/${count}` : ''}
                </span>
                <span className="shrink-0 font-medium text-foreground">{author}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{messageExcerpt(message.body, memberNames)}</span>
            </button>
            {count > 1 && (
                <button
                    type="button"
                    onClick={() => setStep((s) => s + 1)}
                    aria-label="Next pinned message"
                    title="Next pinned message"
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                    <ChevronRight className="size-3.5" />
                </button>
            )}
        </div>
    )
}
