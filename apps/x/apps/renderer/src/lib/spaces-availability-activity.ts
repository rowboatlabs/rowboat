// One foreground reporter per renderer (2026-11-11, unified online status).
// Reading without input stays online; background connections cannot renew it.
export function startActivityReporter(orgIds: () => string[], send: (orgId: string, active: boolean) => void) {
    const publish = () => {
        const active = document.visibilityState === 'visible' && document.hasFocus()
        for (const orgId of orgIds()) send(orgId, active)
    }
    const away = () => { for (const orgId of orgIds()) send(orgId, false) }
    window.addEventListener('focus', publish)
    window.addEventListener('blur', away)
    window.addEventListener('pagehide', away)
    document.addEventListener('visibilitychange', publish)
    const interval = setInterval(publish, 15_000)
    publish()
    return () => {
        clearInterval(interval)
        window.removeEventListener('focus', publish)
        window.removeEventListener('blur', away)
        window.removeEventListener('pagehide', away)
        document.removeEventListener('visibilitychange', publish)
        away()
    }
}
