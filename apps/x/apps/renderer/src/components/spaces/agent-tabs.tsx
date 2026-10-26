import { Fragment, useEffect, useId, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// The agent page's layout (2026-10-27): a rail of vertical tabs down the left,
// one per job, and the chosen job's screen on the right. A screen mounts the
// first time it is chosen and stays mounted, hidden, after that: an open file
// or a running command survives a look at another tab, and nothing loads
// before someone asks for it. Anything that cannot be undone lives on one
// tab, Danger zone, apart from the rest and marked in red.

export type AgentTab = {
    id: string
    label: string
    icon: ReactNode
    /** Shown beside the label: how many of the thing the screen lists. */
    count?: number | undefined
    danger?: boolean
    content: ReactNode
}

const MOVES = new Set(['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'])

export function AgentTabs({ tabs, value, onChange }: { tabs: AgentTab[]; value: string; onChange: (id: string) => void }) {
    const prefix = useId()
    const active = tabs.find((t) => t.id === value) ?? tabs[0]!
    // Screens seen so far stay mounted; a tab that has gone (alerts turned off, the VM deleted) just stops rendering.
    const [visited, setVisited] = useState<string[]>([active.id])
    if (!visited.includes(active.id)) setVisited([...visited, active.id])

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (!MOVES.has(e.key)) return
        e.preventDefault()
        const i = tabs.findIndex((t) => t.id === active.id)
        const n = tabs.length
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? (i + 1) % n : (i - 1 + n) % n
        const tab = tabs[next]!
        onChange(tab.id)
        document.getElementById(`${prefix}tab-${tab.id}`)?.focus()
    }

    return (
        <div className="grid min-w-0 gap-5 sm:grid-cols-[10.5rem_minmax(0,1fr)]">
            <div role="tablist" aria-label="Agent" aria-orientation="vertical" onKeyDown={onKeyDown} className="flex gap-0.5 overflow-x-auto sm:sticky sm:top-0 sm:flex-col sm:self-start">
                {tabs.map((t, i) => {
                    const selected = t.id === active.id
                    return (
                        <Fragment key={t.id}>
                            {t.danger && i > 0 && <hr className="my-1.5 hidden border-border sm:block" />}
                            <button
                                type="button"
                                role="tab"
                                id={`${prefix}tab-${t.id}`}
                                aria-selected={selected}
                                aria-controls={`${prefix}panel-${t.id}`}
                                tabIndex={selected ? 0 : -1}
                                onClick={() => onChange(t.id)}
                                className={cn(
                                    'flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:w-full',
                                    selected && !t.danger && 'bg-accent font-semibold text-foreground',
                                    t.danger && 'text-destructive hover:bg-destructive/10 hover:text-destructive',
                                    selected && t.danger && 'bg-destructive/10 font-semibold',
                                )}
                            >
                                <span className="shrink-0 [&>svg]:size-3.5">{t.icon}</span>
                                <span className="truncate">{t.label}</span>
                                {t.count !== undefined && (
                                    <span className={cn('ml-auto rounded-full px-1.5 text-[10px] tabular-nums', selected ? 'bg-background text-foreground' : 'bg-muted text-muted-foreground')}>{t.count}</span>
                                )}
                            </button>
                        </Fragment>
                    )
                })}
            </div>
            {tabs
                .filter((t) => visited.includes(t.id))
                .map((t) => (
                    <section key={t.id} role="tabpanel" id={`${prefix}panel-${t.id}`} aria-labelledby={`${prefix}tab-${t.id}`} hidden={t.id !== active.id} className="flex min-w-0 flex-col gap-4">
                        {t.content}
                    </section>
                ))}
        </div>
    )
}

/** A screen's top: what it is, a line on how it works, and its one main action on the right. */
export function ScreenHeader({ title, note, action }: { title: string; note?: string | undefined; action?: ReactNode }) {
    return (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0 flex-1 basis-56">
                <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                {note && <p className="mt-0.5 max-w-[62ch] text-xs leading-snug text-muted-foreground">{note}</p>}
            </div>
            {action && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{action}</div>}
        </div>
    )
}

