import { useEffect, useState } from 'react'
import { ArrowLeft, ExternalLink, Info, RotateCw } from 'lucide-react'
import type { rowboatApp } from '@x/shared'
import { appOpened } from '@/lib/analytics'
import { AppDetail } from '@/components/apps/app-detail'

// Full-height iframe on the app's own origin (spec §6.6). No sandbox attr —
// per-app browser origins are the isolation boundary. Toolbar: back, reload,
// open-in-browser, detail panel.

export function AppFrame({ app, onBack }: { app: rowboatApp.AppSummary; onBack: () => void }) {
  const [reloadNonce, setReloadNonce] = useState(0)
  const [showDetail, setShowDetail] = useState(false)
  // Load watchdog: if the iframe hasn't fired `load` within the deadline,
  // surface a visible retry state instead of a silent blank pane.
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'stuck'>('loading')
  const title = app.manifest?.name ?? app.folder

  useEffect(() => {
    appOpened(app.folder)
  }, [app.folder])

  // Reset the watchdog when the target changes (adjust-during-render pattern).
  const [watchKey, setWatchKey] = useState(`${app.folder}:${reloadNonce}`)
  if (watchKey !== `${app.folder}:${reloadNonce}`) {
    setWatchKey(`${app.folder}:${reloadNonce}`)
    setLoadState('loading')
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoadState((s) => (s === 'loading' ? 'stuck' : s))
    }, 6000)
    return () => window.clearTimeout(timer)
  }, [watchKey])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Apps
        </button>
        <span className="flex-1 truncate text-sm font-medium">{title}</span>
        <button
          type="button"
          title="Reload"
          onClick={() => setReloadNonce((n) => n + 1)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <RotateCw className="size-4" />
        </button>
        <button
          type="button"
          title="Open in browser"
          onClick={() => window.open(app.origin, '_blank')}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ExternalLink className="size-4" />
        </button>
        <button
          type="button"
          title="App details"
          onClick={() => setShowDetail((v) => !v)}
          className={`rounded-md p-1.5 hover:bg-accent hover:text-foreground ${showDetail ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          <Info className="size-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <iframe
            key={reloadNonce}
            title={title}
            src={`${app.origin}/`}
            onLoad={() => setLoadState('ok')}
            className="h-full w-full border-0 bg-background"
          />
          {loadState === 'stuck' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 text-sm">
              <div className="text-muted-foreground">This app is taking too long to load.</div>
              <button
                type="button"
                onClick={() => setReloadNonce((n) => n + 1)}
                className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-accent"
              >
                Retry
              </button>
              <div className="font-mono text-xs text-muted-foreground">{app.origin}</div>
            </div>
          )}
        </div>
        {showDetail && (
          <div className="w-80 shrink-0 border-l border-border">
            <AppDetail folder={app.folder} onClose={() => setShowDetail(false)} />
          </div>
        )}
      </div>
    </div>
  )
}
