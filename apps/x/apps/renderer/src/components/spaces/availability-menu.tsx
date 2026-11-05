import { useEffect, useState } from 'react'
import { currentStatus, notificationsPaused, NotificationSchedule, type Availability } from '@x/shared/dist/spaces.js'
import { useSpacesOrgs } from '@/hooks/use-spaces'
import { applyProfileUpdate, useOrgRosters, usePeopleOnline } from '@/hooks/use-space-members'
import { useAvailabilityClock } from '@/hooks/use-availability-clock'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { spaces } from '@x/shared'

const ROW = 'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent'
const SELECT = 'w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm'

export function AvailabilityMenu() {
    const { orgs } = useSpacesOrgs()
    const rosters = useOrgRosters(orgs.map(org => ({ id: org.id, spaceIds: org.spaces.map(s => s.id) })))
    const [selected, setSelected] = useState('')
    const org = orgs.find(org => org.id === selected) ?? orgs[0]
    const member = org && rosters.get(org.id)?.find(member => member.id === org.memberId)
    if (!org || !member || member.kind !== 'human') return null
    return <div className="border-t border-border p-1">
        {orgs.length > 1 && <label className="block px-2 text-xs">Availability on<select className={SELECT} value={org.id} onChange={e => setSelected(e.target.value)}>{orgs.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
        <MemberAvailability key={org.id} orgId={org.id} member={member} />
    </div>
}

function MemberAvailability({ orgId, member }: { orgId: string; member: spaces.Member }) {
    const now = useAvailabilityClock()
    const online = usePeopleOnline(orgId).has(member.id) && !member.availability?.manualAway
    const [dialog, setDialog] = useState<'status' | 'schedule' | 'pause' | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const value = member.availability
    const status = currentStatus(value, now)
    const paused = notificationsPaused(value, now)
    async function save(patch: Availability) {
        setBusy(true); setError('')
        try {
            const { member: updated } = await window.ipc.invoke('spaces:updateProfile', { orgId, availability: patch })
            applyProfileUpdate(orgId, updated)
            if (patch.manualAway === false) await window.ipc.invoke('spaces:activity', { orgId, active: true })
            setDialog(null)
        } catch (error) { setError(error instanceof Error ? error.message : 'Could not save availability') }
        finally { setBusy(false) }
    }
    return <>
        <p className="px-2 py-1 text-xs text-muted-foreground"><span className={online ? 'text-emerald-500' : ''} aria-hidden>{online ? '●' : '○'}</span> {online ? 'Active' : 'Away'}{paused ? ' · Notifications paused' : ''}</p>
        {error && <p role="alert" className="px-2 text-xs text-destructive">{error}</p>}
        <button type="button" className={ROW} disabled={busy} onClick={() => void save({ manualAway: online ? true : false })}>Set yourself as {online ? 'away' : 'active'}</button>
        <button type="button" className={ROW} onClick={() => setDialog('status')}>{status ? `${status.emoji || '💬'} ${status.text}` : '☺ Update status'}</button>
        {status && <button type="button" disabled={busy} className={ROW} onClick={() => void save({ status: null })}>Clear status</button>}
        <label className="block px-2 py-1.5 text-sm">Pause notifications
            <select aria-label="Pause notifications" className={SELECT} value="" disabled={busy} onChange={e => {
                if (e.target.value === 'custom') { setDialog('pause'); return }
                if (e.target.value) void save({ pausedUntil: new Date(Date.now() + Number(e.target.value) * 60_000).toISOString(), resumedUntil: null })
            }}>
                <option value="">Choose duration…</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option><option value="240">4 hours</option><option value="1440">24 hours</option><option value="custom">Custom…</option>
            </select>
        </label>
        {paused && <button type="button" className={ROW} disabled={busy} onClick={() => void save({ pausedUntil: null, resumedUntil: new Date(Date.now() + 60 * 60_000).toISOString() })}>Resume notifications for 1 hour</button>}
        <button type="button" className={ROW} onClick={() => setDialog('schedule')}>Settings → Notifications</button>
        {dialog && <AvailabilityEditor mode={dialog} value={value} busy={busy} error={error} onSave={save} onClose={() => setDialog(null)} />}
    </>
}

export function AvailabilityEditor({ mode, value, busy, error, onSave, onClose }: {
    mode: 'status' | 'schedule' | 'pause'; value?: Availability; busy: boolean; error: string;
    onSave: (patch: Availability) => Promise<void>; onClose: () => void;
}) {
    const status = currentStatus(value)
    const [text, setText] = useState(status?.text ?? '')
    const [emoji, setEmoji] = useState(status?.emoji ?? '')
    const [expiry, setExpiry] = useState('60')
    const [pause, setPause] = useState(status?.pauseNotifications ?? false)
    const [until, setUntil] = useState('')
    const [enabled, setEnabled] = useState(!!value?.schedule)
    const [schedule, setSchedule] = useState(value?.schedule ?? { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' })
    const [validation, setValidation] = useState('')
    useEffect(() => { setValidation('') }, [schedule])
    return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}><DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{mode === 'status' ? 'Update status' : mode === 'pause' ? 'Pause notifications' : 'Notifications'}</DialogTitle><DialogDescription>{mode === 'status' ? 'Let teammates know what you’re up to.' : 'Choose when notifications are allowed. Your online indicator follows activity.'}</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={event => {
            event.preventDefault()
            if (mode === 'pause') {
                const timestamp = new Date(until).getTime()
                if (!Number.isFinite(timestamp) || timestamp <= Date.now()) { setValidation('Choose a future date and time.'); return }
                void onSave({ pausedUntil: new Date(timestamp).toISOString(), resumedUntil: null })
            } else if (mode === 'schedule') {
                if (enabled && !NotificationSchedule.safeParse(schedule).success) { setValidation('Choose valid hours and an IANA time zone, such as Asia/Kolkata.'); return }
                void onSave({ schedule: enabled ? schedule : null, resumedUntil: null })
            } else {
                const expiresAt = expiry === 'never' ? null : new Date(Date.now() + Number(expiry) * 60_000).toISOString()
                void onSave({ status: text.trim() || emoji ? { text: text.trim(), emoji, expiresAt, pauseNotifications: pause } : null, ...(pause ? { resumedUntil: null } : {}) })
            }
        }}>
            <fieldset disabled={busy} className="space-y-3">
            {mode === 'status' ? <>
                <label className="block text-sm">Emoji<Input value={emoji} maxLength={32} placeholder="💬" onChange={e => setEmoji(e.target.value)} /></label>
                <label className="block text-sm">Status<Input value={text} maxLength={100} placeholder="What’s your status?" onChange={e => setText(e.target.value)} /></label>
                <label className="block text-sm">Clear after<select className={SELECT} value={expiry} onChange={e => setExpiry(e.target.value)}><option value="30">30 minutes</option><option value="60">1 hour</option><option value="240">4 hours</option><option value="1440">24 hours</option><option value="never">Don’t clear</option></select></label>
                <label className="flex gap-2 text-sm"><input type="checkbox" checked={pause} onChange={e => setPause(e.target.checked)} />Pause notifications until status clears</label>
            </> : mode === 'pause' ? <label className="block text-sm">Until (your local time)<Input type="datetime-local" required value={until} onChange={e => setUntil(e.target.value)} /></label> : <>
                <label className="flex gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Use a notification schedule</label>
                {enabled && <>
                    <div className="flex flex-wrap gap-2">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => <label key={day} className="flex gap-1 text-xs"><input type="checkbox" checked={schedule.days.includes(index)} onChange={e => setSchedule({ ...schedule, days: e.target.checked ? [...schedule.days, index] : schedule.days.filter(d => d !== index) })} />{day}</label>)}</div>
                    <label className="block text-sm">From<Input type="time" required value={schedule.start} onChange={e => setSchedule({ ...schedule, start: e.target.value })} /></label>
                    <label className="block text-sm">Until<Input type="time" required value={schedule.end} onChange={e => setSchedule({ ...schedule, end: e.target.value })} /></label>
                    <label className="block text-sm">Time zone<Input required value={schedule.timeZone} placeholder="Asia/Kolkata" onChange={e => setSchedule({ ...schedule, timeZone: e.target.value })} /></label>
                    <p className="text-xs text-muted-foreground">Outside these hours, notifications are paused. Matching start and end times allow a full day.</p>
                </>}
            </>}
            </fieldset>
            {(validation || error) && <p role="alert" className="text-sm text-destructive">{validation || error}</p>}
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button></div>
        </form>
    </DialogContent></Dialog>
}

export function AvailabilitySettings({ onClose }: { onClose: () => void }) {
    return <Dialog open onOpenChange={open => { if (!open) onClose() }}><DialogContent><DialogHeader><DialogTitle>Status &amp; availability</DialogTitle><DialogDescription>Manage your status and notifications on each server.</DialogDescription></DialogHeader><AvailabilityMenu /></DialogContent></Dialog>
}
