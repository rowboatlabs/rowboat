import { Fragment } from 'react'
import { Check, Loader2, Route, X as XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// The strip Auto puts above a composer (2026-09-23) when it has something to
// say about the text in the box: "Auto put this reply here" over a thread
// composer, "this reads as a new message" over the stream composer. This is
// where the person says "not this". It stays until they act, since a toast
// would fade and a wrong destination should not. Rendered inside the composer
// dock's side padding so it lines up with the frame.
//
// Chips (2026-09-24) are offers, never actions: a tag chip adds its mention
// when clicked and takes it back when clicked again; its × declines it for
// this draft. Sending with chips untouched sends nothing extra.

export interface BannerChip {
    key: string
    label: string
    /** The chip's mention is in the draft now. */
    added: boolean
    onToggle: () => void
    onDecline: () => void
}

export function AutoBanner({ message, hint, actions, busy = false, onDismiss, dismissTitle, chips, chipsLabel = 'Tag' }: {
    message: string
    /** Quieter text after the message, e.g. how to confirm. */
    hint?: string
    actions: { label: string; onClick: () => void }[]
    busy?: boolean
    onDismiss: () => void
    dismissTitle: string
    chips?: BannerChip[]
    chipsLabel?: string
}) {
    // One size everywhere (2026-09-24 review): every text node says text-xs
    // itself, so nothing inherits something else, and the message and the
    // actions differ only by colour, not by size or weight.
    return (
        <div className="shrink-0 px-[16px] pt-3">
            <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs leading-5">
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Route className="size-3.5 shrink-0" />
                    <span className="text-xs">{message}</span>
                    {hint && <span className="text-xs text-muted-foreground/70">{hint}</span>}
                </span>
                {actions.map((action, i) => (
                    <Fragment key={action.label}>
                        {i > 0 && <span aria-hidden className="text-xs text-muted-foreground/60">·</span>}
                        <button
                            type="button"
                            disabled={busy}
                            onClick={action.onClick}
                            className="inline-flex items-center gap-1 text-xs text-foreground hover:underline disabled:opacity-50"
                        >
                            {busy && i === actions.length - 1 && <Loader2 className="size-3 animate-spin" />}
                            {action.label}
                        </button>
                    </Fragment>
                ))}
                <span className="flex-1" />
                <button
                    type="button"
                    onClick={onDismiss}
                    aria-label={dismissTitle}
                    title={dismissTitle}
                    className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                    <XIcon className="size-3.5" />
                </button>
                {chips && chips.length > 0 && (
                    /* w-full: its own line under the verdict. */
                    <div className="flex w-full flex-wrap items-center gap-1.5 pt-0.5">
                        <span className="text-xs text-muted-foreground">{chipsLabel}</span>
                        {chips.map((chip) => (
                            <span
                                key={chip.key}
                                className={cn(
                                    'group inline-flex items-center rounded-full border text-xs transition-colors',
                                    chip.added ? 'border-transparent bg-foreground text-background' : 'border-border bg-background text-foreground/90',
                                )}
                            >
                                <button
                                    type="button"
                                    onClick={chip.onToggle}
                                    aria-pressed={chip.added}
                                    title={chip.added ? 'Remove the tag' : 'Tag them'}
                                    className={cn('inline-flex items-center gap-1 py-0.5 pl-2 text-xs', chip.added ? 'pr-2' : 'pr-1')}
                                >
                                    {chip.added && <Check className="size-3" />}
                                    {chip.label}
                                </button>
                                {!chip.added && (
                                    <button
                                        type="button"
                                        onClick={chip.onDecline}
                                        aria-label={`Not ${chip.label}`}
                                        title="Not this one"
                                        className="mr-0.5 rounded-full p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                                    >
                                        <XIcon className="size-3" />
                                    </button>
                                )}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