/** A small heading inside a screen, for a second group below the first. */
export function Subhead({ children }: { children: ReactNode }) {
    return <h4 className="text-xs font-semibold text-foreground">{children}</h4>
}

/** A form for adding something, set off from the list it adds to. */
export function FormCard({ title, onSubmit, children }: { title: string; onSubmit: () => void; children: ReactNode }) {
    return (
        <form
            aria-label={title}
            className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3"
            onSubmit={(e: FormEvent) => {
                e.preventDefault()
                onSubmit()
            }}
        >
            <Subhead>{title}</Subhead>
            {children}
        </form>
    )
}

/** A list of things with their actions at the end of each row. */
export function Rows({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
    return (
        <ul aria-label={label} className={cn('flex flex-col divide-y divide-border rounded-lg border border-border bg-background', className)}>
            {children}
        </ul>
    )
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
    return <li className={cn('flex min-h-9 items-center gap-2.5 px-3 py-1.5 text-xs', className)}>{children}</li>
}

export function Empty({ children }: { children: ReactNode }) {
    return <p className="text-xs text-muted-foreground">{children}</p>
}

export function Tag({ children, tone = 'muted', title }: { children: ReactNode; tone?: 'muted' | 'warn' | 'accent'; title?: string }) {
    return (
        <span
            title={title}
            className={cn(
                'shrink-0 rounded border px-1.5 text-[10px] leading-4 whitespace-nowrap',
                tone === 'muted' && 'border-border text-muted-foreground',
                tone === 'warn' && 'border-amber-600/50 text-amber-700 dark:text-amber-400',
                tone === 'accent' && 'border-current text-[var(--rowboat-link)]',
            )}
        >
            {children}
        </span>
    )
}

/** A plain text action at the end of a row: Replace, Rename, Open. */
export function RowAction({ children, onClick, disabled, pressed, className }: { children: ReactNode; onClick: () => void; disabled?: boolean; pressed?: boolean; className?: string }) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            {...(pressed !== undefined ? { 'aria-pressed': pressed } : {})}
            className={cn('shrink-0 rounded-md px-2 py-0.5 font-sans text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50', pressed && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400', className)}
        >
            {children}
        </button>
    )
}

/** The red-bordered list on the Danger zone tab: one row per action, explained, with its control at the end. */
export function DangerZone({ children }: { children: ReactNode }) {
    return <div className="flex flex-col divide-y divide-destructive/25 rounded-lg border border-destructive/35">{children}</div>
}

export function DangerRow({ title, note, children, below }: { title: string; note: string; children?: ReactNode; below?: ReactNode }) {
    return (
        <div className="flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1 basis-56">
                    <p className="text-xs font-semibold text-foreground">{title}</p>
                    <p className="text-[11px] leading-snug text-muted-foreground">{note}</p>
                </div>
                {children && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">{children}</div>}
            </div>
            {below}
        </div>
    )
}

/**
 * An action that asks once more: the first click arms it (the label changes),
 * the second runs it; left alone, it disarms after a few seconds.
 */
export function ConfirmButton({ label, confirmLabel, onConfirm, disabled, busy, look = 'outline', className }: {
    label: string
    confirmLabel: string
    onConfirm: () => void
    disabled?: boolean
    busy?: boolean
    /** `outline`: a red outline button; `text`: red text in a row. */
    look?: 'outline' | 'text'
    className?: string
}) {
    const [armed, setArmed] = useState(false)
    useEffect(() => {
        if (!armed) return
        const timer = setTimeout(() => setArmed(false), 5_000)
        return () => clearTimeout(timer)
    }, [armed])
    const click = () => {
        if (armed) {
            setArmed(false)
            onConfirm()
        } else setArmed(true)
    }
    if (look === 'text') {
        return (
            <button type="button" disabled={disabled || busy} onClick={click} className={cn('shrink-0 rounded-md px-2 py-0.5 font-sans text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50', armed && 'bg-destructive/10', className)}>
                {armed ? confirmLabel : label}
            </button>
        )
    }
    return (
        <Button type="button" size="sm" variant="outline" disabled={disabled || busy} onClick={click} className={cn('border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive', armed && 'bg-destructive/10', className)}>
            {armed ? confirmLabel : label}
        </Button>
    )
}
