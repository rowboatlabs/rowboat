import { useEffect, useState } from 'react'

// A background socket carries notifications, not human presence (2026-11-04, correction to #1309).
export function useFocusedPresence(orgId: string | undefined, active: boolean): void {
    const [sessionId] = useState(() => crypto.randomUUID())
    useEffect(() => {
        if (!orgId || !active) return
        const send = (focused: boolean) => {
            void window.ipc.invoke('spaces:memberActivity', { orgId, sessionId, active: focused }).catch(() => {})
        }
        let pageVisible = true
        const sync = () => send(pageVisible && document.visibilityState === 'visible' && document.hasFocus())
        const hide = () => { pageVisible = false; send(false) }
        const show = () => { pageVisible = true; sync() }
        const away = () => send(false)
        sync()
        const timer = setInterval(sync, 20_000)
        window.addEventListener('focus', sync)
        window.addEventListener('blur', away)
        window.addEventListener('pageshow', show)
        window.addEventListener('pagehide', hide)
        document.addEventListener('visibilitychange', sync)
        return () => {
            clearInterval(timer)
            window.removeEventListener('focus', sync)
            window.removeEventListener('blur', away)
            window.removeEventListener('pageshow', show)
            window.removeEventListener('pagehide', hide)
            document.removeEventListener('visibilitychange', sync)
            away()
        }
    }, [orgId, active, sessionId])
}
