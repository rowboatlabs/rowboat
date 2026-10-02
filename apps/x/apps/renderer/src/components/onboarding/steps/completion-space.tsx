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

export function useCompletionSpace(enabled: boolean) {
  const [loading, setLoading] = useState(enabled)
  const [needed, setNeeded] = useState(false)
  const [name, setName] = useState('My space')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const created = useRef(false)
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
      setName(suggestedSpaceName(account.accessToken))
    }).catch(() => {
      if (!cancelled) setError('Could not check your spaces. Please try again.')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [enabled, attempt])

  const complete = async (onComplete: () => void) => {
    if (inFlight.current || loading || (needed && !name.trim())) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      if (needed && !created.current) {
        // Recheck in case an invite was accepted while onboarding was open.
        const { orgs } = await window.ipc.invoke('spaces:listOrgs', null)
        if (orgs.length === 0) {
          await window.ipc.invoke('spaces:createOrg', { name: name.trim() })
          analytics.spacesServerCreated()
        }
        created.current = true
        await refreshSpacesOrgs()
      }
      onComplete()
    } catch {
      setError('Could not create your space. Please try again.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return { loading, needed, name, setName, error, busy, complete, retry: () => setAttempt(value => value + 1) }
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
      <p className="text-sm text-muted-foreground leading-relaxed">
        Invite teammates to your space, or join an existing one. You can always rename this space later.
      </p>
    </div>
  )
}
