import type { spaces } from '@x/shared'
import { onMemberFrame } from './orgs'

// The web app's notifications (2026-10-15). The org decides who is told: a
// `notify` frame on the member channel says a message named you, was @here,
// landed in your DM, or replied in a thread you follow (CONTRACT.md). The
// desktop shows those frames as OS notifications while no window is focused
// (core/spaces/notify.ts); this does the same in the browser, while the tab
// isn't focused. Nothing arrives with no tab open: that needs Web Push.
//
// A browser asks for permission only after a click, so the app asks from a
// banner or the account menu, never on load. On top of the browser's
// permission, the person can turn notifications off here.

export type NotifyFrame = Extract<spaces.ServerFrame, { kind: 'notify' }>

/**
 * - `ask`: the browser hasn't been asked yet
 * - `on` / `off`: allowed, and turned on or off here
 * - `blocked`: refused in the browser's site settings, where only the person can undo it
 */
export type NotificationState = 'unsupported' | 'ask' | 'on' | 'off' | 'blocked'

const PREF_KEY = 'rowboat.spaces.web.notifications.v1'
const PROMPT_KEY = 'rowboat.spaces.web.notifications-prompt.v1'

const listeners = new Set<() => void>()
const changed = () => { for (const listener of listeners) listener() }

// A permission changed in the browser's site settings tells no one but this.
let watching = false
function watchPermission(): void {
    if (watching || !navigator.permissions) return
    watching = true
    void navigator.permissions.query({ name: 'notifications' }).then((status) => { status.onchange = changed }, () => {})
}

export function subscribeNotificationState(listener: () => void): () => void {
    watchPermission()
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function notificationState(): NotificationState {
    if (typeof Notification === 'undefined') return 'unsupported'
    if (Notification.permission === 'denied') return 'blocked'
    if (Notification.permission === 'default') return 'ask'
    return localStorage.getItem(PREF_KEY) === 'off' ? 'off' : 'on'
}

/** From a click: asks the browser the first time. */
export async function turnOnNotifications(): Promise<NotificationState> {
    if (typeof Notification === 'undefined') return 'unsupported'
    if (Notification.permission === 'default') await Notification.requestPermission()
    localStorage.removeItem(PREF_KEY)
    changed()
    return notificationState()
}

export function turnOffNotifications(): void {
    localStorage.setItem(PREF_KEY, 'off')
    changed()
}

/** The banner's question, until it's answered or set aside. */
export function shouldPromptForNotifications(): boolean {
    return notificationState() === 'ask' && localStorage.getItem(PROMPT_KEY) === null
}

export function dismissNotificationPrompt(): void {
    localStorage.setItem(PROMPT_KEY, 'dismissed')
    changed()
}

/**
 * Show the org's notify frames while this tab isn't focused. The tag makes a
 * message one notification however many tabs are open. Returns the stop.
 */
export function startNotifications(open: (orgId: string, frame: NotifyFrame) => void): () => void {
    return onMemberFrame((orgId, frame) => {
        if (frame.kind !== 'notify' || notificationState() !== 'on') return
        if (document.visibilityState === 'visible' && document.hasFocus()) return
        const notification = new Notification(frame.title, { body: frame.body, tag: `${orgId}/${frame.messageId}`, icon: '/logo-only.png' })
        notification.onclick = () => {
            window.focus()
            notification.close()
            open(orgId, frame)
        }
    })
}
