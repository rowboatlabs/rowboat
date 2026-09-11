import { useCallback, useEffect, useState } from 'react'
import type { z } from 'zod'
import type { OpenCodeEngineStatus } from '@x/shared/dist/code-mode'
import { Button } from '@/components/ui/button'
import { startProvisioning, useProvisioning } from '@/lib/code-mode-provisioning'
import { OpenCodeProviderSetup } from './opencode-provider-setup'

export function OpenCodeEngineSettings({ active }: { active: boolean }) {
  const [status, setStatus] = useState<z.infer<typeof OpenCodeEngineStatus> | null>(null)
  const [error, setError] = useState<string>()
  const [removing, setRemoving] = useState(false)
  const [setup, setSetup] = useState(false)
  const progress = useProvisioning('opencode')
  const busy = removing || !!(progress && !progress.error)
  const refresh = useCallback(async () => {
    try {
      setStatus(await window.ipc.invoke('codeMode:openCodeEngineStatus', null))
      window.dispatchEvent(new Event('opencode-configuration-changed'))
      setError(undefined)
    } catch { setError('Could not check OpenCode installation. Re-check to try again.') }
  }, [])
  useEffect(() => { if (active) void refresh() }, [active, refresh])
  useEffect(() => { if (!active) setSetup(false) }, [active])
  const remove = async () => {
    setSetup(false)
    setRemoving(true)
    try {
      const result = await window.ipc.invoke('codeMode:removeOpenCodeEngine', null)
      if (!result.success) setError(result.error)
      else await refresh()
    } catch { setError('Could not remove OpenCode. Try again.') }
    finally { setRemoving(false) }
  }
  return <div className="rounded-md border px-3 py-2.5 space-y-2">
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium">OpenCode{status?.installed ? ` ${status.version}` : ''}</span>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void refresh()}>Re-check</Button>
        {status?.installed
          ? <Button variant="outline" size="sm" disabled={busy} onClick={() => void remove()}>Remove engine</Button>
          : <Button variant="outline" size="sm" disabled={busy || !status?.supported} onClick={() => startProvisioning('opencode', refresh)}>{progress?.error ? 'Retry' : 'Enable'}</Button>}
      </div>
    </div>
    <p className="text-xs text-muted-foreground" role="status">
      {busy ? (removing ? 'Removing engine…' : `${progress?.phase ?? 'Preparing'}${progress?.pct != null && progress.phase === 'download' ? ` ${progress.pct}%` : ''}…`)
        : !status ? 'Checking installation…'
        : !status.supported ? 'No managed engine package is available for this platform.'
        : status.installed ? 'Installed. Choose a free model in Code mode, or optionally connect Go / Zen.' : 'Not installed'}
    </p>
    {status?.installed && <p className="text-xs text-muted-foreground">Removing the engine keeps provider credentials and conversations.</p>}
    {status?.installed && !setup && <Button size="sm" variant="outline" disabled={busy} onClick={() => setSetup(true)}>Connect Go / Zen (optional)</Button>}
    {status?.installed && setup && active && <OpenCodeProviderSetup onClose={() => setSetup(false)} />}
    {(error || progress?.error) && <p role="alert" className="text-xs text-destructive">{error || progress?.error}</p>}
  </div>
}
