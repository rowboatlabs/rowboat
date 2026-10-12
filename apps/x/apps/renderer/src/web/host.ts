import { ipc } from '@x/shared'

// The browser's stand-in for the Electron preload (2026-10-09, the Spaces web
// app): the same window.ipc contract, served in the tab. A request is
// validated against the channel's schema exactly as the preload validates it;
// a channel the browser does not serve is refused by name, once logged, so a
// desktop-only call fails the way an IPC failure already does.

type Handler = (args: unknown) => Promise<unknown>

export interface BrowserHost {
    /** Deliver a push-channel event to the page's listeners (window.ipc.on). */
    emit(channel: string, payload: unknown): void
    /** The channels the tab answers; everything else is refused. */
    serve(handlers: Record<string, Handler | undefined>): void
}

export function installBrowserHost(): BrowserHost {
    let handlers: Record<string, Handler | undefined> = {}
    const listeners = new Map<string, Set<(payload: unknown) => void>>()
    const refused = new Set<string>()
    const refuse = (channel: string) => {
        if (!refused.has(channel)) {
            refused.add(channel)
            console.info(`[web] ${channel} is not served in the browser`)
        }
        return new Error(`${channel} isn't available in the browser.`)
    }

    window.ipc = {
        async invoke(channel, args) {
            const handler = handlers[channel]
            if (!handler) throw refuse(channel)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (await handler(ipc.validateRequest(channel, args))) as any
        },
        send(channel) {
            refuse(channel)
        },
        on(channel, handler) {
            const set = listeners.get(channel) ?? new Set()
            set.add(handler as (payload: unknown) => void)
            listeners.set(channel, set)
            return () => {
                set.delete(handler as (payload: unknown) => void)
            }
        },
    }
    // The page has the bytes of a dropped file, never its path.
    window.electronUtils = { getPathForFile: () => '', getZoomFactor: () => 1 }
    window.featureFlags = { spaces: true, localRuntime: false }

    return {
        emit(channel, payload) {
            for (const listener of listeners.get(channel) ?? []) listener(payload)
        },
        serve(next) {
            handlers = next
        },
    }
}
