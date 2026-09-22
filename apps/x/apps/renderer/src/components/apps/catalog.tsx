import { useEffect, useState } from 'react'
import {
  BadgeCheck,
  Bot,
  Download,
  Link2,
  RefreshCw,
  Search,
  ShieldAlert,
  Star
} from 'lucide-react'
import type { rowboatApp } from '@x/shared'
import { themeForIndex, patternFor } from '@/components/apps/card-theme'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '@/components/ui/dialog'
import { Streamdown } from 'streamdown'
import { AppIcon, appTitle } from './app-icon'
import { ModelSelector } from '@/components/model-selector'

// Catalog tab (spec §14): search the registry, install with the D18 capability
// disclosure, install from a direct bundle URL.

type Preview = {
  name?: string
  version?: string
  description?: string
  capabilities?: string[]
  agents?: string[]
  updateSource?: 'github' | 'none'
  readme?: string
  repo?: string
  iconUrl?: string
  url?: string // set for URL installs
}

const CAPABILITY_NAMES: Record<string, string> = {
  gmail: 'Gmail',
  googlecalendar: 'Google Calendar',
  github: 'GitHub',
  slack: 'Slack',
  llm: 'AI models',
  copilot: 'Copilot',
  voice: 'Voice'
}
const capabilityName = (cap: string) => CAPABILITY_NAMES[cap] ?? appTitle(cap)

function capabilityDescription(cap: string): string {
  if (cap === 'voice')
    return 'transcribe audio and generate speech using your configured voice providers'
  if (cap === 'llm') return 'use your AI models (spends your tokens)'
  if (cap === 'copilot')
    return 'run the copilot agent on your behalf (tools + your knowledge)'
  return `read and act through your connected ${capabilityName(cap)} account`
}

