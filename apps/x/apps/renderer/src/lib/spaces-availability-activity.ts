// One activity reporter per renderer (2026-11-05). Heartbeats carry activity,
// not merely connectivity, and stop when the last Spaces consumer leaves.
export function startActivityReporter(orgIds: () => string[], send: (orgId: string, active: boolean) => void) {
    let lastInput = document.visibilityState === 'visible' ? Date.now() : 0
    let lastSent = 0
    const publish = () => {
        const active = Date.now() - lastInput < 10 * 60_000
        for (const orgId of orgIds()) send(orgId, active)
        lastSent = Date.now()
    }
    const input = () => { lastInput = Date.now(); if (Date.now() - lastSent >= 15_000) publish() }
    const focus = () => { if (document.visibilityState === 'visible') { lastInput = Date.now(); publish() } }
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const
    for (const event of events) window.addEventListener(event, input, { passive: true })
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    const interval = setInterval(publish, 15_000)
    publish()
    return () => {
        clearInterval(interval)
        for (const event of events) window.removeEventListener(event, input)
        window.removeEventListener('focus', focus)
        document.removeEventListener('visibilitychange', focus)
        for (const orgId of orgIds()) send(orgId, false)
    }
}
