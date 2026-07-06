import { useEffect, useState } from 'react'
import { Download, Link2, RefreshCw, Search, ShieldAlert } from 'lucide-react'
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

export function CatalogTab({ onInstalled }: { onInstalled: (folder: string) => void }) {
  const [records, setRecords] = useState<rowboatApp.RegistryRecord[]>([])
  const [stale, setStale] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [urlDialog, setUrlDialog] = useState(false)
  const [url, setUrl] = useState('')

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

  const confirmInstall = async () => {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      const r = preview.url
        ? await window.ipc.invoke('apps:installFromUrl', { url: preview.url, confirmed: true })
        : await window.ipc.invoke('apps:install', { name: preview.name ?? '', confirmed: true })
      setPreview(null)
      if (r.status === 'installed' && r.app) onInstalled(r.app.folder)
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
              <button type="button" onClick={() => void startInstall(r.name)}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent">
                <Download className="size-4" /> Install
              </button>
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
    </div>
  )
}