function readmeUrl(
  value: string | undefined,
  repo: string | undefined,
  image = false
) {
  if (!value) return undefined
  try {
    const base = image
      ? `https://raw.githubusercontent.com/${repo}/HEAD/`
      : `https://github.com/${repo}/blob/HEAD/`
    const url = new URL(value, repo ? base : undefined)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}

/** D18 disclosure dialog: every declared capability + bundled agent, explicit confirm. */
function InstallConfirmDialog({
  preview,
  busy,
  error,
  onConfirm,
  onCancel
}: {
  preview: Preview
  busy: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const caps = preview.capabilities ?? []
  const agents = preview.agents ?? []
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel()
      }}
    >
      <DialogContent
        showCloseButton={!busy}
        className="max-h-[85vh] overflow-y-auto sm:max-w-xl"
      >
        <DialogTitle>{appTitle(preview.name ?? 'App')}</DialogTitle>
        <DialogDescription>
          {preview.description ||
            'Review this app and the access it needs before installing.'}
        </DialogDescription>
        {preview.iconUrl && (
          <img
            src={preview.iconUrl}
            alt=""
            className="size-14 rounded-xl object-cover"
          />
        )}
        {preview.repo && (
          <a
            className="text-xs text-muted-foreground underline"
            href={`https://github.com/${preview.repo}`}
            target="_blank"
            rel="noreferrer"
          >
            By {preview.repo.split('/')[0]} · View source · v{preview.version}
          </a>
        )}
        {preview.readme ? (
          <div className="max-h-64 overflow-auto rounded-lg border p-3 text-sm">
            <Streamdown
              mode="static"
              components={{
                img: ({ src, alt }) => (
                  <img
                    src={readmeUrl(
                      typeof src === 'string' ? src : undefined,
                      preview.repo,
                      true
                    )}
                    alt={alt ?? ''}
                    className="max-w-full rounded-lg"
                  />
                ),
                a: ({ href, children }) => (
                  <a
                    href={readmeUrl(href, preview.repo)}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {children}
                  </a>
                )
              }}
            >
              {preview.readme}
            </Streamdown>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No preview supplied by the author. You can inspect the source before
            installing.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mb-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <div className="mb-1.5 flex items-center gap-1.5 font-medium">
            <ShieldAlert className="size-4 text-amber-500" /> This app will be
            able to:
          </div>
          {caps.length === 0 ? (
            <p className="text-muted-foreground">
              No connected-account or AI access declared.
            </p>
          ) : (
            <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
              {caps.map((c) => (
                <li key={c}>
                  <span className="font-medium text-foreground">
                    {capabilityName(c)}
                  </span>
                  : {capabilityDescription(c)}
                </li>
              ))}
            </ul>
          )}
          {agents.length > 0 && (
            <div className="mt-2">
              <div className="font-medium">
                Bundled background agents (installed disabled):
              </div>
              <ul className="list-inside list-disc text-muted-foreground">
                {agents.map((a) => (
                  <li key={a}>{appTitle(a.replace(/\.yaml$/, ''))}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {preview.updateSource === 'none' && (
          <p className="mb-3 text-xs text-amber-600 dark:text-amber-400">
            Installed from a direct URL — updates will be unavailable.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Installing…' : 'Install'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

type ModelChoice = { provider: string; model: string }

/** Post-install opt-in (§8.3): bundled agents land disabled; without this
 * prompt a fresh installer opens an empty app with no hint that the refresher
 * exists, buried in bg-tasks. The model picker defaults to the host-pinned
 * model but lets the user override before the first run. */
function EnableAgentsDialog({
  appName,
  names,
  defaultModel,
  busy,
  progress,
  error,
  complete,
  onEnable,
  onSkip
}: {
  appName: string
  names: string[]
  progress: string[]
  error: string | null
  complete: boolean
  defaultModel?: ModelChoice
  busy: boolean
  onEnable: (model: ModelChoice | null) => void
  onSkip: () => void
}) {
  // Pre-seeded with the host-pinned model; "(default)" (null) enables
  // without a model patch, keeping whatever each agent has pinned.
  const [selected, setSelected] = useState<ModelChoice | null>(
    defaultModel ?? null
  )

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onSkip()
      }}
    >
      <DialogContent showCloseButton={!busy}>
        <DialogTitle className="flex items-center gap-2">
          <Bot className="size-5" />
          {complete
            ? 'Your app is ready to open'
            : busy
              ? 'Getting your first update'
              : 'Bring your app to life'}
        </DialogTitle>
        <DialogDescription>
          Run the first update so {appTitle(appName)} opens with your data. This
          may take a few minutes.
        </DialogDescription>
        <p className="mb-3 text-sm text-muted-foreground">
          {appTitle(appName)} ships {names.length === 1 ? 'an agent' : 'agents'}{' '}
          that keep
          {names.length === 1 ? 's' : ''} its data fresh on a schedule, using
          your connected accounts and AI models. You can manage automatic
          updates inside the app.
        </p>
        <ul className="mb-3 list-inside list-disc text-sm text-muted-foreground">
          {names.map((n, i) => (
            <li key={`${n}-${i}`}>
              {n}
              {progress[i] ? ` — ${progress[i]}` : ''}
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {!complete && !busy && (
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Advanced: AI model
            </summary>
            <label className="mb-3 mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              Run with
              <div className="min-w-0 flex-1">
                <ModelSelector
                  variant="field"
                  inheritDefault={{ label: '(default)' }}
                  value={selected}
                  onChange={setSelected}
                />
              </div>
            </label>
          </details>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            {busy
              ? 'Open while updating'
              : complete
                ? 'Open app'
                : error
                  ? 'Open with setup incomplete'
                  : 'Set up later'}
          </button>
          {!complete && (
            <button
              type="button"
              onClick={() => onEnable(selected)}
              disabled={busy}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Updating…' : error ? 'Retry setup' : 'Turn on & run now'}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function CatalogTab({
  onInstalled
}: {
  onInstalled: (folder: string) => void
}) {
  const [records, setRecords] = useState<rowboatApp.RegistryRecord[]>([])
  const [stale, setStale] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [urlDialog, setUrlDialog] = useState(false)
  const [url, setUrl] = useState('')
  const [agentPrompt, setAgentPrompt] = useState<{
    folder: string
    appName: string
    slugs: string[]
    names: string[]
    defaultModel?: ModelChoice
  } | null>(null)
  const [enabling, setEnabling] = useState(false)
  const [loading, setLoading] = useState(true)
  const [previewing, setPreviewing] = useState(false)
  const [setupProgress, setSetupProgress] = useState<string[]>([])
  const [setupError, setSetupError] = useState<string | null>(null)
  const [setupComplete, setSetupComplete] = useState(false)
  // Registry name → local folder, for apps already installed from the catalog.
  const [installedByName, setInstalledByName] = useState<Map<string, string>>(
    new Map()
  )
  // GitHub star counts rank the list; `starred` is the signed-in user's set.
  const [stars, setStars] = useState<Record<string, number>>({})
  const [starred, setStarred] = useState<Record<string, boolean>>({})

  const loadStars = async (recs: rowboatApp.RegistryRecord[]) => {
    if (recs.length === 0) return
    try {
      const r = await window.ipc.invoke('apps:catalogStars', {
        repos: recs.map((x) => x.repo)
      })
      setStars((prev) => ({ ...prev, ...r.stars }))
      setStarred((prev) => ({ ...prev, ...r.starred }))
    } catch {
      /* unranked list is fine */
    }
  }

  const toggleStar = async (repo: string) => {
    const next = !starred[repo]
    // Optimistic; revert on failure.
    setStarred((prev) => ({ ...prev, [repo]: next }))
    setStars((prev) => ({
      ...prev,
      [repo]: Math.max(0, (prev[repo] ?? 0) + (next ? 1 : -1))
    }))
    try {
      await window.ipc.invoke('apps:star', { repo, star: next })
    } catch (e) {
      setStarred((prev) => ({ ...prev, [repo]: !next }))
      setStars((prev) => ({
        ...prev,
        [repo]: Math.max(0, (prev[repo] ?? 0) + (next ? -1 : 1))
      }))
      const msg = e instanceof Error ? e.message : String(e)
      setError(
        msg.includes('not_signed_in')
          ? 'Starring uses your GitHub account — sign in once via any app’s Publish flow, then try again.'
          : msg
      )
    }
  }

  const loadInstalled = async () => {
    try {
      const r = await window.ipc.invoke('apps:list', {})
      setInstalledByName(
        new Map(
          r.apps
            .filter((a) => a.kind === 'installed' && a.install)
            .map((a) => [a.install!.name, a.folder])
        )
      )
    } catch {
      /* cards just show Install */
    }
  }
  useEffect(() => {
    void loadInstalled()
  }, [])

  const load = async (force = false) => {
    setError(null)
    setLoading(true)
    try {
      const r = await window.ipc.invoke('apps:catalogIndex', { force })
      setRecords(r.records)
      setStale(r.stale)
      void loadStars(r.records)
      setLoading(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  useEffect(() => {
    void load().finally(() => setLoading(false))
  }, [])

  const search = (q: string) => {
    setQuery(q)
  }

  // Rank by stars (unknown counts sink), name as the stable tiebreak.
  const ranked = records
    .filter((r) =>
      `${r.name} ${r.description} ${r.owner}`
        .toLowerCase()
        .includes(query.trim().toLowerCase())
    )
    .sort(
      (a, b) =>
        (stars[b.repo] ?? -1) - (stars[a.repo] ?? -1) ||
        a.name.localeCompare(b.name)
    )

  const startInstall = async (name: string) => {
    if (previewing) return
    setPreviewing(true)
    setError(null)
    try {
      const [r, detail] = await Promise.all([
        window.ipc.invoke('apps:install', { name }),
        window.ipc.invoke('apps:catalogDetail', { name }).catch(() => null)
      ])
      if (r.status === 'preview')
        setPreview({
          ...r,
          readme: detail?.readme,
          repo: detail?.record.repo,
          iconUrl: detail?.record.iconUrl
        })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPreviewing(false)
    }
  }

  const startUrlPreview = async () => {
    if (previewing) return
    setPreviewing(true)
    setError(null)
    try {
      const r = await window.ipc.invoke('apps:installFromUrl', {
        url: url.trim(),
        confirmed: false
      })
      if (r.status === 'preview') setPreview({ ...r, url: url.trim() })
      setUrlDialog(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPreviewing(false)
    }
  }

  const enableAgents = async (model: ModelChoice | null) => {
    if (!agentPrompt || enabling) return
    setEnabling(true)
    setSetupError(null)
    const progress = [...setupProgress]
    const errors: string[] = []
    for (const [index, slug] of agentPrompt.slugs.entries()) {
      if (progress[index] === 'Updated') continue
      progress[index] = 'Starting…'
      setSetupProgress([...progress])
      try {
        const patched = await window.ipc.invoke('bg-task:patch', {
          slug,
          partial: {
            active: true,
            ...(model ? { model: model.model, provider: model.provider } : {})
          }
        })
        if (!patched.success)
          throw new Error(patched.error || 'Could not enable the agent.')
        progress[index] = 'Fetching your data…'
        setSetupProgress([...progress])
        const run = await window.ipc.invoke('bg-task:run', { slug })
        if (!run.success)
          throw new Error(run.error || 'The first update failed.')
        progress[index] = 'Updated'
      } catch (e) {
        progress[index] = 'Needs attention'
        errors.push(
          `${agentPrompt.names[index]}: ${e instanceof Error ? e.message : String(e)}`
        )
      }
      setSetupProgress([...progress])
    }
    if (!errors.length) {
      try {
        const { app } = await window.ipc.invoke('apps:get', {
          folder: agentPrompt.folder
        })
        if (app.readiness && app.readiness !== 'ready') {
          errors.push(
            app.readinessMessage || 'The app’s first data update is incomplete.'
          )
          setSetupProgress([]) // retry runs again if a successful run produced no data
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e))
      }
    }
    setSetupError(errors.length ? errors.join(' ') : null)
    setSetupComplete(!errors.length)
    setEnabling(false)
  }

  const confirmInstall = async () => {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      const r = preview.url
        ? await window.ipc.invoke('apps:installFromUrl', {
            url: preview.url,
            confirmed: true
          })
        : await window.ipc.invoke('apps:install', {
            name: preview.name ?? '',
            confirmed: true
          })
      setPreview(null)
      void loadInstalled()
      if (r.status === 'installed' && r.app) {
        if (r.app.agentSlugs.length > 0) {
          // Offer to switch the bundled agents on (they install disabled).
          let defaultModel: ModelChoice | undefined
          const names = await Promise.all(
            r.app.agentSlugs.map(async (slug) => {
              try {
                const g = await window.ipc.invoke('bg-task:get', { slug })
                if (g.task?.model && g.task.provider)
                  defaultModel = {
                    model: g.task.model,
                    provider: g.task.provider
                  }
                return g.task?.name ?? slug
              } catch {
                return slug
              }
            })
          )
          setSetupProgress([])
          setSetupError(null)
          setSetupComplete(false)
          setAgentPrompt({
            folder: r.app.folder,
            appName: r.app.manifest?.name ?? r.app.folder,
            slugs: r.app.agentSlugs,
            names,
            defaultModel
          })
        } else {
          onInstalled(r.app.folder)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => void search(e.target.value)}
            placeholder="Search the catalog…"
            className="w-full rounded-lg border border-transparent bg-[var(--rowboat-wash)] py-2 pl-8 pr-3 text-sm outline-none focus:border-border"
          />
        </div>
        <button
          type="button"
          title="Install from URL"
          onClick={() => setUrlDialog(true)}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          <Link2 className="size-4" /> From URL
        </button>
        {stale && (
          <button
            type="button"
            onClick={() => void load(true).finally(() => setLoading(false))}
            className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-medium"
          >
            <RefreshCw className="size-4" /> Stale — refresh
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {previewing && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          Loading app preview…
        </p>
      )}
      {loading ? (
        <p
          role="status"
          className="py-16 text-center text-sm text-muted-foreground"
        >
          Loading the catalog…
        </p>
      ) : ranked.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          {error
            ? 'The catalog could not load.'
            : query
              ? 'No apps match your search.'
              : 'No apps in the catalog yet.'}
          <button
            className="ml-2 underline"
            onClick={() => void load(true).finally(() => setLoading(false))}
          >
            Refresh
          </button>
        </div>
      ) : (
        <div className="ma-grid">
          {ranked.map((r) => {
            const theme = themeForIndex(
              [...r.name].reduce((n, c) => n + c.charCodeAt(0), 0)
            )
            const installedFolder = installedByName.get(r.name)
            return (
              <div
                key={r.name}
                role="button"
                tabIndex={0}
                onClick={() =>
                  installedFolder
                    ? onInstalled(installedFolder)
                    : void startInstall(r.name)
                }
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    if (installedFolder) onInstalled(installedFolder)
                    else void startInstall(r.name)
                  }
                }}
                className={`ma-card ma-pat-${patternFor(r.name)}`}
                style={
                  {
                    '--accent': theme.accent,
                    '--glow': theme.glow
                  } as React.CSSProperties
                }
              >
                <div className="ma-top">
                  {installedFolder && (
                    <span className="ma-badge">INSTALLED</span>
                  )}
                  <button
                    type="button"
                    title={
                      starred[r.repo] ? 'Unstar on GitHub' : 'Star on GitHub'
                    }
                    onClick={(e) => {
                      e.stopPropagation()
                      void toggleStar(r.repo)
                    }}
                    className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium hover:bg-foreground/10 ${starred[r.repo] ? 'text-amber-500' : 'text-muted-foreground'}`}
                  >
                    <Star
                      className={`size-3.5 ${starred[r.repo] ? 'fill-current' : ''}`}
                    />
                    {stars[r.repo] ?? '—'}
                  </button>
                </div>
                <AppIcon name={r.name} src={r.iconUrl} />
                <div className="ma-title">{appTitle(r.name)}</div>
                <div className="ma-owner">by {r.owner}</div>
                <div className="ma-desc">
                  {r.description || 'No description.'}
                </div>
                <div className="ma-footer">
                  <span className="ma-lastrun">Explore this app</span>
                  {installedFolder ? (
                    <button
                      type="button"
                      title="Installed — open it"
                      onClick={(e) => {
                        e.stopPropagation()
                        onInstalled(installedFolder)
                      }}
                      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-[var(--rowboat-success)] hover:bg-[var(--rowboat-success)]/10"
                    >
                      <BadgeCheck className="size-4" /> Open
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void startInstall(r.name)
                      }}
                      className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
                    >
                      <Download className="size-4" /> View app
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {urlDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border-none bg-popover p-5 shadow-[var(--rowboat-shadow)]">
            <div className="mb-2 text-base font-semibold">Install from URL</div>
            {error && (
              <p role="alert" className="mb-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <p className="mb-3 text-sm text-muted-foreground">
              Paste a direct https link to a <code>.rowboat-app</code> bundle
              (e.g. a GitHub release asset).
            </p>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo/releases/download/v1.0.0/name.rowboat-app"
              className="mb-3 w-full rounded-lg border border-transparent bg-[var(--rowboat-wash)] px-3 py-2 font-mono text-xs outline-none focus:border-border"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setUrlDialog(false)}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void startUrlPreview()}
                disabled={previewing || !url.trim().startsWith('https://')}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {previewing ? 'Loading…' : 'Preview'}
              </button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <InstallConfirmDialog
          preview={preview}
          busy={busy}
          error={error}
          onConfirm={() => void confirmInstall()}
          onCancel={() => setPreview(null)}
        />
      )}

      {agentPrompt && (
        <EnableAgentsDialog
          appName={agentPrompt.appName}
          names={agentPrompt.names}
          defaultModel={agentPrompt.defaultModel}
          busy={enabling}
          progress={setupProgress}
          error={setupError}
          complete={setupComplete}
          onEnable={(model) => void enableAgents(model)}
          onSkip={() => {
            const folder = agentPrompt.folder
            setAgentPrompt(null)
            onInstalled(folder)
          }}
        />
      )}
    </div>
  )
}
