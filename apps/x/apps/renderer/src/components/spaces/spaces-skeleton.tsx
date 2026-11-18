import { Skeleton } from '@/components/ui/skeleton'

// What the web app paints while it loads (2026-11-09): the shape of the
// screen that is coming — the sidebar's sections and a stream of messages —
// pulsing, instead of a line that says "Loading…". Nothing here is data.

const ROW_WIDTHS = ['w-24', 'w-32', 'w-20', 'w-28', 'w-16']

function SidebarSkeleton() {
    const section = (rows: number, offset: number) => (
        <div className="mt-4 flex flex-col gap-2">
            <Skeleton className="ml-1.5 h-2.5 w-12" />
            {Array.from({ length: rows }, (_, i) => (
                <div key={i} className="flex items-center gap-2.5 px-1.5 py-1">
                    <Skeleton className="size-5 rounded-[4px]" />
                    <Skeleton className={`h-3 ${ROW_WIDTHS[(i + offset) % ROW_WIDTHS.length]}`} />
                </div>
            ))}
        </div>
    )
    return (
        <div aria-hidden="true" className="hidden w-[260px] shrink-0 flex-col border-r border-border bg-[var(--rowboat-panel-soft)] p-3 sm:flex">
            <div className="flex items-center gap-2 px-1 py-1"><Skeleton className="size-5 rounded-md" /><Skeleton className="h-3.5 w-16" /></div>
            <Skeleton className="mt-3 h-8 w-full rounded-md" />
            <div className="mt-3 flex flex-col gap-2">
                <div className="flex items-center gap-2.5 px-1.5 py-1"><Skeleton className="size-4 rounded-sm" /><Skeleton className="h-3 w-16" /></div>
                <div className="flex items-center gap-2.5 px-1.5 py-1"><Skeleton className="size-4 rounded-sm" /><Skeleton className="h-3 w-14" /></div>
            </div>
            {section(3, 0)}
            {section(5, 2)}
            {section(4, 1)}
        </div>
    )
}

/** A stream of messages, before they arrive. */
export function StreamSkeleton({ rows = 6 }: { rows?: number }) {
    return (
        <div aria-busy="true" aria-label="Loading messages" className="flex flex-col gap-6 px-3 py-4">
            {Array.from({ length: rows }, (_, i) => (
                <div key={i} className="flex gap-3">
                    <Skeleton className="size-9 shrink-0 rounded-[6px]" />
                    <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
                        <div className="flex items-center gap-2"><Skeleton className="h-3.5 w-28" /><Skeleton className="h-3 w-10" /></div>
                        <Skeleton className={`h-3.5 ${['w-3/4', 'w-1/2', 'w-5/6', 'w-2/3', 'w-1/3', 'w-4/5'][i % 6]}`} />
                        {i % 3 === 0 && <Skeleton className="h-3.5 w-1/4" />}
                    </div>
                </div>
            ))}
        </div>
    )
}

/** The whole Spaces screen, before the server has answered: sidebar, a space's header, its stream. */
export function SpacesSkeleton() {
    return (
        <div role="status" aria-live="polite" aria-label="Loading Spaces" className="flex min-h-0 flex-1">
            <SidebarSkeleton />
            <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex h-12 shrink-0 items-center gap-4 border-b border-border px-4">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-7 w-48 rounded-md" />
                    <div className="flex-1" />
                    <Skeleton className="h-7 w-40 rounded-md" />
                </div>
                <div className="min-h-0 flex-1 overflow-hidden"><StreamSkeleton rows={7} /></div>
                <div className="px-3 pb-3"><Skeleton className="h-20 w-full rounded-xl" /></div>
            </div>
        </div>
    )
}
