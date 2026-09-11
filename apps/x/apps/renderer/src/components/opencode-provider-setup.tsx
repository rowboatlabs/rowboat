import { useEffect, useRef, useState } from 'react'
import type { OpenCodeSetupState } from '@x/shared/dist/opencode-setup'
import { Button } from '@/components/ui/button'

type Result = { success: true; data: OpenCodeSetupState } | { success: false; error: { message: string } }
export function OpenCodeProviderSetup({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<OpenCodeSetupState>()
  const [providerId, setProviderId] = useState('opencode-go')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const alive = useRef(false)
  const lease = useRef<string | undefined>(undefined)
  const generation = useRef(0)
  const accept = (result: Result) => {
    if (!result.success) { setError(result.error.message); return false }
    setState(result.data)
    lease.current = result.data.setupId
    window.dispatchEvent(new Event('opencode-configuration-changed'))
    return true
  }
  const start = async () => {
    const current = ++generation.current
    setBusy(true); setError(undefined)
    try {
      const result = await window.ipc.invoke('opencodeSetup:start', null)
      if (!alive.current || current !== generation.current) {
        if (result.success) void window.ipc.invoke('opencodeSetup:stop', { setupId: result.data.setupId }).catch(() => {})
        return
      }
      accept(result)
    } catch { if (alive.current && current === generation.current) setError('Could not open account setup. Retry setup.') }
    finally { if (alive.current && current === generation.current) setBusy(false) }
  }
  useEffect(() => {
    alive.current = true
    void start()
    return () => {
      alive.current = false; generation.current++
      if (lease.current) void window.ipc.invoke('opencodeSetup:stop', { setupId: lease.current }).catch(() => {})
    }
  }, [])
  const run = async (work: () => Promise<Result>, message: string) => {
    const current = ++generation.current
    setBusy(true); setError(undefined); setNotice(undefined)
    try {
      const result = await work()
      if (alive.current && current === generation.current && accept(result)) setNotice(message)
    } catch { if (alive.current && current === generation.current) setError('Account setup was interrupted. Close and reopen it to retry.') }
    finally { if (alive.current && current === generation.current) setBusy(false) }
  }
  const provider = state?.providers.find(p => p.id === providerId)
  const method = provider?.methods.find(m => m.type === 'api' && m.supported)
  return <section className="space-y-3 border-t pt-3" aria-label="OpenCode account setup">
    <div className="flex items-center justify-between"><span className="text-sm font-medium">Go / Zen account (optional)</span><Button variant="ghost" size="sm" onClick={onClose}>Close setup</Button></div>
    <p className="text-xs text-muted-foreground">Free models work without an account. Choose your model in Code mode. Connect Go for subscription models or Zen for pay-as-you-go models.</p>
    <Button variant="outline" size="sm" onClick={async () => {
      try {
        const result = await window.ipc.invoke('opencodeSetup:openAccount', null)
        if (alive.current && !result.success) setError(result.error.message)
      } catch { if (alive.current) setError('Could not open your browser. Visit opencode.ai/auth to get your account key.') }
    }}>Open OpenCode account</Button>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {notice && <p role="status" className="text-xs">{notice}</p>}
    {!state ? <>{busy ? <p role="status">Opening account setup...</p> : <Button size="sm" onClick={() => void start()}>Retry setup</Button>}</> : <>
      <label className="block text-xs">Account access
        <select aria-label="Account access" disabled={busy} value={providerId} className="w-full rounded-md border bg-background p-2" onChange={e => { setProviderId(e.target.value); setKey(''); setNotice(undefined); setError(undefined) }}>
          <option value="opencode-go">OpenCode Go - subscription</option>
          <option value="opencode">OpenCode Zen - pay as you go</option>
        </select>
      </label>
      {provider?.connected && <p className="text-xs">Account key saved. Model access is checked when you send a coding request.</p>}
      <input aria-label="OpenCode account API key" type="password" autoComplete="off" spellCheck={false} value={key} disabled={busy} onChange={e => setKey(e.target.value)} placeholder="Paste your OpenCode account API key" className="w-full rounded-md border bg-background p-2 text-sm" />
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !key.trim() || !method} onClick={() => {
          if (!method) return
          const secret = key; setKey('')
          void run(() => window.ipc.invoke('opencodeSetup:saveKey', { setupId: state.setupId, providerId, method: method.index, key: secret }), 'Account key saved. Choose a model in Code mode.')
        }}>Save account key</Button>
        {provider?.connected && <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => window.ipc.invoke('opencodeSetup:disconnect', { setupId: state.setupId, providerId }), 'Account disconnected. Free models remain available in Code mode.')}>Disconnect</Button>}
      </div>
      {!method && <p className="text-xs">This account option is currently unavailable. Close and reopen setup to refresh.</p>}
      {busy && <p role="status" className="text-xs">Working...</p>}
    </>}
  </section>
}
