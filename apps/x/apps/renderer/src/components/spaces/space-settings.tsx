import { useState } from 'react'
import { ArrowLeft, PanelLeft, Bot } from 'lucide-react'
import { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type OrgWithSpaces, refreshSpacesOrgs } from '@/hooks/use-spaces'
import { refreshMembers } from '@/hooks/use-space-members'
import { isOwnAgent } from '@/lib/spaces-direct'
import { LOCAL_CONNECTION } from '@/lib/agent-kinds'
import { copySpacesLink } from '@/lib/spaces-copy-link'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { AddMembersDialog } from './add-members-dialog'
import { ArchiveSpaceDialog, DeleteSpaceDialog } from './space-admin-dialogs'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'

type Tab = 'general' | 'people' | 'agents' | 'actions'
type Confirmation = { title: string; description: string; run: () => Promise<unknown> }

// 2026-11-12: Use Harbor's existing operations and live roster for space settings.
export function SpaceSettings({ org, space, members, onBack, onShowSidebar }: {
    org: OrgWithSpaces; space: spaces.Space; members: readonly spaces.SpaceMember[]; onBack: () => void; onShowSidebar: () => void
}) {
    const [tab, setTab] = useState<Tab>('general')
    const [name, setName] = useState(space.name)
    const [query, setQuery] = useState('')
    const [busy, setBusy] = useState(false)
    const [adding, setAdding] = useState(false)
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
    const self = members.find(m => m.id === org.memberId)
    const admin = self?.role === 'admin'
    const people = members.filter(m => m.kind !== 'agent')
    const agents = members.filter(m => m.kind === 'agent')
    const adminCount = people.filter(m => m.role === 'admin').length
    const writable = !!self && !space.archived
    const perform = async (run: () => Promise<unknown>, message: string) => {
        if (busy) return
        setBusy(true)
        try { await run(); refreshMembers(org.id, space.id, { force: true }); await refreshSpacesOrgs(); toast(message, 'success'); setConfirmation(null) }
        catch (error) { toast(error instanceof Error ? error.message : 'Could not save changes', 'error') }
        finally { setBusy(false) }
    }
    const tabs: {id: Tab; label: string; count?: number}[] = [{id:'general',label:'General'}, {id:'people',label:'People',count:people.length}, {id:'agents',label:'Agents',count:agents.length}, {id:'actions',label:'Space actions'}]
    const roster = (tab === 'agents' ? agents : people).filter(m => m.displayName.toLowerCase().includes(query.trim().toLowerCase())).sort((a,b) => a.displayName.localeCompare(b.displayName))
    return <div className="spaces-surface flex min-h-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5"><Button size="icon" variant="ghost" aria-label="Toggle sidebar" onClick={onShowSidebar}><PanelLeft className="size-4" /></Button><span className="truncate text-sm font-medium"># {space.name}</span>{space.archived && <span className="text-xs text-muted-foreground">Archived</span>}</header>
        <div className="flex-1 overflow-y-auto"><div className="mx-auto max-w-4xl px-5 py-8 sm:px-10">
            <Button variant="ghost" size="sm" className="mb-6 -ml-3 text-muted-foreground" onClick={onBack}><ArrowLeft className="size-4" />Back to space</Button>
            <h1 className="text-2xl font-semibold tracking-tight">Space settings</h1><p className="mt-2 text-sm text-muted-foreground">Manage {space.name} and the people and agents who work here.</p>
            <nav aria-label="Space settings sections" className="mt-7 flex gap-6 overflow-x-auto border-b border-border">{tabs.map(t => <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} className={cn('flex shrink-0 items-center gap-2 border-b-2 py-3 text-sm',tab === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground')} onClick={() => {setTab(t.id);setQuery('')}}>{t.label}{t.count !== undefined && <span className="rounded bg-muted px-1.5 text-xs">{t.count}</span>}</button>)}</nav>
            {tab === 'general' && <div className="space-y-8 py-7"><form onSubmit={e => {e.preventDefault();if(name.trim() && writable) void perform(() => window.ipc.invoke('spaces:renameSpace',{orgId:org.id,spaceId:space.id,name:name.trim()}),'Space renamed')}}>
                <h2 className="text-base font-medium">Space details</h2><p className="mt-1 text-sm text-muted-foreground">Give this space a name people recognize.</p><label htmlFor="settings-space-name" className="mt-6 mb-2 block text-sm">Space name</label><Input id="settings-space-name" className="max-w-lg" value={name} onChange={e => setName(e.target.value)} required maxLength={100} disabled={!writable || busy} /><div className="mt-5 flex gap-2"><Button type="submit" disabled={!writable || busy || !name.trim() || name.trim() === space.name}>Save changes</Button><Button type="button" variant="outline" disabled={busy || name === space.name} onClick={() => setName(space.name)}>Discard</Button></div>
            </form><section className="border-t border-border pt-7"><h2 className="text-base font-medium">Space link</h2><p className="mt-1 mb-4 text-sm text-muted-foreground">A direct link for people who already have access.</p><Button variant="outline" onClick={() => void copySpacesLink(spaces.spaceUrl(org.address,space.id))}>Copy space link</Button></section></div>}
            {(tab === 'people' || tab === 'agents') && <section className="py-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-base font-medium">{tab === 'people' ? 'People' : 'Agents'}</h2><p className="mt-1 text-sm text-muted-foreground">{tab === 'people' ? 'Manage membership and who can administer this space.' : 'Manage the agents here and who can ask them to work.'}</p></div><Button disabled={!writable} onClick={() => setAdding(true)}>{tab === 'people' ? 'Add people' : 'Add agents'}</Button></div>
                <Input aria-label={`Search ${tab}`} placeholder={`Search ${tab}…`} value={query} onChange={e => setQuery(e.target.value)} className="mt-6 max-w-sm" /><p className="mt-4 text-xs text-muted-foreground">{tab === 'people' ? 'Only admins can change roles or remove members. A space must keep at least one admin.' : 'Only the owner can change an agent’s access. Agents on a personal computer are owner-only.'}</p>
                <div className="mt-3 divide-y divide-border">{roster.map(m => <div key={m.id} className="flex flex-wrap items-center gap-3 py-5"><div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-medium',m.kind === 'agent' && 'rounded-full')}>{m.kind === 'agent' ? <Bot className="size-4" /> : m.displayName.slice(0,2).toUpperCase()}</div><div className="min-w-0 flex-1 basis-40"><div className="truncate text-sm font-medium">{m.displayName}{m.id === org.memberId && <span className="text-muted-foreground"> (you)</span>}</div><p className="mt-1 text-xs text-muted-foreground">{m.kind === 'agent' ? `Owned by ${members.find(p => p.id === m.ownerId)?.displayName ?? 'another member'}` : m.role === 'admin' ? 'Space admin' : 'Member'}</p></div>
                    {m.kind === 'agent' ? <select aria-label={`Who can ask ${m.displayName}`} value={m.invocableBy ?? 'members'} disabled={busy || !writable || !isOwnAgent(m,org.memberId) || m.agentConnection === LOCAL_CONNECTION} className="rounded-md border border-border bg-background px-3 py-2 text-xs disabled:opacity-50" onChange={e => {const invocableBy=e.target.value as 'owner'|'members';void perform(() => window.ipc.invoke('spaces:setAgentAccess',{orgId:org.id,spaceId:space.id,agentId:m.id,invocableBy}),'Agent access updated')}}><option value="members">Everyone here</option><option value="owner">Owner only</option></select>
                    : <select aria-label={`Role for ${m.displayName}`} value={m.role} disabled={busy || !writable || !admin || (m.role === 'admin' && adminCount === 1)} className="rounded-md border border-border bg-background px-3 py-2 text-xs disabled:opacity-50" onChange={e => {const role=e.target.value as 'admin'|'member';setConfirmation({title:`Make ${m.displayName} ${role === 'admin' ? 'an admin' : 'a member'}?`,description:'Admins can manage membership and archive or delete this space.',run:() => window.ipc.invoke('spaces:setMemberRole',{orgId:org.id,spaceId:space.id,memberId:m.id,role})})}}><option value="member">Member</option><option value="admin">Admin</option></select>}
                    <Button variant="ghost" size="sm" className="text-destructive" disabled={busy || !writable || !admin || m.id === org.memberId} onClick={() => setConfirmation({title:`Remove ${m.displayName} from ${space.name}?`,description:m.kind === 'agent' ? 'It stops seeing and answering here. Its existing messages stay.' : 'They and their agents leave this space. Their existing messages stay.',run:() => window.ipc.invoke('spaces:removeMember',{orgId:org.id,spaceId:space.id,memberId:m.id})})}>Remove</Button>
                </div>)}{roster.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">{query ? 'No matches.' : `No ${tab} in this space.`}</p>}</div>
            </section>}
            {tab === 'actions' && <section className="divide-y divide-border py-3"><div className="flex flex-wrap items-center justify-between gap-4 py-6"><div><h2 className="text-base font-medium">{space.archived ? 'Restore this space' : 'Archive this space'}</h2><p className="mt-1 text-sm text-muted-foreground">{space.archived ? 'Allow members to work here again.' : 'Keep the history and close the space to new work.'}</p></div><Button variant="outline" disabled={!admin || busy} onClick={() => space.archived ? void perform(() => window.ipc.invoke('spaces:unarchiveSpace',{orgId:org.id,spaceId:space.id}),'Space restored') : setArchiveOpen(true)}>{space.archived ? 'Restore space' : 'Archive space'}</Button></div><div className="flex flex-wrap items-center justify-between gap-4 py-6"><div><h2 className="text-base font-medium text-destructive">Delete this space</h2><p className="mt-1 text-sm text-muted-foreground">Permanently delete the space and its contents.</p></div><Button variant="destructive" disabled={!admin || busy} onClick={() => setDeleteOpen(true)}>Delete space</Button></div>{!admin && <p className="py-4 text-xs text-muted-foreground">Only a space admin can manage these actions.</p>}</section>}
        </div></div>
        <AddMembersDialog org={org} space={space} members={members} open={adding} onOpenChange={setAdding} />
        {admin && <><ArchiveSpaceDialog orgId={org.id} space={space} open={archiveOpen} onOpenChange={setArchiveOpen} /><DeleteSpaceDialog orgId={org.id} space={space} open={deleteOpen} onOpenChange={setDeleteOpen} /></>}
        <AlertDialog open={confirmation !== null} onOpenChange={open => {if(!open && !busy)setConfirmation(null)}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirmation?.title}</AlertDialogTitle><AlertDialogDescription>{confirmation?.description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={e => {e.preventDefault();if(confirmation)void perform(confirmation.run,'Space membership updated')}}>{busy ? 'Saving…' : 'Confirm'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
}
