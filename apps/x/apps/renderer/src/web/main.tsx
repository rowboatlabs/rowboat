import { StrictMode } from 'react'
import '../index.css'
import { CALLBACK_PATH, completeSignIn } from './account'
import { webChannelHandlers } from './handlers'
import { installBrowserHost } from './host'

// The web app's entry (2026-10-09). The host goes in before any app module
// loads — lib/feature-flags reads window.featureFlags at import — so the app
// itself is a dynamic import. A sign-in callback is finished before the
// first render, so the page never paints signed out on the way in.

async function start() {
    const host = installBrowserHost()
    host.serve(webChannelHandlers((event) => host.emit('spaces:events', event)) as Parameters<typeof host.serve>[0])

    let signInError: string | null = null
    if (window.location.pathname === CALLBACK_PATH) {
        try {
            window.history.replaceState(null, '', await completeSignIn(new URL(window.location.href)))
        } catch (err) {
            window.history.replaceState(null, '', '/')
            signInError = err instanceof Error ? err.message : 'Sign-in failed.'
        }
    }

    const [{ createRoot }, { ThemeProvider }, { WebApp }, { toast }] = await Promise.all([
        import('react-dom/client'),
        import('@/contexts/theme-context'),
        import('./app'),
        import('@/lib/toast'),
    ])
    createRoot(document.getElementById('root')!).render(
        <StrictMode>
            <ThemeProvider defaultTheme="system">
                <WebApp />
            </ThemeProvider>
        </StrictMode>,
    )
    if (signInError) toast(signInError, 'error')
}

void start()
