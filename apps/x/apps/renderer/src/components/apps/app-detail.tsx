import { useEffect, useState } from 'react'
import { X, RotateCcw, Play, UploadCloud, ArrowUpCircle, Trash2 } from 'lucide-react'
import type { rowboatApp } from '@x/shared'
import { PublishDialog } from '@/components/apps/publish-dialog'

// App detail panel (spec §14): manifest info, provenance/publish state,
// bundled agents with enable toggles, rollback when available. Update/publish
// actions land with M3.

type AgentRow = {
  slug: string
  name: string
  active: boolean
  lastRunAt?: string
  lastRunError?: string
}

export function AppDetail({ folder, onClose }: { folder: string; onClose: () => void }) {
  const [app, setApp] = useState<rowboatApp.AppSummary | null>(null)
  const [readme, setReadme] = useState<string | undefined>(undefined)
  const [rollback, setRollback] = useState(false)
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [updateInfo, setUpdateInfo] = useState<{ current: string; latest: string; updateAvailable: boolean } | null>(null)
  const [showPublish, setShowPublish] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const runAction = async (name: string, fn: () => Promise<string | void>) => {
    setBusyAction(name)
    setError(null)
    setNotice(null)
    try {
      const msg = await fn()
      if (msg) setNotice(msg)
      setReloadNonce((n) => n + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyAction(null)
    }
  }

  const checkForUpdate = () => runAction('check', async () => {
    const r = await window.ipc.invoke('apps:checkUpdate', { folder })
    setUpdateInfo(r)
    return r.updateAvailable ? `v${r.latest} is available (you have v${r.current}).` : `Up to date (v${r.current}).`
  })

  const doUpdate = () => runAction('update', async () => {
    try {
      await window.ipc.invoke('apps:update', { folder })
      return 'Updated.'
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // D18 / modified-files confirmation flows (§12.3)
      if (msg.includes('new_capabilities')) {
        if (!window.confirm(`This update widens the app's access:\n${msg}\n\nProceed?`)) return
        await window.ipc.invoke('apps:update', { folder, confirmNewCapabilities: true, confirmOverwriteModified: true })
        return 'Updated (new capabilities confirmed).'
      }
      if (msg.includes('modified_files')) {
        if (!window.confirm(`You modified files this update will overwrite:\n${msg}\n\nProceed?`)) return
        await window.ipc.invoke('apps:update', { folder, confirmOverwriteModified: true })
        return 'Updated (local modifications overwritten).'
      }
      throw e
    }
  })

  const doRollback = () => runAction('rollback', async () => {
    await window.ipc.invoke('apps:rollback', { folder })
    return 'Rolled back to the previous version.'
  })

  const doUninstall = () => runAction('uninstall', async () => {
    const agentNote = agents.length ? `\n\nThis also deletes its background agents: ${agents.map((a) => a.name).join(', ')}.` : ''
    if (!window.confirm(`Uninstall this app? Its data/ folder will be deleted.${agentNote}`)) return
    await window.ipc.invoke('apps:uninstall', { folder })
    onClose()
  })

  // Local apps aren't "installed", so they get delete instead of uninstall.
  const doDelete = () => runAction('delete', async () => {
    const agentNote = agents.length ? `\n\nThis also deletes its background agents: ${agents.map((a) => a.name).join(', ')}.` : ''
    const publishNote = app?.publish ? '\n\nThe published copy (GitHub repo + catalog listing) is not touched.' : ''
    if (!window.confirm(`Delete this app? The whole folder, including data/, is removed from this machine.${publishNote}${agentNote}`)) return
    await window.ipc.invoke('apps:delete', { folder })
    onClose()
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await window.ipc.invoke('apps:get', { folder })
        if (cancelled) return
        setApp(r.app)
        setReadme(r.readme)
        setRollback(r.rollbackAvailable)
        const rows: AgentRow[] = []
        for (const slug of r.app.agentSlugs) {
          try {
            const t = await window.ipc.invoke('bg-task:get', { slug })
            if (t.task) {
              rows.push({
                slug,
                name: t.task.name,
                active: t.task.active,
                lastRunAt: t.task.lastRunAt,
                lastRunError: t.task.lastRunError,
              })
            }
          } catch { /* not materialized yet */ }
        }
        if (!cancelled) setAgents(rows)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { cancelled = true }
  }, [folder, reloadNonce])

  const toggleAgent = async (slug: string, active: boolean) => {
    setAgents((prev) => prev.map((a) => (a.slug === slug ? { ...a, active } : a)))
    try {
      await window.ipc.invoke('bg-task:patch', { slug, partial: { active } })
    } catch {
      setReloadNonce((n) => n + 1) // revert to truth on failure
    }
  }

  const runAgent = async (slug: string) => {
    try {
      await window.ipc.invoke('bg-task:run', { slug })
    } catch { /* surfaced via bg-task UI */ }
  }

  const manifest = app?.manifest

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="flex-1 truncate text-sm font-semibold">{manifest?.name ?? folder}</span>
        <button type="button" onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 text-sm">
        {error && <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">{error}</div>}
        {notice && <div className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-muted-foreground">{notice}</div>}
        {!app ? (
          <div className="text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-5">
            <section className="space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">App</div>
              {app.status === 'invalid' && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  Invalid manifest: {app.manifestError}
                </div>
              )}
              <InfoRow k="Version" v={manifest ? `v${manifest.version}` : '—'} />
              <InfoRow k="Folder" v={app.folder} />
              <InfoRow k="Origin" v={app.origin} mono />
              {manifest?.description ? <p className="pt-1 text-muted-foreground">{manifest.description}</p> : null}
            </section>

            <section className="space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Capabilities</div>
              {manifest && manifest.capabilities.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {manifest.capabilities.map((c) => (
                    <span key={c} className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{c}</span>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">None declared — this app can’t use tools, LLM, or the copilot.</p>
              )}
            </section>

            <section className="space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source</div>
              {app.kind === 'installed' && app.install ? (
                <>
                  <InfoRow k="Installed from" v={app.install.repo ?? app.install.sourceUrl ?? 'unknown'} mono />
                  <InfoRow k="Installed" v={new Date(app.install.installedAt).toLocaleString()} />
                  {app.install.updatedAt && <InfoRow k="Updated" v={new Date(app.install.updatedAt).toLocaleString()} />}
                </>
              ) : app.publish ? (
                <>
                  <p className="text-muted-foreground">Local app — published to the Rowboat catalog.</p>
                  <InfoRow k="Repository" v={app.publish.repo} mono link={`https://github.com/${app.publish.repo}`} />
                  {app.publish.lastPublishedVersion && (
                    <InfoRow
                      k="Published"
                      v={`v${app.publish.lastPublishedVersion}`}
                      link={`https://github.com/${app.publish.repo}/releases/tag/v${app.publish.lastPublishedVersion}`}
                    />
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">Local app — created on this machine.</p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                {app.kind === 'installed' && app.install?.repo && (
                  <button type="button" disabled={busyAction !== null}
                    onClick={() => void (updateInfo?.updateAvailable ? doUpdate() : checkForUpdate())}
                    className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50">
                    <ArrowUpCircle className="size-3.5" />
                    {busyAction === 'check' || busyAction === 'update' ? 'Working…'
                      : updateInfo?.updateAvailable ? `Update to v${updateInfo.latest}` : 'Check for update'}
                  </button>
                )}
                {rollback && (
                  <button type="button" disabled={busyAction !== null} onClick={() => void doRollback()}
                    className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50">
                    <RotateCcw className="size-3.5" /> Roll back
                  </button>
                )}
                {app.kind === 'local' && (
                  <button type="button" disabled={busyAction !== null} onClick={() => setShowPublish(true)}
                    className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50">
                    <UploadCloud className="size-3.5" /> {app.publish ? 'Publish update' : 'Publish'}
                  </button>
                )}
                {app.kind === 'installed' ? (
                  <button type="button" disabled={busyAction !== null} onClick={() => void doUninstall()}
                    className="flex items-center gap-1.5 rounded-md border border-destructive/40 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">
                    <Trash2 className="size-3.5" /> Uninstall
                  </button>
                ) : (
                  <button type="button" disabled={busyAction !== null} onClick={() => void doDelete()}
                    className="flex items-center gap-1.5 rounded-md border border-destructive/40 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">
                    <Trash2 className="size-3.5" /> Delete
                  </button>
                )}
              </div>
            </section>

            <section className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Background agents</div>
              {agents.length === 0 ? (
                <p className="text-muted-foreground">No bundled agents.</p>
              ) : agents.map((a) => (
                <div key={a.slug} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{a.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {a.lastRunError ? `Failed: ${a.lastRunError}` : a.lastRunAt ? `Last run ${new Date(a.lastRunAt).toLocaleString()}` : 'Never run'}
                    </div>
                  </div>
                  <button
                    type="button"
                    title="Run now"
                    onClick={() => void runAgent(a.slug)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Play className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={a.active}
                    onClick={() => void toggleAgent(a.slug, !a.active)}
                    className={`relative h-5 w-9 rounded-full transition ${a.active ? 'bg-primary' : 'bg-muted'}`}
                  >
                    <span className={`absolute top-0.5 size-4 rounded-full bg-background shadow transition-all ${a.active ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                </div>
              ))}
            </section>

            {readme && (
              <section className="space-y-1.5">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">README</div>
                <pre className="whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed">{readme}</pre>
              </section>
            )}
          </div>
        )}
      </div>
      {showPublish && app && (
        <PublishDialog
          folder={folder}
          appName={manifest?.name ?? folder}
          published={!!app.publish}
          onClose={() => setShowPublish(false)}
          onPublished={() => setReloadNonce((n) => n + 1)}
        />
      )}
    </div>
  )
}

function InfoRow({ k, v, mono, link }: { k: string; v: string; mono?: boolean; link?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-28 shrink-0 text-xs text-muted-foreground">{k}</span>
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className={`min-w-0 truncate text-primary hover:underline ${mono ? 'font-mono text-xs' : ''}`}
        >
          {v}
        </a>
      ) : (
        <span className={`min-w-0 truncate ${mono ? 'font-mono text-xs' : ''}`}>{v}</span>
      )}
    </div>
  )
}
