import { useEffect, useRef, useState } from 'react'
import { Check, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { refreshSpacesOrgs } from '@/hooks/use-spaces'
import * as analytics from '@/lib/analytics'

export function suggestedSpaceName(token: string | null): string {
  try {
    const payload = token?.split('.')[1]
    if (!payload) return 'My space'
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64), c => c.charCodeAt(0))))
    const name = [claims.given_name, claims.name].find(value => typeof value === 'string' && value.trim())
    const email = typeof claims.email === 'string' ? claims.email : ''
    const first = (name?.trim().split(/\s+/)[0] || email.split('@')[0].split(/[._+\-]/)[0] || '').trim()
    return first ? `${first[0].toLocaleUpperCase()}${first.slice(1)}'s space` : 'My space'
  } catch {
    return 'My space'
  }
}

/** The space this person lands in: the one they name here, or the one an
 *  invite already put them in. */
export type OnboardingOrg = { id: string; name: string }

export function useCompletionSpace(enabled: boolean) {
  const [loading, setLoading] = useState(enabled)
  const [needed, setNeeded] = useState(false)
  const [org, setOrg] = useState<OnboardingOrg | null>(null)
  const [name, setName] = useState('My space')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const created = useRef<{ org: OnboardingOrg; createdHere: boolean } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void Promise.all([
      window.ipc.invoke('spaces:listOrgs', null),
      window.ipc.invoke('account:getRowboat', null),
    ]).then(([{ orgs }, account]) => {
      if (cancelled) return
      setNeeded(account.signedIn && orgs.length === 0)
      setOrg(orgs[0] ?? null)
      setName(suggestedSpaceName(account.accessToken))
    }).catch(() => {
      if (!cancelled) setError('Could not check your spaces. Please try again.')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [enabled, attempt])

  /** Creates the space when one is needed, then hands over the org and
   *  whether it was made here (only its maker is sure to be able to invite). */
  const complete = async (onComplete: (org: OnboardingOrg | null, createdHere: boolean) => void) => {
    if (inFlight.current || loading || (needed && !name.trim())) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      if (needed && !created.current) {
        // Recheck in case an invite was accepted while onboarding was open.
        const { orgs } = await window.ipc.invoke('spaces:listOrgs', null)
        if (orgs.length === 0) {
          const result = await window.ipc.invoke('spaces:createOrg', { name: name.trim() })
          analytics.spacesServerCreated()
          created.current = { org: { id: result.org.id, name: result.org.name }, createdHere: true }
        } else {
          created.current = { org: orgs[0], createdHere: false }
        }
        setOrg(created.current.org)
        await refreshSpacesOrgs()
      }
      onComplete(created.current?.org ?? org, created.current?.createdHere ?? false)
    } catch {
      setError('Could not create your space. Please try again.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return { loading, needed, org, name, setName, error, busy, complete, retry: () => setAttempt(value => value + 1) }
}

export function CompletionSpaceName({ name, onChange, disabled }: {
  name: string
  onChange: (name: string) => void
  disabled: boolean
}) {
  const [editing, setEditing] = useState(false)
  return (
    <div className="w-full max-w-sm mb-6">
      <div className="flex items-center justify-center gap-2 mb-3">
        {editing ? (
          <Input
            aria-label="Space name"
            autoFocus
            value={name}
            disabled={disabled}
            onChange={event => onChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && name.trim()) setEditing(false)
            }}
          />
        ) : <p className="min-w-0 break-words text-lg font-semibold">{name}</p>}
        <Button
          variant="ghost"
          size="icon"
          aria-label={editing ? 'Save space name' : 'Edit space name'}
          disabled={disabled || (editing && !name.trim())}
          onClick={() => setEditing(value => !value)}
          className="shrink-0"
        >
          {editing ? <Check className="size-4" /> : <Pencil className="size-4" />}
        </Button>
      </div>
    </div>
  )
}
