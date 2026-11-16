import { Bell, CreditCard, Download, LogOut } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { SpacesAccountMenu } from '@/components/spaces/account-menu'
import { ACCOUNT_ROW } from '@/lib/spaces-account'
import { Switch } from '@/components/ui/switch'
import { sessionEmail, signOut } from './account'
import { analyticsSignedOut } from './analytics'
import { ACCOUNT_URL, DEV_HARBOR } from './config'
import { notificationState, subscribeNotificationState, turnOffNotifications, turnOnNotifications } from './notifications'

// The web app's account (2026-10-13): first a slim rail beside Spaces, as
// Slack's web client has; since 2026-11-09 the row at the foot of the one
// sidebar, the rail gone. The menu itself is shared with the desktop
// (components/spaces/account-menu.tsx); the rows here are the web's own.

const DOWNLOAD_URL = 'https://github.com/rowboatlabs/rowboat/releases/latest'

/** The switch for notifications.ts: turning it on asks the browser the first time. */
function NotificationsRow() {
    const state = useSyncExternalStore(subscribeNotificationState, notificationState)
    if (state === 'unsupported') return null
    return (
        <div className="px-2 py-1.5">
            <div className="flex items-center gap-2 text-sm">
                <Bell className="size-4 text-muted-foreground" />
                <span className="flex-1">Browser notifications</span>
                <Switch
                    aria-label="Browser notifications"
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

export function WebAccount() {
    return (
            <SpacesAccountMenu email={sessionEmail()} variant="row">
                <NotificationsRow />
                {/* Plan and credits (2026-11-04): agents Rowboat runs bill to them, and the web app has no settings of its
                    own yet, so this opens the account app, the same page the desktop's "Manage" and an agent's Upgrade open. */}
                <a href={ACCOUNT_URL} target="_blank" rel="noreferrer" className={ACCOUNT_ROW}>
                    <CreditCard className="size-4 text-muted-foreground" /> Plan &amp; usage
                </a>
                <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer" className={ACCOUNT_ROW}>
                    <Download className="size-4 text-muted-foreground" /> Get the desktop app
                </a>
                {/* A dev Harbor has no session to end. */}
                {!DEV_HARBOR && (
                    <button type="button" onClick={() => { analyticsSignedOut(); signOut() }} className={ACCOUNT_ROW}>
                        <LogOut className="size-4 text-muted-foreground" /> Sign out
                    </button>
                )}
            </SpacesAccountMenu>
    )
}
