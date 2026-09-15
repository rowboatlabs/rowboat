import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ExternalLink,
  Info,
  RotateCw,
  UploadCloud,
  Pencil,
  Loader2,
  MessageSquare
} from 'lucide-react'
import type { rowboatApp } from '@x/shared'
import { appOpened } from '@/lib/analytics'
import { appTitle } from './app-icon'
import { getAppHistory, rememberApp } from '@/lib/app-history'
import { AppDetail } from '@/components/apps/app-detail'
import { PublishDialog } from '@/components/apps/publish-dialog'
import type { AppActivity } from './app-activity'

export function AppFrame({
  app,
  activity,
  serverError,
  onBack,
  onEdit,
  onContinue
}: {
  app: rowboatApp.AppSummary
  activity: AppActivity
  serverError?: string | null
  onBack: () => void
  onEdit: (problem?: string) => void
  onContinue?: () => void
}) {
  const [reloadNonce, setReloadNonce] = useState(0)
  const [showDetail, setShowDetail] = useState(false)
  const [showPublish, setShowPublish] = useState(false)
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'stuck'>(
    'loading'
  )
  const [runtimeError, setRuntimeError] = useState<string | null>(
    () => getAppHistory()[app.folder]?.runtimeError ?? null
  )
  const frame = useRef<HTMLIFrameElement>(null)
  const title = appTitle(app.manifest?.name ?? app.folder)
  const agents = activity.tasks.filter((t) => app.agentSlugs.includes(t.slug))
  const running = agents.some((t) => activity.running(t.slug))
  const agentError = agents.map((t) => activity.failure(t)).find(Boolean)
  const blocked =
    app.readiness === 'building' ||
    app.readiness === 'error' ||
    app.status === 'invalid' ||
    !app.hasDist
  const problem =
    serverError ||
    runtimeError ||
    agentError ||
    (blocked || app.readiness === 'setup' ? app.readinessMessage : null)
  const reload = () => {
    setLoadState('loading')
    setRuntimeError(null)
    setReloadNonce((n) => n + 1)
  }
  useEffect(() => {
    appOpened(app.folder)
    rememberApp(app.folder, { openedAt: Date.now() })
  }, [app.folder])
  useEffect(() => {
    if (blocked || loadState !== 'loading') return
    const timer = window.setTimeout(
      () => setLoadState((s) => (s === 'loading' ? 'stuck' : s)),
      10000
    )
    return () => window.clearTimeout(timer)
  }, [reloadNonce, blocked, loadState])
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      // Messages from another app or nested iframe must not affect this frame.
      if (
        event.origin !== app.origin ||
        event.source !== frame.current?.contentWindow
      )
        return
      if (event.data?.type !== 'rowboat:app-health') return
      if (event.data.state === 'loading') {
        setLoadState('loading')
        setRuntimeError(null)
      }
      if (event.data.state === 'loaded') {
        setLoadState('loaded')
        setRuntimeError(null)
        rememberApp(app.folder, { runtimeError: null })
      }
      if (event.data.state === 'error') {
        setLoadState('loaded')
        const message =
          typeof event.data.message === 'string'
            ? event.data.message.slice(0, 1000)
            : 'The app encountered a problem.'
        setRuntimeError(message)
        rememberApp(app.folder, { runtimeError: message })
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [app.origin, app.folder])
  const status = running
    ? 'Updating your data…'
    : agentError
      ? 'Update failed'
      : blocked
        ? app.readiness === 'building'
          ? 'Building your app'
          : 'Needs attention'
        : app.readiness === 'setup'
          ? 'Finish setup'
          : loadState === 'loading'
            ? 'Opening app…'
            : loadState === 'stuck'
              ? 'App did not respond'
              : runtimeError
                ? 'App needs attention'
                : app.dataUpdatedAt
                  ? `Data updated ${new Date(app.dataUpdatedAt).toLocaleString()}`
                  : 'App opened'
  return (
    <div className="flex h-full flex-col">
      <div className="rowboat-header flex shrink-0 items-center gap-2 border-b border-border px-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-accent"
        >
          <ArrowLeft className="size-4" />
          Apps
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {title}
        </span>
        {onContinue && (
          <button
            onClick={onContinue}
            title="Continue the app conversation"
            aria-label="Continue the app conversation"
            className="rounded-md p-2 hover:bg-accent"
          >
            <MessageSquare className="size-4" />
          </button>
        )}
        <button
          onClick={() => onEdit()}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-accent"
        >
          <Pencil className="size-4" />
          Edit app
        </button>
        <button
          title="Reload app"
          aria-label="Reload app"
          onClick={reload}
          className="rounded-md p-2 hover:bg-accent"
        >
          <RotateCw className="size-4" />
        </button>
        <button
          title="Open in browser"
          aria-label="Open in browser"
          onClick={() => window.open(app.origin, '_blank')}
          className="rounded-md p-2 hover:bg-accent"
        >
          <ExternalLink className="size-4" />
        </button>
        {app.kind === 'local' && !blocked && (
          <button
            title={app.publish ? 'Publish update' : 'Publish app'}
            aria-label={app.publish ? 'Publish update' : 'Publish app'}
            onClick={() => setShowPublish(true)}
            className="rounded-md p-2 hover:bg-accent"
          >
            <UploadCloud className="size-4" />
          </button>
        )}
        <button
          title="App details"
          aria-label="App details"
          aria-expanded={showDetail}
          onClick={() => setShowDetail((v) => !v)}
          className="rounded-md p-2 hover:bg-accent"
        >
          <Info className="size-4" />
        </button>
      </div>
      <div
        className="flex flex-wrap items-center gap-3 border-b px-4 py-2 text-xs"
        role="status"
        aria-live="polite"
      >
        {(running || (loadState === 'loading' && !blocked)) && (
          <Loader2 className="size-3.5 animate-spin" />
        )}
        <span className="flex-1">{status}</span>
        {agents.length > 0 && (
          <button
            disabled={running}
            onClick={() => {
              void Promise.all(agents.map((t) => activity.run(t.slug)))
            }}
            className="font-medium underline disabled:opacity-50"
          >
            {running ? 'Updating…' : agentError ? 'Retry update' : 'Update now'}
          </button>
        )}
        {agents.some((t) => !t.active) && (
          <button onClick={() => setShowDetail(true)} className="underline">
            Automatic updates paused · Manage
          </button>
        )}
      </div>
      {(problem || activity.error) && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b bg-amber-500/10 px-4 py-3 text-sm"
        >
          <p className="min-w-0 flex-1 break-words">
            {problem || `Could not check updates: ${activity.error}`}
          </p>
          <button
            className="shrink-0 font-medium underline"
            onClick={() => onEdit(problem || activity.error || undefined)}
          >
            Fix with copilot
          </button>
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {blocked ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
              <Pencil className="size-8 text-muted-foreground" />
              <h2 className="text-lg font-semibold">
                {app.readiness === 'building'
                  ? 'Your app is taking shape'
                  : 'Let’s get this app working'}
              </h2>
              <p className="max-w-md text-sm text-muted-foreground">
                {app.readinessMessage ||
                  app.manifestError ||
                  'The app’s page is not available yet.'}
              </p>
              <div className="flex gap-3">
                {onContinue && (
                  <button
                    onClick={onContinue}
                    className="rounded-lg border px-4 py-2 text-sm"
                  >
                    Continue conversation
                  </button>
                )}
                <button
                  onClick={() =>
                    app.readiness === 'building' && onContinue
                      ? onContinue()
                      : onEdit(app.readinessMessage)
                  }
                  className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground"
                >
                  {app.readiness === 'building'
                    ? 'Continue building'
                    : 'Fix with copilot'}
                </button>
              </div>
              <ol className="mt-4 flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
                <li>1. Connect your data</li>
                <li>2. Build and check the app</li>
                <li>3. Open the working preview</li>
              </ol>
            </div>
          ) : (
            <>
              <iframe
                ref={frame}
                key={reloadNonce}
                title={title}
                src={`${app.origin}/`}
                allow="microphone; autoplay"
                className="h-full w-full border-0 bg-background"
              />
              {(loadState === 'loading' || loadState === 'stuck') && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 p-6 text-center text-sm">
                  {loadState === 'loading' ? (
                    <>
                      <Loader2 className="size-6 animate-spin text-muted-foreground" />
                      <p>Opening {title}…</p>
                    </>
                  ) : (
                    <>
                      <p>
                        {serverError
                          ? 'The apps service is unavailable.'
                          : 'The app has not responded yet.'}
                      </p>
                      <div className="flex gap-3">
                        <button
                          onClick={reload}
                          className="rounded-lg border px-4 py-2"
                        >
                          Retry
                        </button>
                        <button
                          onClick={() =>
                            onEdit(
                              'The app did not report a successful page load within 10 seconds.'
                            )
                          }
                          className="rounded-lg bg-primary px-4 py-2 text-primary-foreground"
                        >
                          Fix with copilot
                        </button>
                      </div>
                      <button
                        onClick={() => setLoadState('loaded')}
                        className="text-xs underline"
                      >
                        Show the page anyway
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        {showDetail && (
          <div className="absolute inset-y-0 right-0 z-10 w-80 max-w-full border-l bg-background shadow-lg">
            <AppDetail
              folder={app.folder}
              activity={activity}
              onClose={() => setShowDetail(false)}
              onRemoved={onBack}
              onChanged={reload}
            />
          </div>
        )}
      </div>
      {showPublish && (
        <PublishDialog
          folder={app.folder}
          appName={title}
          published={!!app.publish}
          onClose={() => setShowPublish(false)}
          onPublished={() => setShowDetail(true)}
        />
      )}
    </div>
  )
}
