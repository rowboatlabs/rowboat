import { useCallback, useEffect, useState } from 'react'
import { CreditCard, LogIn, LogOut, Settings } from 'lucide-react'
import { toast } from 'sonner'
import { Keys } from '@/components/keys'
import { SpacesAccountMenu } from '@/components/spaces/account-menu'
import { useRowboatConfig } from '@/hooks/use-rowboat-config'
import { ACCOUNT_ROW, tokenEmail } from '@/lib/spaces-account'
import { SHORTCUTS } from '@/lib/shortcuts'

/** Your Rowboat sign-in, kept current as you sign in and out. */
function useRowboatEmail(): { signedIn: boolean; email: string | null; refresh: () => void } {
  const [account, setAccount] = useState<{ signedIn: boolean; email: string | null }>({ signedIn: false, email: null })
  const refresh = useCallback(() => {
    void window.ipc.invoke('account:getRowboat', null)
      .then((a) => setAccount({ signedIn: a.signedIn, email: tokenEmail(a.accessToken) }))
      .catch(() => {})
  }, [])
  useEffect(() => {
    refresh()
    return window.ipc.on('oauth:didConnect', ({ provider }) => { if (provider === 'rowboat') refresh() })
  }, [refresh])
  return { ...account, refresh }
}

/**
 * Your Spaces account on the desktop (2026-11-09): the row at the foot of the
 * Spaces sidebar, where the thin mode rail of 2026-11-06 used to stand with
 * the logo and this menu — the rail went the same evening, the logo moved to
 * the sidebar's head. The rows under the shared menu are the desktop's: the
 * web's notification switch and download link have no meaning here, and
 * Settings is how Local's things stay one click away.
 */
export function SpacesAccount({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { signedIn, email, refresh } = useRowboatEmail()
  const appUrl = useRowboatConfig()?.appUrl ?? null
  const signIn = () => void window.ipc.invoke('oauth:connect', { provider: 'rowboat' })
    .then((r) => { if (!r.success) toast.error(r.error || 'Failed to sign in to Rowboat') })
    .catch(() => toast.error('Failed to sign in to Rowboat'))
  const signOut = () => void window.ipc.invoke('oauth:disconnect', { provider: 'rowboat' })
    .then((r) => { if (r.success) { refresh(); toast.success('Signed out of Rowboat') } else toast.error('Failed to sign out of Rowboat') })
    .catch(() => toast.error('Failed to sign out of Rowboat'))
  return (
      <SpacesAccountMenu email={email} variant="row">
        {/* The account app's plan page, as Local's account menu opens it. */}
        {signedIn && appUrl && (
          <a href={`${appUrl}?intent=upgrade`} target="_blank" rel="noreferrer" className={ACCOUNT_ROW}>
            <CreditCard className="size-4 text-muted-foreground" /> Plan &amp; usage
          </a>
        )}
        <button type="button" onClick={onOpenSettings} className={ACCOUNT_ROW}>
          <Settings className="size-4 text-muted-foreground" /> Settings
          <Keys keys={SHORTCUTS.settings} className="ml-auto" />
        </button>
        {signedIn ? (
          <button type="button" onClick={signOut} className={ACCOUNT_ROW}>
            <LogOut className="size-4 text-muted-foreground" /> Sign out
          </button>
        ) : (
          <button type="button" onClick={signIn} className={ACCOUNT_ROW}>
            <LogIn className="size-4 text-muted-foreground" /> Sign in to Rowboat
          </button>
        )}
      </SpacesAccountMenu>
  )
}
