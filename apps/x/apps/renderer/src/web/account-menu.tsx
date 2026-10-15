import type { spaces } from '@x/shared'
import { Bell, Download, LogOut } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { useSpacesOrgs } from '@/hooks/use-spaces'
import { avatarColorClass, initials } from '@/lib/spaces-presentation'
import { cn } from '@/lib/utils'
import { sessionEmail, signOut } from './account'
import { DEV_HARBOR } from './config'
import { notificationState, subscribeNotificationState, turnOffNotifications, turnOnNotifications } from './notifications'
import { getClient } from './orgs'

// The web app's own chrome (2026-10-13): a slim rail beside Spaces, as
// Slack's web client has, holding who you are and the way out. The desktop
// keeps its account in its sidebar and Settings, which the web app never
// loads. Photos are left out: no Rowboat surface shows them yet.

const DOWNLOAD_URL = 'https://github.com/rowboatlabs/rowboat/releases/latest'

/** Your member record on each server: name and role are per server (spec §4). */
function useMyMembers(): Map<string, spaces.Member> {
    const { orgs } = useSpacesOrgs()
    const ids = orgs.map((org) => org.id).join(' ')
    const [members, setMembers] = useState(() => new Map<string, spaces.Member>())
    useEffect(() => {
        let cancelled = false
        const orgIds = ids ? ids.split(' ') : []
        void Promise.all(orgIds.map(async (id) => [id, await getClient(id).me().then((r) => r.member, () => null)] as const)).then((rows) => {
            if (cancelled) return
            const found = new Map<string, spaces.Member>()
            for (const [id, member] of rows) if (member) found.set(id, member)
            setMembers(found)
        })
        return () => { cancelled = true }
    }, [ids])
    return members
}

/** A person's tile: the stream's near-square, initials on the member's color. */
function Face({ id, name, large }: { id: string; name: string; large?: boolean }) {
    return (
        <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center rounded-md font-semibold leading-none select-none', large ? 'size-9 text-[13px]' : 'size-8 text-xs', avatarColorClass(id))}>
            {initials(name)}
        </span>
    )
}

const ROW = 'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent'

/** The switch for notifications.ts: turning it on asks the browser the first time. */
function NotificationsRow() {
    const state = useSyncExternalStore(subscribeNotificationState, notificationState)
    if (state === 'unsupported') return null
    return (
        <div className="px-2 py-1.5">
            <div className="flex items-center gap-2 text-sm">
                <Bell className="size-4 text-muted-foreground" />
                <span className="flex-1">Notifications</span>
                <Switch
                    aria-label="Notifications"
                    checked={state === 'on'}
                    disabled={state === 'blocked'}
                    onCheckedChange={(on) => { if (on) void turnOnNotifications(); else turnOffNotifications() }}
                />
            </div>
            {state === 'blocked' && (
                <p className="mt-1 pl-6 text-xs text-muted-foreground">Blocked for this site. Allow notifications in your browser&apos;s site settings.</p>
            )}
        </div>
    )
}

export function WebRail() {
    const { orgs } = useSpacesOrgs()
    const members = useMyMembers()
    const email = sessionEmail()
    const me = orgs.map((org) => members.get(org.id)).find((member) => member !== undefined)
    const name = me?.displayName ?? email?.split('@')[0] ?? 'You'
    const faceId = me?.id ?? email ?? 'you'
    return (
        <nav aria-label="Rowboat" className="flex w-12 shrink-0 flex-col items-center border-r border-border bg-[var(--rowboat-panel-soft)] py-3">
            <a href="/" aria-label="Rowboat Spaces" className="rounded-md">
                <img src="/logo-only.png" alt="" className="size-6 rounded-md" />
            </a>
            <div className="flex-1" />
            <Popover>
                <PopoverTrigger asChild>
                    <button type="button" aria-label="Your account" title={name} className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <Face id={faceId} name={name} />
                    </button>
                </PopoverTrigger>
                <PopoverContent side="right" align="end" sideOffset={10} className="w-72 p-0">
                    <div className="flex items-center gap-3 p-3">
                        <Face id={faceId} name={name} large />
                        <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{name}</div>
                            {email && <div className="truncate text-xs text-muted-foreground">{email}</div>}
                        </div>
                    </div>
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
                        <NotificationsRow />
                        <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer" className={ROW}>
                            <Download className="size-4 text-muted-foreground" /> Get the desktop app
                        </a>
                        {/* A dev Harbor has no session to end. */}
                        {!DEV_HARBOR && (
                            <button type="button" onClick={signOut} className={ROW}>
                                <LogOut className="size-4 text-muted-foreground" /> Sign out
                            </button>
                        )}
                    </div>
                </PopoverContent>
            </Popover>
        </nav>
    )
}
