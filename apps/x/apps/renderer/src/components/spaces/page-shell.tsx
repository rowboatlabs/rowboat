import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Spaces redesign (2026-10-21): Activity, Discussions and Files share the
// Agents page's shape — a large title with its count, one line on what the
// page is, then a filter row, at the app's 14px body size — instead of each
// drawing its own 13px header strip. Same column as the Agents page.

export function SpacesPage({ label, title, count, subtitle, actions, toolbar, className, children }: {
    label: string
    title: string
    count?: number
    subtitle?: ReactNode
    /** Buttons at the title's right. */
    actions?: ReactNode
    /** The filter row under the title. */
    toolbar?: ReactNode
    className?: string
    children: ReactNode
}) {
    return (
        <section aria-label={label} className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-background', className)}>
            <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div className="min-w-0">
                        <h1 className="flex items-baseline gap-2.5 text-2xl font-semibold tracking-tight">
                            {title}
                            {count !== undefined && <span className="text-base font-normal tabular-nums text-muted-foreground">{count}</span>}
                        </h1>
                        {subtitle && <p className="mt-1 text-sm text-[var(--rowboat-ink-secondary)]">{subtitle}</p>}
                    </div>
                    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
                </header>
                {toolbar && <div className="mt-6 flex flex-wrap items-center gap-3">{toolbar}</div>}
                <div className="mt-4">{children}</div>
            </div>
        </section>
    )
}

/** The Agents page's pill filter, shared so every Spaces page filters the same way. */
export function FilterTabs<T extends string>({ label, value, options, onChange }: {
    label: string
    value: T
    options: ReadonlyArray<{ value: T; label: string; count?: number }>
    onChange: (value: T) => void
}) {
    return (
        <div role="group" aria-label={label} className="inline-flex flex-wrap rounded-lg bg-black/[0.05] p-0.5 [.dark_&]:bg-white/[0.06]">
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    aria-pressed={value === o.value}
                    onClick={() => onChange(o.value)}
                    className={cn(
                        'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[13px] transition-[color,background-color,box-shadow] duration-150',
                        value === o.value
                            ? 'bg-white font-medium text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08)] [.dark_&]:bg-white/[0.1] [.dark_&]:shadow-none'
                            : 'text-muted-foreground hover:text-foreground',
                    )}
                >
                    {o.label}
                    {o.count !== undefined && o.count > 0 && <span className="tabular-nums text-muted-foreground">{o.count}</span>}
                </button>
            ))}
        </div>
    )
}

/** A quiet empty state, left-aligned with the page: an icon in a soft tile, one line of what to do. */
export function SpacesEmpty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
    return (
        <div className="flex flex-col items-start px-3 py-12">
            <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-5">{icon}</span>
            <p className="mt-4 text-sm font-medium">{title}</p>
            {children && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</p>}
        </div>
    )
}
