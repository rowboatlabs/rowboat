// First: the flags every later import reads as it loads (flags.ts).
import './flags'
import { StrictMode } from 'react'
import '../index.css'
// The theme (tokens, dark mode, base styles) lives in App.css, which the
// desktop's App.tsx imports; the web app never loads App.tsx.
import '../App.css'
import { CALLBACK_PATH, completeSignIn } from './account'
import { webChannelHandlers } from './handlers'
import { installBrowserHost } from './host'
import { captureOpenLink, forgetJoinClick } from './links'

// The web app's entry (2026-10-09). The flags go in first (flags.ts), the host
// before the app, which is a dynamic import. A sign-in callback is finished
// before the first render, so the page never paints signed out on the way in,
// and a shared link (/open, links.ts) is put aside after it, since a sign-in
// can return there.

async function start() {
    const host = installBrowserHost()
    host.serve(webChannelHandlers((event) => host.emit('spaces:events', event)) as Parameters<typeof host.serve>[0])

    let signInError: string | null = null
    if (window.location.pathname === CALLBACK_PATH) {
        try {
            window.history.replaceState(null, '', await completeSignIn(new URL(window.location.href)))
        } catch (err) {
            window.history.replaceState(null, '', '/')
            forgetJoinClick()
            signInError = err instanceof Error ? err.message : 'Sign-in failed.'
        }
    }
    captureOpenLink()

    const [{ createRoot }, { ThemeProvider }, { WebApp }] = await Promise.all([
        import('react-dom/client'),
        import('@/contexts/theme-context'),
        import('./app'),
    ])
    createRoot(document.getElementById('root')!).render(
        <StrictMode>
            <ThemeProvider defaultTheme="system">
                <WebApp signInError={signInError} />
            </ThemeProvider>
        </StrictMode>,
    )
}

void start()
