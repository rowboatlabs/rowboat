// One activity reporter per renderer (2026-11-11, shared Online/Away status).
// Switching apps preserves recent activity; only inactivity or closing clears it.
export function startActivityReporter(orgIds: () => string[], send: (orgId: string, active: boolean) => void) {
    let lastInput: number | null = document.visibilityState === 'visible' ? Date.now() : null
    let lastSent = 0
    let lastActive = false
    const publish = () => {
        lastActive = lastInput !== null && Date.now() - lastInput < 10 * 60_000
        for (const orgId of orgIds()) send(orgId, lastActive)
        lastSent = Date.now()
    }
    const input = () => {
        lastInput = Date.now()
        if (!lastActive || Date.now() - lastSent >= 15_000) publish()
    }
    const focus = () => { if (document.visibilityState === 'visible') input() }
    const away = () => { lastInput = null; publish() }
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const
    for (const event of events) window.addEventListener(event, input, { passive: true })
    window.addEventListener('focus', focus)
    window.addEventListener('pagehide', away)
    document.addEventListener('visibilitychange', focus)
    const interval = setInterval(publish, 15_000)
    publish()
    return () => {
        clearInterval(interval)
        for (const event of events) window.removeEventListener(event, input)
        window.removeEventListener('focus', focus)
        window.removeEventListener('pagehide', away)
        document.removeEventListener('visibilitychange', focus)
        away()
    }
}
