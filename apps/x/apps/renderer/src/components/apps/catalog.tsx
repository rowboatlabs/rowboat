import { useEffect, useState } from 'react'
import { BadgeCheck, Bot, Download, Link2, RefreshCw, Search, ShieldAlert } from 'lucide-react'
import type { rowboatApp } from '@x/shared'

// Catalog tab (spec §14): search the registry, install with the D18 capability
// disclosure, install from a direct bundle URL.

type Preview = {
  name?: string
  version?: string
  description?: string
  capabilities?: string[]
  agents?: string[]
  updateSource?: 'github' | 'none'
  url?: string // set for URL installs
}

function capabilityDescription(cap: string): string {
  if (cap === 'llm') return 'use your AI models (spends your tokens)'
  if (cap === 'copilot') return 'run the copilot agent on your behalf (tools + your knowledge)'
  return `read and act on your ${cap} through your connected account`
}

/** D18 disclosure dialog: every declared capability + bundled agent, explicit confirm. */
function InstallConfirmDialog({ preview, busy, onConfirm, onCancel }: {
  preview: Preview
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const caps = preview.capabilities ?? []
  const agents = preview.agents ?? []
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-xl">
        <div className="mb-1 text-base font-semibold">Install {preview.name} v{preview.version}?</div>
        {preview.description && <p className="mb-3 text-sm text-muted-foreground">{preview.description}</p>}

        <div className="mb-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <div className="mb-1.5 flex items-center gap-1.5 font-medium">
            <ShieldAlert className="size-4 text-amber-500" /> This app will be able to:
          </div>
          {caps.length === 0 ? (
            <p className="text-muted-foreground">Nothing — it declares no capabilities (no tools, LLM, or copilot access).</p>
          ) : (
            <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
              {caps.map((c) => <li key={c}><span className="font-medium text-foreground">{c}</span>: {capabilityDescription(c)}</li>)}
            </ul>
          )}
          {agents.length > 0 && (
            <div className="mt-2">
              <div className="font-medium">Bundled background agents (installed disabled):</div>
              <ul className="list-inside list-disc text-muted-foreground">
                {agents.map((a) => <li key={a}>{a}</li>)}
              </ul>
            </div>
          )}
        </div>

        {preview.updateSource === 'none' && (
          <p className="mb-3 text-xs text-amber-600 dark:text-amber-400">Installed from a direct URL — updates will be unavailable.</p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {busy ? 'Installing…' : 'Install'}
          </button>
        </div>
      </div>
    </div>
  )
}

type ModelChoice = { provider: string; model: string }

/** Post-install opt-in (§8.3): bundled agents land disabled; without this
 * prompt a fresh installer opens an empty app with no hint that the refresher
 * exists, buried in bg-tasks. The model picker defaults to the host-pinned
 * model but lets the user override before the first run. */
function EnableAgentsDialog({ appName, names, defaultModel, busy, onEnable, onSkip }: {
  appName: string
  names: string[]
  defaultModel?: ModelChoice
  busy: boolean
  onEnable: (model: ModelChoice | null) => void
  onSkip: () => void
}) {
  const [options, setOptions] = useState<Array<ModelChoice & { label: string }>>([])
  const [selected, setSelected] = useState<string>(defaultModel ? `${defaultModel.provider}::${defaultModel.model}` : '')

  useEffect(() => {
    void (async () => {
      try {
        const r = await window.ipc.invoke('models:list', null)
        setOptions(r.providers.flatMap((p) => p.models.map((m) => ({
          provider: p.id,
          model: m.id,
          label: `${m.name ?? m.id} (${p.name})`,
        }))))
      } catch { /* no picker — enable keeps the pinned model */ }
    })()
  }, [])

  const choice = (): ModelChoice | null => {
    const [provider, model] = selected.split('::')
    return provider && model ? { provider, model } : null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-xl">
        <div className="mb-1 flex items-center gap-2 text-base font-semibold">
          <Bot className="size-5" /> Turn on {names.length === 1 ? 'its background agent' : 'its background agents'}?
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          {appName} ships {names.length === 1 ? 'an agent' : 'agents'} that keep{names.length === 1 ? 's' : ''} its
          data fresh on a schedule, using your connected accounts and AI models. {names.length === 1 ? 'It is' : 'They are'} currently off.
        </p>
        <ul className="mb-3 list-inside list-disc text-sm text-muted-foreground">
          {names.map((n) => <li key={n}>{n}</li>)}
        </ul>
        {options.length > 0 && (
          <label className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
            Run with
            <select value={selected} onChange={(e) => setSelected(e.target.value)}
              className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2 py-1 text-sm">
              {defaultModel && !options.some((o) => o.provider === defaultModel.provider && o.model === defaultModel.model) && (
                <option value={`${defaultModel.provider}::${defaultModel.model}`}>{defaultModel.model} (default)</option>
              )}
              {options.map((o) => (
                <option key={`${o.provider}::${o.model}`} value={`${o.provider}::${o.model}`}>{o.label}</option>
              ))}
            </select>
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onSkip} disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent">Not now</button>
          <button type="button" onClick={() => onEnable(choice())} disabled={busy}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {busy ? 'Turning on…' : 'Turn on & run now'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function CatalogTab({ onInstalled }: { onInstalled: (folder: string) => void }) {
  const [records, setRecords] = useState<rowboatApp.RegistryRecord[]>([])
  const [stale, setStale] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [urlDialog, setUrlDialog] = useState(false)
  const [url, setUrl] = useState('')
  const [agentPrompt, setAgentPrompt] = useState<{ folder: string; appName: string; slugs: string[]; names: string[]; defaultModel?: ModelChoice } | null>(null)
  const [enabling, setEnabling] = useState(false)
  // Registry name → local folder, for apps already installed from the catalog.
  const [installedByName, setInstalledByName] = useState<Map<string, string>>(new Map())

  const loadInstalled = async () => {
    try {
      const r = await window.ipc.invoke('apps:list', {})
      setInstalledByName(new Map(
        r.apps.filter((a) => a.kind === 'installed' && a.install).map((a) => [a.install!.name, a.folder]),
      ))
    } catch { /* cards just show Install */ }
  }
  useEffect(() => { void loadInstalled() }, [])

  const load = async (force = false) => {
    setError(null)
    try {
      const r = await window.ipc.invoke('apps:catalogIndex', { force })
      setRecords(r.records)
      setStale(r.stale)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  useEffect(() => { void load() }, [])

  const search = async (q: string) => {
    setQuery(q)
    try {
      const r = q.trim()
        ? await window.ipc.invoke('apps:catalogSearch', { query: q })
        : await window.ipc.invoke('apps:catalogIndex', {})
      setRecords(r.records)
    } catch { /* keep current list */ }
  }

  const startInstall = async (name: string) => {
    setError(null)
    try {
      const r = await window.ipc.invoke('apps:install', { name })
      if (r.status === 'preview') setPreview({ ...r })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const startUrlPreview = async () => {
    setError(null)
    try {
      const r = await window.ipc.invoke('apps:installFromUrl', { url: url.trim(), confirmed: false })
      if (r.status === 'preview') setPreview({ ...r, url: url.trim() })
      setUrlDialog(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const enableAgents = async (model: ModelChoice | null) => {
    if (!agentPrompt) return
    setEnabling(true)
    try {
      for (const slug of agentPrompt.slugs) {
        await window.ipc.invoke('bg-task:patch', {
          slug,
          partial: { active: true, ...(model ? { model: model.model, provider: model.provider } : {}) },
        })
        // First run so the app opens with data; resolves when the run ends, so
        // fire-and-forget.
        void window.ipc.invoke('bg-task:run', { slug }).catch(() => { /* surfaced in bg-tasks */ })
      }
    } catch { /* patch failures land the user in the same place as "Not now" */ }
    const folder = agentPrompt.folder
    setAgentPrompt(null)
    setEnabling(false)
    onInstalled(folder)
  }

  const confirmInstall = async () => {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      const r = preview.url
        ? await window.ipc.invoke('apps:installFromUrl', { url: preview.url, confirmed: true })
        : await window.ipc.invoke('apps:install', { name: preview.name ?? '', confirmed: true })
      setPreview(null)
      void loadInstalled()
      if (r.status === 'installed' && r.app) {
        if (r.app.agentSlugs.length > 0) {
          // Offer to switch the bundled agents on (they install disabled).
          let defaultModel: ModelChoice | undefined
          const names = await Promise.all(r.app.agentSlugs.map(async (slug) => {
            try {
              const g = await window.ipc.invoke('bg-task:get', { slug })
              if (g.task?.model && g.task.provider) defaultModel = { model: g.task.model, provider: g.task.provider }
              return g.task?.name ?? slug
            } catch {
              return slug
            }
          }))
          setAgentPrompt({ folder: r.app.folder, appName: r.app.manifest?.name ?? r.app.folder, slugs: r.app.agentSlugs, names, defaultModel })
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
            className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-sm outline-none focus:border-foreground/30"
          />
        </div>
        <button type="button" title="Install from URL"
          onClick={() => setUrlDialog(true)}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-accent">
          <Link2 className="size-4" /> From URL
        </button>
        {stale && (
          <button type="button" onClick={() => void load(true)}
            className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-medium">
            <RefreshCw className="size-4" /> Stale — refresh
          </button>
        )}
      </div>

      {error && <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      {records.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          {query ? 'No apps match your search.' : 'No apps in the catalog yet — be the first to publish one.'}
        </div>
      ) : (
        <div className="space-y-2">
          {records.map((r) => (
            <div key={r.name} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-semibold">{r.name}</span>
                  <span className="text-xs text-muted-foreground">by {r.owner}</span>
                </div>
                <p className="truncate text-xs text-muted-foreground">{r.description || 'No description.'}</p>
              </div>
              {installedByName.has(r.name) ? (
                <button type="button" title="Installed — open it"
                  onClick={() => onInstalled(installedByName.get(r.name)!)}
                  className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-green-600 hover:bg-green-500/10 dark:text-green-500">
                  <BadgeCheck className="size-4" /> Installed
                </button>
              ) : (
                <button type="button" onClick={() => void startInstall(r.name)}
                  className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent">
                  <Download className="size-4" /> Install
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {urlDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-xl">
            <div className="mb-2 text-base font-semibold">Install from URL</div>
            <p className="mb-3 text-sm text-muted-foreground">Paste a direct https link to a <code>.rowboat-app</code> bundle (e.g. a GitHub release asset).</p>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo/releases/download/v1.0.0/name.rowboat-app"
              className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus:border-foreground/30"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setUrlDialog(false)}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent">Cancel</button>
              <button type="button" onClick={() => void startUrlPreview()} disabled={!url.trim().startsWith('https://')}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <InstallConfirmDialog
          preview={preview}
          busy={busy}
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
