import { useEffect, useMemo, useState } from 'react'
import type { spaces } from '@x/shared'
import { ThreadPane } from './thread-pane'
import { useSpaceFeed, useSpaceLive, useSpaceNames, useSpacesOrgs, refreshSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'
import { useSpaceMembers, useOrgRoster } from '@/hooks/use-space-members'
import { useSpacePresence } from '@/hooks/use-space-chat'
import { useSpaceInvocations } from '@/hooks/use-space-invocations'
import { SpaceAccessContext } from '@/lib/spaces-access'
import { SpaceMembersProvider, SpaceProfilesProvider } from './member-text'
import { SpaceInvocationsProvider } from './invocation-lines'
import { MemberAdminProvider } from './member-admin'
import { SpaceRefsProvider, SpaceAssetsProvider, SpaceNavProvider } from './space-markdown'
import { isGroupChat } from '@/lib/spaces-navigation'
import { memberLabel } from '@/lib/spaces-direct'
import { requestJump } from '@/lib/spaces-jump'
import { toast } from '@/lib/toast'
import type { RailSelection } from '@/lib/spaces-selection'

// 2026-11-03: the workspace list remains outside these providers. Every action
// in its side pane belongs to the selected thread's channel or DM.
export function WorkspaceThreadPane({ org, space, rootId, item, active, onClose, onOpenThread, onOpenSpace, onOpenSession, expanded, onToggleExpanded, showBack }: {
    org: OrgWithSpaces; space: spaces.Space; rootId: string; item?: spaces.WorkspaceThread; active: boolean
    onClose: () => void; onOpenThread: (spaceId: string, rootId: string) => void
    onOpenSpace: (orgId: string, spaceId: string, rail?: RailSelection) => void
    onOpenSession?: (id: string) => void; expanded: boolean; onToggleExpanded: () => void; showBack: boolean
}) {
    const { orgs } = useSpacesOrgs()
    const feed = useSpaceFeed(org.id, space.id)
    const members = useSpaceMembers(org.id, space.id)
    const spaceIds = useMemo(() => [...org.spaces, ...org.directs].map((s) => s.id), [org.spaces, org.directs])
    const roster = useOrgRoster(org.id, spaceIds)
    const profiles = useMemo(() => [...new Map([...roster, ...members].map((m) => [m.id, m])).values()], [roster, members])
    const names = useMemo(() => new Map(profiles.map((m) => [m.id, memberLabel(m)])), [profiles])
    const spaceNames = useSpaceNames(org.id)
    const presence = useSpacePresence(org.id, space.id, org.memberId, active)
    const invocations = useSpaceInvocations(org.id, space.id)
    const [entries, setEntries] = useState<spaces.SpacesAssetEntry[]>([])
    const [refreshTick, setRefreshTick] = useState(0)
    const [artifactsOpen, setArtifactsOpen] = useState(false)
    useSpaceLive(active ? org.id : null, active ? space.id : null, (frame) => {
        if (frame.kind === 'event' || frame.kind === 'subscribed') setRefreshTick((n) => n + 1)
    })
    useEffect(() => {
        let cancelled = false
        void window.ipc.invoke('spaces:listAssets', { orgId: org.id, spaceId: space.id }).then((r) => { if (!cancelled) setEntries(r.entries) }).catch(() => {})
        return () => { cancelled = true }
    }, [org.id, space.id, refreshTick])
    const openFile = (assetId: string) => onOpenSpace(org.id, space.id, { kind: 'file', assetId, fromThreadRootId: rootId })
    const selfIsAdmin = profiles.find((m) => m.id === org.memberId)?.role === 'admin'
    const openMessage = (orgId: string, spaceId: string, messageId: string) => {
        void window.ipc.invoke('spaces:getMessage', { orgId, spaceId, messageId }).then(({ message }) => {
            const root = message.threadRoot ?? message.id
            requestJump({ topicId: root, messageId, offset: message.offset })
            if (orgId === org.id) onOpenThread(spaceId, root)
            else onOpenSpace(orgId, spaceId, { kind: 'thread', rootMessageId: root })
        }).catch((err) => toast(err instanceof Error ? err.message : 'Could not open message', 'error'))
    }
    return <SpaceAccessContext.Provider value={{ member: true, writable: !space.archived, archived: !!space.archived, joining: false, join: () => {} }}>
        <SpaceMembersProvider members={names} spaceNames={spaceNames}>
        <SpaceProfilesProvider members={profiles} here={new Set(presence.here)} selfId={org.memberId}>
        <MemberAdminProvider orgId={org.id} orgName={org.name} selfId={org.memberId} isAdmin={!!selfIsAdmin} space={space.kind === 'shared' && !isGroupChat(org) ? space : undefined} spaceMemberIds={members.map((m) => m.id)}>
        <SpaceRefsProvider refs={{ orgId: org.id, orgAddress: org.address, spaceId: space.id, ...(space.kind === 'direct' ? { directWith: space.participants?.find((id) => id !== org.memberId) } : {}) }}>
        <SpaceInvocationsProvider byMessage={invocations} orgId={org.id} selfId={org.memberId} isAdmin={selfIsAdmin}>
        <SpaceAssetsProvider entries={entries}>
        <SpaceNavProvider onOpenFile={openFile} onOpenSpace={onOpenSpace} onOpenSpaceFile={(orgId, spaceId, assetId) => onOpenSpace(orgId, spaceId, { kind: 'file', assetId })}
            onOpenMessage={openMessage} resolveOrg={(address) => orgs.find((o) => o.address === address)?.id ?? null}
            resolveSpace={(orgId, id) => { const target = orgs.find((o) => o.id === orgId); return target ? [...target.spaces, ...target.directs].find((s) => s.id === id || s.name === id)?.id ?? null : null }}
            onOpenDirect={(orgId, memberId) => { void window.ipc.invoke('spaces:openDirect', { orgId, memberId }).then(async ({ space }) => { await refreshSpacesOrgs(); onOpenSpace(orgId, space.id) }).catch((err) => toast(err instanceof Error ? err.message : 'Could not open DM', 'error')) }}
            onOpenAttachment={(src, name) => { const url = new URL(src); url.searchParams.set('name', name); onOpenSpace(org.id, space.id, { kind: 'attachment', src: url.href, fromThreadRootId: rootId }) }}>
            <ThreadPane org={org} space={space} rootMessageId={rootId} rootFromStream={item?.root} topicFromStream={item?.topic ?? undefined}
                changeSets={feed.changeSets} entries={entries} presence={presence} memberNames={names} refreshTick={refreshTick}
                showBack={showBack} onBack={onClose} listLabel="Threads" expanded={expanded} onToggleExpanded={onToggleExpanded}
                onOpenFile={openFile} onOpenSession={onOpenSession} onOpenThread={(id) => onOpenThread(space.id, id)}
                artifactsRailOpen={artifactsOpen} onToggleArtifactsRail={() => setArtifactsOpen((v) => !v)} visible={active} />
        </SpaceNavProvider></SpaceAssetsProvider></SpaceInvocationsProvider></SpaceRefsProvider></MemberAdminProvider></SpaceProfilesProvider></SpaceMembersProvider>
    </SpaceAccessContext.Provider>
}
