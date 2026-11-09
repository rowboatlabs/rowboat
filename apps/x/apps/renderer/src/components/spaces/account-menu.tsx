import { AvailabilityMenu } from '@/components/spaces/availability-menu'
import { useState, type ReactNode } from 'react'
import type { spaces } from '@x/shared'
import { ProfileSettings } from '@/components/spaces/profile-settings'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useOrgRosters } from '@/hooks/use-space-members'
import { useProfileImage } from '@/hooks/use-profile-image'
import { useSpacesOrgs } from '@/hooks/use-spaces'
import { ACCOUNT_ROW } from '@/lib/spaces-account'
import { avatarColorClass, initials } from '@/lib/spaces-presentation'
import { cn } from '@/lib/utils'

// Your Spaces account, at the foot of the Spaces rail: who you are, your
// role on each server, and your profile. The web app's rail had it first
// (2026-10-13); the desktop's Spaces mode shares it (2026-11-09). Each host
// adds its own rows below, the things only it can do.

/** Your member record on each server: name and role are per server (spec §4). */
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

export function SpacesAccountMenu({ email, children }: { email: string | null; children?: ReactNode }) {
    const { orgs } = useSpacesOrgs()
    const [editing, setEditing] = useState(false)
    const members = useMyMembers()
    const me = orgs.map((org) => members.get(org.id)).find((member) => member !== undefined)
    const profileOrg = orgs.find(org => members.get(org.id) === me)
    const name = me?.displayName ?? email?.split('@')[0] ?? 'You'
    const faceId = me?.id ?? email ?? 'you'
    return (
        <>
            <Popover>
                <PopoverTrigger asChild>
                    <button type="button" aria-label="Your account" title={name} className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <Face id={faceId} name={name} orgId={profileOrg?.id} avatarUrl={me?.avatarUrl} />
                    </button>
                </PopoverTrigger>
                <PopoverContent side="right" align="end" sideOffset={10} className="max-h-[var(--radix-popover-content-available-height)] w-72 overflow-y-auto p-0">
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
                            <div className="pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Servers</div>
                            {orgs.map((org) => {
                                const role = members.get(org.id)?.role
                                return (
                                    <div key={org.id} className="flex items-center justify-between gap-2 py-1 text-sm">
                                        <span className="truncate">{org.name}</span>
                                        {role && <span className="shrink-0 text-xs text-muted-foreground">{role === 'admin' ? 'Admin' : 'Member'}</span>}
                                    </div>
                                )
                            })}
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
