import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Github, Loader2, XCircle } from 'lucide-react'

// Publish dialog (spec §14): device-flow sign-in → confirmation → step
// progress (§11.2 step names) → success links / typed error (name_taken gets
// an inline hint to rename and retry). With `published` the dialog runs the
// UPDATE path instead (§11.3: version bump + new release, no registry) —
// re-running first-publish on a published app always fails with name_taken.

type Phase = 'auth' | 'device' | 'confirm' | 'publishing' | 'done' | 'error'
type Increment = 'patch' | 'minor' | 'major'

export function PublishDialog({ folder, appName, published, onClose, onPublished }: {
  folder: string
  appName: string
  /** App already has a publish record — run publish-update instead. */
  published?: boolean
  onClose: () => void
  onPublished: () => void
}) {
  const [phase, setPhase] = useState<Phase>('auth')
  const [login, setLogin] = useState<string | undefined>()
  const [userCode, setUserCode] = useState('')
  const [steps, setSteps] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [increment, setIncrement] = useState<Increment>('patch')
  const [result, setResult] = useState<{ repoUrl?: string; releaseUrl: string; prUrl?: string; status: string; version?: string } | null>(null)
  const pollTimer = useRef<number | null>(null)

  useEffect(() => {
    void (async () => {
      const s = await window.ipc.invoke('githubAuth:status', {})
      if (s.signedIn) {
        setLogin(s.login)
        setPhase('confirm')
      }
    })()
    return () => { if (pollTimer.current) window.clearInterval(pollTimer.current) }
  }, [])

  useEffect(() => {
    return window.ipc.on('apps:progress', ({ folder: f, step }) => {
      if (f === folder) setSteps((prev) => (prev.includes(step) ? prev : [...prev, step]))
    })
  }, [folder])

  const startSignIn = async () => {
    setError(null)
    try {
      const r = await window.ipc.invoke('githubAuth:start', {})
      setUserCode(r.userCode)
      setPhase('device')
      pollTimer.current = window.setInterval(() => {
        void (async () => {
          const p = await window.ipc.invoke('githubAuth:poll', {})
          if (p.status === 'authorized') {
            if (pollTimer.current) window.clearInterval(pollTimer.current)
            setLogin(p.login)
            setPhase('confirm')
          } else if (p.status === 'expired' || p.status === 'denied') {
            if (pollTimer.current) window.clearInterval(pollTimer.current)
            setError(p.status === 'expired' ? 'The code expired — start again.' : 'Authorization was denied.')
            setPhase('auth')
          }
        })().catch((e: unknown) => {
          // A hard failure (bad client config, network) must surface, not spin.
          if (pollTimer.current) window.clearInterval(pollTimer.current)
          setError(e instanceof Error ? e.message : String(e))
          setPhase('auth')
        })
        // Heartbeat only — core paces the actual GitHub requests to the
        // flow's required interval (and skips the request when it's too soon).
      }, 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const publish = async () => {
    setPhase('publishing')
    setError(null)
    setSteps([])
    try {
      if (published) {
        const r = await window.ipc.invoke('apps:publishUpdate', { folder, increment })
        setResult({ releaseUrl: r.releaseUrl, status: 'published', version: r.version })
      } else {
        const r = await window.ipc.invoke('apps:publish', { folder })
        setResult(r)
      }
      setPhase('done')
      onPublished()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }

  const STEP_LABELS: Record<string, string> = {
    packaged: 'Packaged bundle',
    repo_created: 'Created GitHub repo',
    source_pushed: 'Pushed source',
    release_created: 'Created release',
    assets_uploaded: 'Uploaded assets',
    registered: 'Opened registry PR',
    polling: 'Waiting for registry validation…',
    published: 'Published',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-xl">
        <div className="mb-3 flex items-center gap-2 text-base font-semibold">
          <Github className="size-5" /> Publish {appName}
        </div>

        {error && <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
          {error.includes('name_taken') && <div className="mt-1 text-xs">That name is taken — rename the app in <code>rowboat-app.json</code> and retry.</div>}
        </div>}

        {phase === 'auth' && (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">Publishing creates a public GitHub repo under your account, uploads the app as a release, and lists it in the Rowboat catalog. A generated MIT LICENSE is added if your app has none.</p>
            <button type="button" onClick={() => void startSignIn()}
              className="w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
              Sign in with GitHub
            </button>
          </div>
        )}

        {phase === 'device' && (
          <div className="space-y-3 text-center text-sm">
            <p className="text-muted-foreground">Enter this code on the GitHub page that just opened:</p>
            <div className="select-all rounded-lg border border-border bg-muted/40 py-3 font-mono text-2xl font-bold tracking-widest">{userCode}</div>
            <p className="flex items-center justify-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Waiting for authorization…</p>
          </div>
        )}

        {phase === 'confirm' && (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Signed in as <span className="font-medium text-foreground">@{login}</span>.{' '}
              {published
                ? <>This will publish a new version of <span className="font-medium text-foreground">{appName}</span> (a new release on the existing repo).</>
                : <>This will publish <span className="font-medium text-foreground">{appName}</span> publicly.</>}
            </p>
            {published && (
              <label className="flex items-center gap-2 text-muted-foreground">
                Version bump
                <select value={increment} onChange={(e) => setIncrement(e.target.value as Increment)}
                  className="rounded-md border border-border bg-background px-2 py-1 text-sm">
                  <option value="patch">patch</option>
                  <option value="minor">minor</option>
                  <option value="major">major</option>
                </select>
              </label>
            )}
            <button type="button" onClick={() => void publish()}
              className="w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
              {published ? 'Publish update' : 'Publish'}
            </button>
          </div>
        )}

        {published && (phase === 'publishing' || phase === 'done' || phase === 'error') && (
          <div className="space-y-3 text-sm">
            {phase === 'publishing' && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Publishing update…
              </p>
            )}
            {phase === 'done' && result && (
              <div className="space-y-1">
                <p className="flex items-center gap-2"><CheckCircle2 className="size-4 text-green-600" /> Published v{result.version}</p>
                <div className="text-xs">Release: <a className="text-primary underline" href={result.releaseUrl} target="_blank" rel="noreferrer">{result.releaseUrl}</a></div>
              </div>
            )}
          </div>
        )}

        {!published && (phase === 'publishing' || phase === 'done' || phase === 'error') && (
          <div className="space-y-1.5 text-sm">
            {Object.entries(STEP_LABELS).map(([key, label]) => {
              const doneStep = steps.includes(key) || phase === 'done'
              const active = phase === 'publishing' && !doneStep && steps[steps.length - 1] !== key
              if (key === 'published' && phase !== 'done') return null
              return (
                <div key={key} className="flex items-center gap-2">
                  {doneStep
                    ? <CheckCircle2 className="size-4 text-green-600" />
                    : phase === 'error'
                      ? <XCircle className="size-4 text-muted-foreground/40" />
                      : <Loader2 className={`size-4 ${active ? 'text-muted-foreground/40' : 'animate-spin text-muted-foreground'}`} />}
                  <span className={doneStep ? '' : 'text-muted-foreground'}>{label}</span>
                </div>
              )
            })}
            {phase === 'done' && result && (
              <div className="mt-3 space-y-1 text-xs">
                <div>Repo: <a className="text-primary underline" href={result.repoUrl} target="_blank" rel="noreferrer">{result.repoUrl}</a></div>
                <div>Release: <a className="text-primary underline" href={result.releaseUrl} target="_blank" rel="noreferrer">{result.releaseUrl}</a></div>
                {result.status === 'pending' && result.prUrl && (
                  <div className="text-amber-600 dark:text-amber-400">Registry validation still pending — track it at <a className="underline" href={result.prUrl} target="_blank" rel="noreferrer">the PR</a>.</div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent">
            {phase === 'done' ? 'Done' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}
