import { Fragment } from 'react'
import { Loader2, Route, X as XIcon } from 'lucide-react'

// The strip Auto puts above a composer (2026-09-23) when it has something to
// say about the text in the box: "Auto put this reply here" over a thread
// composer, "this reads as a new message" over the stream composer. This is
// where the person says "not this". It stays until they act, since a toast
// would fade and a wrong destination should not. Rendered inside the composer
// dock's side padding so it lines up with the frame.
export function AutoBanner({ message, hint, actions, busy = false, onDismiss, dismissTitle }: {
    message: string
    /** Quieter text after the message, e.g. how to confirm. */
    hint?: string
    actions: { label: string; onClick: () => void }[]
    busy?: boolean
    onDismiss: () => void
    dismissTitle: string
}) {
    return (
        <div className="shrink-0 px-[16px] pt-3">
            <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Route className="size-3.5 shrink-0" />
                    {message}
                    {hint && <span className="text-muted-foreground/70">{hint}</span>}
                </span>
                {actions.map((action, i) => (
                    <Fragment key={action.label}>
                        {i > 0 && <span aria-hidden className="text-muted-foreground/60">·</span>}
                        <button
                            type="button"
                            disabled={busy}
                            onClick={action.onClick}
                            className="inline-flex items-center gap-1 font-medium text-foreground hover:underline disabled:opacity-50"
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
            </div>
        </div>
    )
}
