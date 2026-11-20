import { updateSlackSender } from '@/hooks/use-slack-sender'
import { useState } from 'react'
import type { spaces } from '@x/shared'
import { SlackIcon } from '@/components/onboarding/provider-icons'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { MemberProfilePopover } from './atoms'

// 2026-11-17: mapped author opens Rowboat; the separate mapping control retains source provenance.
export function SlackProfile({ message, orgId, selfMemberId, mappedMemberId, mappedName }: { message: spaces.Message; orgId?: string; selfMemberId?: string; mappedMemberId?: string | null; mappedName?: string }) {
    const source = message.author.slack!
    const [open, setOpen] = useState(false)
    const [members, setMembers] = useState<spaces.SpaceMember[]>([])
    const [linked, setLinked] = useState<string | null>(null)
    const [selected, setSelected] = useState('')
    const [busy, setBusy] = useState(false)
    const [loaded, setLoaded] = useState(false)
    const [error, setError] = useState('')
    const admin = members.some(m => m.id === selfMemberId && m.role === 'admin')
    const load = async () => {
        if (!orgId) return
        setOpen(true); setBusy(true); setLoaded(false); setError('')
        try {
            const [profile, roster] = await Promise.all([
                window.ipc.invoke('spaces:getSlackProfile', { orgId, spaceId: message.spaceId, messageId: message.id }),
                window.ipc.invoke('spaces:listMembers', { orgId, spaceId: message.spaceId }),
            ])
            updateSlackSender(orgId, message, profile.memberId)
            setLinked(profile.memberId); setSelected(profile.memberId ?? ''); setMembers(roster.members); setLoaded(true)
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not load profile.') }
        finally { setBusy(false) }
    }
    const save = async () => {
        if (!orgId) return
        setBusy(true); setError('')
        try {
            const profile = await window.ipc.invoke('spaces:linkSlackProfile', { orgId, spaceId: message.spaceId, messageId: message.id, memberId: selected || null })
            setLinked(profile.memberId)
            updateSlackSender(orgId, message, profile.memberId)
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not save profile link.') }
        finally { setBusy(false) }
    }
    return <>
        {mappedMemberId && <MemberProfilePopover id={mappedMemberId}>
            <button type="button" className="text-[15px] font-bold hover:underline">{mappedName ?? 'Rowboat member'}</button>
        </MemberProfilePopover>}
        <button type="button" disabled={!orgId} onClick={() => void load()} className="inline-flex items-center gap-1.5 text-[15px] font-bold hover:underline">
            {!mappedMemberId && source.name}<SlackIcon className="size-3.5" /><span className="text-xs font-normal text-muted-foreground">{mappedMemberId ? 'Sender mapping' : 'Slack'}</span>
        </button>
        <Dialog open={open} onOpenChange={setOpen}><DialogContent>
            <DialogHeader><DialogTitle className="flex items-center gap-2"><SlackIcon className="size-5" />{source.name}</DialogTitle>
                <DialogDescription>Imported Slack profile · {source.workspace}</DialogDescription></DialogHeader>
            <p className="text-xs text-muted-foreground">Slack ID: {source.userId}</p>
            {busy && <p role="status">Loading…</p>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {loaded && <>
                <p className="text-sm">{linked ? <>Linked to <MemberProfilePopover id={linked}><button className="font-medium underline">{members.find(m => m.id === linked)?.displayName ?? 'Rowboat profile'}</button></MemberProfilePopover></> : 'No Rowboat profile linked.'}</p>
                <p className="text-sm text-muted-foreground">Messages from this Slack sender in this space display the selected Rowboat user’s name, avatar, and profile. The original Slack sender ID is preserved. It does not invite anyone or grant access.</p>
                {admin && <div className="space-y-3">
                    <label className="block text-sm">Rowboat profile<select aria-label="Rowboat profile" className="mt-1 w-full rounded-md border border-input bg-background p-2" disabled={busy} value={selected} onChange={e => setSelected(e.target.value)}>
                        <option value="">No linked profile</option>
                        {members.filter(m => m.kind === 'human' && !m.deactivatedAt && !m.removedAt).map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
                    </select></label>
                    <Button disabled={busy || selected === (linked ?? '')} onClick={() => void save()}>Save profile link</Button>
                </div>}
            </>}
        </DialogContent></Dialog>
    </>
}
