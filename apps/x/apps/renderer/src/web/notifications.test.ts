import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The web app's notifications (2026-10-15): the org's notify frames, shown
// while the tab isn't focused, behind the browser's permission and a switch.

let deliver: (orgId: string, frame: unknown) => void = () => {}
vi.mock('./orgs', () => ({
    onMemberFrame: (fn: typeof deliver) => {
        deliver = fn
        return () => { deliver = () => {} }
    },
}))

const shown: Array<{ title: string; options: NotificationOptions; instance: { onclick: (() => void) | null; close: () => void } }> = []
class FakeNotification {
    static permission: NotificationPermission = 'default'
    static requestPermission = vi.fn(async () => {
        FakeNotification.permission = 'granted'
        return FakeNotification.permission
    })
    onclick: (() => void) | null = null
    close = vi.fn()
    constructor(title: string, options: NotificationOptions) {
        shown.push({ title, options, instance: this })
    }
}

const frame = { kind: 'notify', spaceId: 'S', threadRootId: 'R', messageId: 'M', reason: 'mention', author: {}, title: 'Gagan in #launch', body: 'ship it?', at: '2026-10-15T00:00:00Z' }

describe('web notifications', () => {
    let focused = true
    beforeEach(() => {
        vi.stubGlobal('Notification', FakeNotification)
        FakeNotification.permission = 'default'
        vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
        focused = true
        shown.length = 0
    })
    afterEach(() => {
        localStorage.clear()
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('ask first, then follow the switch, and say when the browser blocks them', async () => {
        const n = await import('./notifications')
        expect(n.notificationState()).toBe('ask')
        expect(n.shouldPromptForNotifications()).toBe(true)
        expect(await n.turnOnNotifications()).toBe('on')
        expect(n.shouldPromptForNotifications()).toBe(false)
        n.turnOffNotifications()
        expect(n.notificationState()).toBe('off')
        expect(await n.turnOnNotifications()).toBe('on')
        FakeNotification.permission = 'denied'
        expect(n.notificationState()).toBe('blocked')
    })

    it('stop prompting once set aside', async () => {
        const n = await import('./notifications')
        n.dismissNotificationPrompt()
        expect(n.shouldPromptForNotifications()).toBe(false)
        expect(n.notificationState()).toBe('ask')
    })

    it('show a notify frame only while the tab is not focused, one per message, and open it on click', async () => {
        const n = await import('./notifications')
        FakeNotification.permission = 'granted'
        const open = vi.fn()
        const stop = n.startNotifications(open)

        deliver('org-1', frame)
        expect(shown).toHaveLength(0)

        focused = false
        deliver('org-1', { kind: 'space_added' })
        deliver('org-1', frame)
        expect(shown).toHaveLength(1)
        expect(shown[0]!.title).toBe('Gagan in #launch')
        expect(shown[0]!.options).toMatchObject({ body: 'ship it?', tag: 'org-1/M' })

        shown[0]!.instance.onclick!()
        expect(open).toHaveBeenCalledWith('org-1', frame)
        expect(shown[0]!.instance.close).toHaveBeenCalled()

        n.turnOffNotifications()
        deliver('org-1', frame)
        expect(shown).toHaveLength(1)
        stop()
    })
})
