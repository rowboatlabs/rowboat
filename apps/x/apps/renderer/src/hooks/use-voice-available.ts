import { useEffect, useState } from 'react'

/**
 * Whether voice input (push-to-talk STT) is configured: a local Deepgram key
 * or a connected Rowboat account. The same probe App runs for the assistant
 * composer's mic button, re-checked when sign-in state changes.
 */
export function useVoiceInputAvailable(): boolean {
    const [available, setAvailable] = useState(false)
    useEffect(() => {
        let disposed = false
        const probe = () => {
            void Promise.all([
                window.ipc.invoke('voice:getConfig', null),
                window.ipc.invoke('oauth:getState', null),
            ]).then(([config, oauthState]) => {
                if (disposed) return
                const rowboatConnected = oauthState.config?.rowboat?.connected ?? false
                setAvailable(!!config.deepgram || rowboatConnected)
            }).catch(() => {
                if (!disposed) setAvailable(false)
            })
        }
        probe()
        const off = window.ipc.on('oauth:didConnect', probe)
        return () => {
            disposed = true
            off()
        }
    }, [])
    return available
}
