import { Bell } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { dismissNotificationPrompt, shouldPromptForNotifications, subscribeNotificationState, turnOnNotifications } from './notifications'

// The one-time question across the top (2026-10-15), Slack's: a browser asks
// for notification permission only after a click, so the app offers it here.
// Answered either way, or set aside, it doesn't come back; the account menu
// keeps the switch.

export function NotificationsPrompt() {
    const show = useSyncExternalStore(subscribeNotificationState, shouldPromptForNotifications)
    if (!show) return null
    return (
        <div role="region" aria-label="Notifications" className="flex shrink-0 items-center justify-center gap-3 border-b border-border bg-[var(--rowboat-panel-soft)] px-4 py-1.5 text-sm">
            <Bell className="size-4 text-muted-foreground" />
            <span>Get notified about mentions and direct messages.</span>
            <Button size="sm" className="h-7" onClick={() => void turnOnNotifications()}>Turn on</Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={dismissNotificationPrompt}>Not now</Button>
        </div>
    )
}
