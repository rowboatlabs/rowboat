import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { openServerDialog } from '@/lib/server-dialog'
import { beginSignIn } from './account'

// The web app signed out (2026-10-13): a sign-in page, not the desktop's
// empty Spaces pane. Signing in returns to the address it started from, so
// a bookmarked space opens once you're in. An invite opens its card first
// and signs in from there (links.ts).

export function SignedOut() {
    const [busy, setBusy] = useState(false)
    const signIn = () => {
        setBusy(true)
        beginSignIn(`${window.location.pathname}${window.location.search}`).catch((err: unknown) => {
            setBusy(false)
            toast.error(err instanceof Error ? err.message : 'Sign-in failed.')
        })
    }
    return (
        <main className="flex h-svh flex-1 items-center justify-center p-8">
            <div className="w-full max-w-xs text-center">
                <img src="/logo-only.png" alt="" className="mx-auto size-10 rounded-lg" />
                <h1 className="mt-5 text-xl font-semibold tracking-tight">Rowboat Spaces</h1>
                <p className="mt-2 text-sm text-muted-foreground">Sign in with your Rowboat account to see your spaces.</p>
                <Button className="mt-6 w-full" onClick={signIn} disabled={busy}>
                    Sign in with Rowboat
                </Button>
                <p className="mt-3 text-xs text-muted-foreground">New to Rowboat? Signing in creates your account.</p>
                <button type="button" className="mt-4 text-xs text-muted-foreground hover:underline" onClick={() => openServerDialog({ kind: 'join' })}>
                    Have an invite link?
                </button>
            </div>
        </main>
    )
}
