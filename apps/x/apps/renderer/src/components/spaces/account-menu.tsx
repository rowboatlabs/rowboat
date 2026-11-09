import { AvailabilityMenu } from '@/components/spaces/availability-menu'
import { currentStatus } from '@x/shared/dist/spaces.js'
import { MoreHorizontal } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useAvailabilityClock } from '@/hooks/use-availability-clock'
import type { spaces } from '@x/shared'
import { ProfileSettings } from '@/components/spaces/profile-settings'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useOrgRosters } from '@/hooks/use-space-members'
import { useProfileImage } from '@/hooks/use-profile-image'
import { useSpacesOrgs } from '@/hooks/use-spaces'
import { ACCOUNT_ROW } from '@/lib/spaces-account'
import { avatarColorClass, initials } from '@/lib/spaces-presentation'
import { cn } from '@/lib/utils'

// Your Spaces account, at the foot of the Spaces sidebar: who you are, the
// server, and your profile (one server since 2026-11-09, so no roles here).
// Since the same evening the thin rail is gone and the trigger is a full row
// at the sidebar's foot (`variant="row"`); the small face remains for hosts
// that want it. The web app's rail had it first
// (2026-10-13); the desktop's Spaces mode shares it (2026-11-09). Each host
// adds its own rows below, the things only it can do.

/** Your member record on the server (spec §4). */
function useMyMembers(): Map<string, spaces.Member> {
    const { orgs } = useSpacesOrgs()
    const rosters = useOrgRosters(orgs.map(org => ({ id: org.id, spaceIds: org.spaces.map(s => s.id) })))
    const members = new Map<string, spaces.Member>()
    for (const org of orgs) {
        const member = rosters.get(org.id)?.find(m => m.id === org.memberId)
        if (member) members.set(org.id, member)
    }
    return members
}

/** A person's tile: the stream's near-square, initials on the member's color. */
function Face({ id, name, large, orgId, avatarUrl }: { id: string; name: string; large?: boolean; orgId?: string; avatarUrl?: string }) {
    const src = useProfileImage(orgId, avatarUrl)
    const [failed, setFailed] = useState<string>()
    return (
        <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center rounded-md font-semibold leading-none select-none', large ? 'size-9 text-[13px]' : 'size-8 text-xs', avatarColorClass(id))}>
            {src && failed !== src ? <img src={src} alt="" className="size-full rounded-md object-cover" onError={() => setFailed(src)} /> : initials(name)}
        </span>
    )
}

export function SpacesAccountMenu({ email, children, variant = 'face' }: { email: string | null; children?: ReactNode; variant?: 'face' | 'row' }) {
    const { orgs } = useSpacesOrgs()
    const [editing, setEditing] = useState(false)
    const members = useMyMembers()
    const me = orgs.map((org) => members.get(org.id)).find((member) => member !== undefined)
    const profileOrg = orgs.find(org => members.get(org.id) === me)
    const name = me?.displayName ?? email?.split('@')[0] ?? 'You'
    const faceId = me?.id ?? email ?? 'you'
    const now = useAvailabilityClock()
    const status = currentStatus(me?.availability, now)
    const presence = me?.availability?.manualAway ? 'Away' : 'Active'
    return (
        <>
            <Popover>
                <PopoverTrigger asChild>
                    {variant === 'row' ? (
                        <button type="button" aria-label="Your account" title={name}
                            className="flex h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <Face id={faceId} name={name} orgId={profileOrg?.id} avatarUrl={me?.avatarUrl} />
                            <span className="flex min-w-0 flex-1 flex-col leading-tight">
                                <span className="truncate text-[13px] font-semibold">{name}</span>
                                <span className="truncate text-[11px] text-muted-foreground">{status ? `${status.emoji || '💬'} ${status.text}` : `${presence} · set a status`}</span>
                            </span>
                            <MoreHorizontal className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        </button>
                    ) : (
                        <button type="button" aria-label="Your account" title={name} className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <Face id={faceId} name={name} orgId={profileOrg?.id} avatarUrl={me?.avatarUrl} />
                        </button>
                    )}
                </PopoverTrigger>
                <PopoverContent side={variant === 'row' ? 'top' : 'right'} align={variant === 'row' ? 'start' : 'end'} sideOffset={10} className="max-h-[var(--radix-popover-content-available-height)] w-72 overflow-y-auto p-0">
                    <div className="flex items-center gap-3 p-3">
                        <Face id={faceId} name={name} orgId={profileOrg?.id} avatarUrl={me?.avatarUrl} large />
                        <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{name}</div>
                            {email && <div className="truncate text-xs text-muted-foreground">{email}</div>}
                        </div>
                    </div>
                    <AvailabilityMenu />
                    {orgs.length > 0 && (
                        <div className="border-t border-border px-3 py-2">
                            <div className="pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Server</div>
                            {orgs.map((org) => (
                                <div key={org.id} className="flex items-center justify-between gap-2 py-1 text-sm">
                                    <span className="truncate">{org.name}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="border-t border-border p-1">
                        <button type="button" className={ACCOUNT_ROW} onClick={() => setEditing(true)}>Edit Spaces profile</button>
                        {children}
                    </div>
                </PopoverContent>
            </Popover>
            {editing && <ProfileSettings onClose={() => setEditing(false)} />}
        </>
    )
}
