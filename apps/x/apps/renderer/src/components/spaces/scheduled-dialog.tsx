import { useEffect, useState } from 'react'
import { Bell, Clock, Loader2, X as XIcon } from 'lucide-react'
import type { ipc } from '@x/shared'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useMemberNames } from '@/components/spaces/member-text'
import { messageExcerpt } from '@/components/spaces/bookmarks'
import { formatScheduleTime } from '@/lib/spaces-schedule'
import { toast } from '@/lib/toast'

// Pending scheduled sends and reminders for this space — main's queue,
// listed and cancellable. Opened from the space header's ⋯ menu.

type ScheduledRow = ipc.IPCChannels['spaces:listScheduled']['res']['items'][number]

export function ScheduledDialog({ orgId, spaceId, onClose }: {
    orgId: string
    spaceId: string
    onClose: () => void
}) {
    const memberNames = useMemberNames()
    const [items, setItems] = useState<ScheduledRow[] | null>(null)

    useEffect(() => {
        let cancelled = false
        void window.ipc
            .invoke('spaces:listScheduled', { orgId, spaceId })
            .then((res) => {
                if (!cancelled) setItems(res.items)
            })
            .catch(() => {
                if (!cancelled) setItems([])
            })
        return () => {
            cancelled = true
        }
    }, [orgId, spaceId])

    const cancel = async (id: string) => {
        try {
            await window.ipc.invoke('spaces:cancelScheduled', { id })
            setItems((prev) => prev?.filter((i) => i.id !== id) ?? prev)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not cancel', 'error')
        }
    }

    return (
        <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogTitle className="flex items-center gap-2">
                    <Clock className="size-4" /> Scheduled
                </DialogTitle>
                <div className="max-h-72 overflow-y-auto">
                    {items === null && (
                        <div className="flex items-center gap-2 px-1 py-3 text-sm text-muted-foreground">
                            <Loader2 className="size-3.5 animate-spin" /> Loading…
                        </div>
                    )}
                    {items?.map((item) => (
                        <div key={item.id} className="group/sched flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40">
                            {item.kind === 'reminder' ? (
                                <Bell className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                            ) : (
                                <Clock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <div className="min-w-0 flex-1">
                                <div className="text-[11px] text-muted-foreground">
                                    {item.kind === 'reminder' ? 'Reminder' : 'Sends'} · {formatScheduleTime(new Date(item.at))}
                                </div>
                                <div className="truncate text-sm">{messageExcerpt(item.body, memberNames)}</div>
                            </div>
                            <button
                                type="button"
                                aria-label="Cancel"
                                title="Cancel"
                                onClick={() => void cancel(item.id)}
                                className="mt-0.5 hidden rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground group-hover/sched:block"
                            >
                                <XIcon className="size-3.5" />
                            </button>
                        </div>
                    ))}
                    {items?.length === 0 && (
                        <div className="px-1 py-3 text-sm text-muted-foreground">
                            Nothing scheduled. The clock button beside Send schedules a message; /remind sets a reminder.
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
