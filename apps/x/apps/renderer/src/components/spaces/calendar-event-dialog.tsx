import { useMemo, useState } from 'react'
import { Check, Loader2, Plus, Trash2, X } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { AgentBadge, MemberAvatar } from '@/components/spaces/atoms'
import { isDeparted, isRetiredAgent, memberLabel } from '@/lib/spaces-direct'
import { draftTimes, viewerTimeZone, type EventDraft, type RepeatChoice } from '@/lib/spaces-calendar'
import { cn } from '@/lib/utils'

// Creating and changing a calendar event (2026-11-28, harbor spec §7 The
// space calendar): Google Calendar's quick form. A title, when, whether it
// repeats, who it is for, and a description. Tagging anyone but yourself is
// what makes Harbor post the event in the space, so the footer says who will
// be told before the person saves, and says nothing when no one will be.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function repeatLabels(startDate: string): Array<{ value: RepeatChoice; label: string }> {
    const day = new Date(`${startDate || '2026-01-01'}T12:00:00`)
    return [
        { value: 'none', label: 'Does not repeat' },
        { value: 'daily', label: 'Daily' },
        { value: 'weekly', label: `Weekly on ${WEEKDAYS[day.getDay()]}` },
        { value: 'weekdays', label: 'Every weekday (Monday to Friday)' },
        { value: 'monthly', label: `Monthly on day ${day.getDate()}` },
    ]
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-1">
            <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">{label}</label>
            {children}
        </div>
    )
}

