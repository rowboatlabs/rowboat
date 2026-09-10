import type { MouseEventHandler, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A pane's label: click collapses the pane. The count shows only while
 * collapsed — that is the one moment a number says something the rows
 * can't. `children` are the pane's actions, right-aligned (hover-revealed
 * ones key off group/section, which the PANE carries — hovering anywhere in
 * it shows them).
 */
export function SecondaryRailSectionHeader({ label, collapsed, count, onToggle, children, disabled = false, variant = 'default' }: {
    label: string
    collapsed: boolean
    count: number
    onToggle: () => void
    children?: ReactNode
    disabled?: boolean
    variant?: 'default' | 'email'
}) {
    return (
        <div className="flex h-8 shrink-0 items-center gap-1 pl-3 pr-1.5">
            <button
                type="button"
                disabled={disabled}
                onClick={onToggle}
                aria-expanded={!collapsed}
                title={collapsed ? `Show ${label.toLowerCase()}` : `Hide ${label.toLowerCase()}`}
                className={cn('flex h-full min-w-0 flex-1 items-center gap-2 text-left text-[13px] text-muted-foreground hover:text-foreground', variant === 'email' ? 'font-normal' : 'font-semibold')}
            >
                <span className="truncate">{label}</span>
                {collapsed && count > 0 && <span className={cn('font-normal tabular-nums', variant === 'email' && 'text-[11px] text-muted-foreground/70')}>{count}</span>}
            </button>
            {children}
        </div>
    )
}

/** The same file-pane divider on every SecondaryRail surface. */
export function SecondaryRailDivider({ enabled, resizing, onMouseDown }: {
    enabled: boolean
    resizing: boolean
    onMouseDown: MouseEventHandler<HTMLDivElement>
}) {
    return <div
        onMouseDown={enabled ? onMouseDown : undefined}
        title={enabled ? 'Drag to resize' : undefined}
        className={cn(
            'h-1.5 shrink-0 border-t border-border transition-colors',
            enabled && 'cursor-row-resize hover:bg-primary/20',
            resizing && 'bg-primary/30',
        )}
    />
}