/** The members an event is for, as chips, with a picker over the space's roster. */
function AttendeePicker({ orgId, members, value, onChange }: {
    orgId: string
    members: readonly spaces.Member[]
    value: string[]
    onChange: (next: string[]) => void
}) {
    const [query, setQuery] = useState('')
    const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
    const candidates = useMemo(() => {
        const q = query.trim().toLowerCase()
        // Someone who has left, or a retired agent, cannot be told of anything.
        return members.filter((m) => !isDeparted(m) && !isRetiredAgent(m) && (!q || m.displayName.toLowerCase().includes(q)))
    }, [members, query])
    const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {value.map((id) => {
                const member = byId.get(id)
                const name = member ? memberLabel(member) : id
                return (
                    <span key={id} className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/50 pl-1 pr-1 text-[13px]">
                        <MemberAvatar orgId={orgId} avatarUrl={member?.avatarUrl} id={id} name={name} size="sm" agent={member?.kind === 'agent'} agentKind={member?.agentKind} />
                        <span className="truncate">{name}</span>
                        <button type="button" aria-label={`Remove ${name}`} onClick={() => toggle(id)}
                            className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
                            <X className="size-3" />
                        </button>
                    </span>
                )
            })}
            <Popover onOpenChange={(open) => { if (!open) setQuery('') }}>
                <PopoverTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="h-7 gap-1 rounded-full px-2.5 text-[13px] font-normal text-muted-foreground">
                        <Plus className="size-3.5" />Add people or agents
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72 rounded-xl p-0">
                    <div className="p-2">
                        <Input autoFocus value={query} placeholder="Search this space" aria-label="Search this space" className="h-8 text-sm" onChange={(e) => setQuery(e.target.value)} />
                    </div>
                    <div role="listbox" aria-multiselectable="true" aria-label="People and agents in this space" className="max-h-60 overflow-y-auto border-t border-border p-1.5">
                        {candidates.length === 0 && <div className="px-2 py-5 text-center text-xs text-muted-foreground">No one matches.</div>}
                        {candidates.map((m) => {
                            const on = value.includes(m.id)
                            return (
                                <button key={m.id} type="button" role="option" aria-selected={on} onClick={() => toggle(m.id)}
                                    className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/60', on && 'bg-accent')}>
                                    <MemberAvatar orgId={orgId} avatarUrl={m.avatarUrl} id={m.id} name={m.displayName} size="md" agent={m.kind === 'agent'} agentKind={m.agentKind} />
                                    <span className="min-w-0 flex-1 truncate">{memberLabel(m)}</span>
                                    {m.kind === 'agent' && <AgentBadge agentKind={m.agentKind} agentConnection={m.agentConnection} />}
                                    <span className={cn('inline-flex size-4 shrink-0 items-center justify-center rounded border', on ? 'border-foreground bg-foreground text-background' : 'border-border')}>
                                        {on && <Check className="size-3" />}
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    )
}

/**
 * Delete, asked twice: the first click turns the button into the question.
 * Deleting tells everyone the event tags at once, and a repeat goes whole,
 * so a slip is not undone by deleting a message.
 */
export function DeleteEventButton({ repeats, disabled, onDelete }: { repeats: boolean; disabled?: boolean; onDelete: () => void | Promise<void> }) {
    const [asking, setAsking] = useState(false)
    if (!asking) {
        return (
            <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={disabled} onClick={() => setAsking(true)}>
                <Trash2 className="size-3.5" />Delete
            </Button>
        )
    }
    return (
        <span className="inline-flex items-center gap-1.5 text-[13px]">
            <span className="text-muted-foreground">{repeats ? 'Delete every occurrence?' : 'Delete this event?'}</span>
            <Button type="button" variant="destructive" size="sm" disabled={disabled} onClick={() => { void onDelete() }}>Delete</Button>
            <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => setAsking(false)}>Keep</Button>
        </span>
    )
}

/** Who saving will tell, in words, or nothing when it tells no one. */
function tellLine(names: string[], spaceLabel: string, editing: boolean): string | null {
    if (names.length === 0) return null
    const who = names.length <= 2 ? names.join(' and ') : `${names[0]}, ${names[1]} and ${names.length - 2} more`
    return editing ? `${who} will get a message in ${spaceLabel} if the time changes or they are newly added.` : `${who} will get a message in ${spaceLabel} about this event.`
}

export function CalendarEventDialog({ orgId, spaceLabel, members, selfMemberId, initial, editing, onClose, onSave, onDelete }: {
    orgId: string
    /** "#launch", or the other person's name in a DM. */
    spaceLabel: string
    members: readonly spaces.Member[]
    selfMemberId: string | undefined
    initial: EventDraft
    /** The event being changed; absent for a new one. */
    editing?: spaces.CalendarEntry
    onClose: () => void
    /** Saves; a throw keeps the dialog open with what was typed. */
    onSave: (draft: EventDraft) => Promise<void>
    onDelete?: () => Promise<void>
}) {
    const [draft, setDraft] = useState<EventDraft>(initial)
    const [busy, setBusy] = useState<'save' | 'delete' | null>(null)
    const [error, setError] = useState<string | null>(null)
    const set = (patch: Partial<EventDraft>) => { setDraft((d) => ({ ...d, ...patch })); setError(null) }

    const times = draftTimes(draft, editing)
    const canSave = draft.title.trim().length > 0 && times.ok && busy === null
    const names = useMemo(() => new Map(members.map((m) => [m.id, memberLabel(m)])), [members])
    const told = draft.attendees.filter((id) => id !== selfMemberId).map((id) => names.get(id) ?? id)
    const tell = tellLine(told, spaceLabel, editing !== undefined)

    // Moving the start keeps the event's length, as every calendar does.
    const setStartDate = (startDate: string) => {
        if (!startDate || !draft.startDate) return set({ startDate })
        const shift = Math.round((Date.parse(`${startDate}T00:00:00Z`) - Date.parse(`${draft.startDate}T00:00:00Z`)) / 86_400_000)
        const end = new Date(`${draft.endDate || draft.startDate}T00:00:00Z`)
        end.setUTCDate(end.getUTCDate() + shift)
        set({ startDate, endDate: end.toISOString().slice(0, 10) })
    }

    const run = async (kind: 'save' | 'delete', act: () => Promise<void>) => {
        setBusy(kind)
        setError(null)
        try {
            await act()
            onClose()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save the event')
        } finally {
            setBusy(null)
        }
    }

    return (
        <Dialog open onOpenChange={(open) => { if (!open && busy === null) onClose() }}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{editing ? 'Edit event' : 'New event'}</DialogTitle>
                    <DialogDescription className="sr-only">{editing ? 'Change this calendar event.' : `Add an event to the calendar of ${spaceLabel}.`}</DialogDescription>
                </DialogHeader>
                <form className="flex flex-col gap-3.5" onSubmit={(e) => { e.preventDefault(); if (canSave) void run('save', () => onSave(draft)) }}>
                    <Input autoFocus aria-label="Title" value={draft.title} maxLength={200} placeholder="Add a title" className="h-10 text-[15px] font-medium" onChange={(e) => set({ title: e.target.value })} />

                    <div className="flex flex-col gap-2">
                        {/* Two rows, start over end: four fields on one line do not fit the dialog, and wrap mid-range. */}
                        <div className="grid grid-cols-[auto_auto_auto_1fr] items-center gap-x-2 gap-y-2">
                            <span className="pr-1 text-sm text-muted-foreground">Starts</span>
                            <Input type="date" aria-label="Start date" value={draft.startDate} className="h-8 w-auto text-sm" onChange={(e) => setStartDate(e.target.value)} />
                            {draft.allDay ? <span /> : <Input type="time" aria-label="Start time" value={draft.startTime} step={300} className="h-8 w-auto text-sm" onChange={(e) => set({ startTime: e.target.value })} />}
                            <span />
                            <span className="pr-1 text-sm text-muted-foreground">Ends</span>
                            <Input type="date" aria-label="End date" value={draft.endDate} min={draft.startDate} className="h-8 w-auto text-sm" onChange={(e) => set({ endDate: e.target.value })} />
                            {draft.allDay ? <span /> : <Input type="time" aria-label="End time" value={draft.endTime} step={300} className="h-8 w-auto text-sm" onChange={(e) => set({ endTime: e.target.value })} />}
                            <span />
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                            <label className="flex cursor-pointer items-center gap-2 text-sm">
                                <Switch checked={draft.allDay} onCheckedChange={(allDay) => set({ allDay })} />All day
                            </label>
                            <Select value={draft.repeat} onValueChange={(repeat) => set({ repeat: repeat as RepeatChoice })}>
                                <SelectTrigger aria-label="Repeat" className="h-8 w-auto min-w-44 text-sm"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {repeatLabels(draft.startDate).map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            {draft.repeat !== 'none' && (
                                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                                    until
                                    <Input type="date" aria-label="Repeat until" value={draft.until} min={draft.startDate} className="h-8 w-auto text-sm text-foreground" onChange={(e) => set({ until: e.target.value })} />
                                </label>
                            )}
                        </div>
                        {!draft.allDay && <p className="text-xs text-muted-foreground">Times are in your time zone, {viewerTimeZone().replace(/_/g, ' ')}.</p>}
                    </div>

                    <Field label="For">
                        <AttendeePicker orgId={orgId} members={members} value={draft.attendees} onChange={(attendees) => set({ attendees })} />
                    </Field>

                    <Field label="Description" htmlFor="calendar-event-description">
                        <Textarea id="calendar-event-description" value={draft.description} maxLength={4000} rows={3} placeholder="What is this for?" className="text-sm" onChange={(e) => set({ description: e.target.value })} />
                    </Field>

                    {(error ?? (!times.ok && draft.title.trim() ? times.problem : null)) && (
                        <p role="alert" className="text-xs text-destructive">{error ?? (!times.ok ? times.problem : '')}</p>
                    )}
                    {tell && <p className="text-xs text-muted-foreground">{tell} Nothing is sent when the event starts.</p>}

                    <DialogFooter className="items-center gap-2 sm:justify-between">
                        {editing && onDelete ? (
                            <DeleteEventButton repeats={editing.recurrence !== undefined} disabled={busy !== null} onDelete={() => run('delete', onDelete)} />
                        ) : <span />}
                        <div className="flex items-center gap-2">
                            <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={onClose}>Cancel</Button>
                            <Button type="submit" size="sm" disabled={!canSave}>
                                {busy === 'save' && <Loader2 className="size-3.5 animate-spin" />}{editing ? 'Save' : 'Create'}
                            </Button>
                        </div>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
