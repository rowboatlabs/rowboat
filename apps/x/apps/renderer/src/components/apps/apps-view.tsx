import { useEffect, useState } from 'react'
import { PanelLeft, PanelLeftClose, Plus, Search } from 'lucide-react'
import type { rowboatApp } from '@x/shared'
import { AppIcon, appTitle } from './app-icon'
import { NewAppDialog } from '@/components/apps/new-app-dialog'
import {
  useAppActivity,
  type AppActivity
} from '@/components/apps/app-activity'
import { getAppHistory, rememberApp } from '@/lib/app-history'
import { AppFrame } from '@/components/apps/app-frame'
import { CatalogTab } from '@/components/apps/catalog'
import { themeForIndex, patternFor } from '@/components/apps/card-theme'
import {
  getPinnedApps,
  onPinnedAppsChanged,
  pinApp,
  unpinApp
} from '@/lib/pinned-apps'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'

// Apps home (spec §14): "My apps" grid + Catalog placeholder (M3). Cards are
// AppSummary-driven; click opens the app full-height on its own origin.

const CARD_CSS = `
.ma-page {
  container-type: inline-size;
  --ma-bg:#f8f8f9;
  --ma-card-from:#ffffff; --ma-card-mid:#f2f3f6; --ma-card-to:#e6e8ee;
  --ma-card-hover-from:#ffffff; --ma-card-hover-mid:#f5f6f9; --ma-card-hover-to:#eaecf1;
  --ma-sheen:rgba(255,255,255,0.55); --ma-top-highlight:rgba(255,255,255,0.9);
  --ma-border:rgba(0,0,0,0.09); --ma-border-hover:rgba(0,0,0,0.15);
  --ma-shadow:0 1px 2px rgba(0,0,0,0.08);
  --ma-title:#0d0e11; --ma-desc:rgba(0,0,0,0.6);
  --ma-h1:#0d0e11; --ma-sub:rgba(0,0,0,0.5); --ma-lastrun:rgba(0,0,0,0.42);
  --ma-off-bg:rgba(0,0,0,0.05); --ma-off-fg:rgba(0,0,0,0.5);
  --ma-new-border:rgba(0,0,0,0.14); --ma-new-title:rgba(0,0,0,0.6); --ma-new-hint:rgba(0,0,0,0.4);
  --ma-pat-opacity:0.10; --ma-glow-opacity:0.16; --ma-glow-hover-opacity:0.24;
  --ma-badge-mix:20%; --ma-pill-mix:16%; --ma-tint:16%; --ma-tint-hover:22%;
  height:100%; overflow:auto; background:var(--ma-bg);
}
.dark .ma-page {
  --ma-bg:#0b0b0d;
  --ma-card-from:#262930; --ma-card-mid:#191b21; --ma-card-to:#101116;
  --ma-card-hover-from:#2b2e36; --ma-card-hover-mid:#1c1e25; --ma-card-hover-to:#131419;
  --ma-sheen:rgba(255,255,255,0.07); --ma-top-highlight:rgba(255,255,255,0.09);
  --ma-border:rgba(255,255,255,0.07); --ma-border-hover:rgba(255,255,255,0.12);
  --ma-shadow:0 1px 2px rgba(0,0,0,0.35);
  --ma-title:#f4f5f7; --ma-desc:rgba(255,255,255,0.66);
  --ma-h1:#f4f5f7; --ma-sub:rgba(255,255,255,0.52); --ma-lastrun:rgba(255,255,255,0.38);
  --ma-off-bg:rgba(255,255,255,0.06); --ma-off-fg:rgba(255,255,255,0.5);
  --ma-new-border:rgba(255,255,255,0.12); --ma-new-title:rgba(255,255,255,0.6); --ma-new-hint:rgba(255,255,255,0.38);
  --ma-pat-opacity:0.05; --ma-glow-opacity:0.10; --ma-glow-hover-opacity:0.16;
  --ma-badge-mix:15%; --ma-pill-mix:13%; --ma-tint:20%; --ma-tint-hover:26%;
}
.ma-inner { max-width:1120px; margin:0 auto; padding:34px 30px 48px; }
.ma-h1 { font-size:24px; font-weight:650; letter-spacing:-0.02em; color:var(--ma-h1); margin:0 0 4px; }
.ma-sub { font-size:clamp(13px,1.5cqw,14px); color:var(--ma-sub); margin:0 0 clamp(14px,2cqw,20px); }
.ma-hint { font-size:12.5px; color:var(--ma-sub); margin:-6px 0 clamp(12px,1.8cqw,16px); }
.ma-welcome {
  border:1px solid var(--ma-border); border-radius:12px; padding:12px 16px;
  font-size:13.5px; color:var(--ma-desc); margin-bottom:clamp(14px,2cqw,20px);
  background:color-mix(in srgb, var(--ma-title) 4%, transparent);
}
.ma-welcome button { color:var(--ma-title); font-weight:600; text-decoration:underline; text-underline-offset:3px; background:none; border:none; padding:0; font-size:inherit; cursor:pointer; }
.ma-owner { font-size:12px; color:var(--ma-sub); margin:-4px 0 8px; }
.ma-tabs { display:flex; gap:6px; margin-bottom:clamp(14px,2cqw,22px); }
.ma-tab { border:1px solid var(--ma-border); background:transparent; color:var(--ma-sub); border-radius:999px; padding:5px 14px; font-size:13px; font-weight:600; cursor:pointer; }
.ma-tab.on { color:var(--ma-title); border-color:var(--ma-border-hover); background:color-mix(in srgb, var(--ma-title) 6%, transparent); }
.ma-banner { border:1px solid rgba(239,68,68,.4); background:rgba(239,68,68,.1); color:var(--ma-title); border-radius:12px; padding:10px 14px; font-size:13px; margin-bottom:16px; }
.ma-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%,248px),1fr)); gap:clamp(14px,2cqw,24px); }
.ma-card {
  position:relative; min-height:clamp(190px,24cqw,244px); border-radius:18px;
  border:1px solid var(--ma-border);
  background:
    linear-gradient(135deg, var(--ma-sheen) 0%, transparent 34%),
    linear-gradient(158deg, color-mix(in srgb, var(--accent) var(--ma-tint), transparent) 0%, transparent 62%),
    linear-gradient(158deg, var(--ma-card-from) 0%, var(--ma-card-mid) 52%, var(--ma-card-to) 100%);
  padding:clamp(15px,2cqw,22px); text-align:left; cursor:pointer; overflow:hidden;
  display:flex; flex-direction:column; isolation:isolate;
  box-shadow: var(--ma-shadow), inset 0 1px 0 var(--ma-top-highlight), 0 8px 22px -20px var(--glow);
  transition: box-shadow .22s ease, border-color .22s ease, background .22s ease;
}
.ma-card:hover {
  border-color: var(--ma-border-hover);
  background:
    linear-gradient(135deg, var(--ma-sheen) 0%, transparent 36%),
    linear-gradient(158deg, color-mix(in srgb, var(--accent) var(--ma-tint-hover), transparent) 0%, transparent 64%),
    linear-gradient(158deg, var(--ma-card-hover-from) 0%, var(--ma-card-hover-mid) 52%, var(--ma-card-hover-to) 100%);
}
.ma-card::before { content:''; position:absolute; inset:0; z-index:-1; opacity:var(--ma-pat-opacity); pointer-events:none; }
.ma-card::after {
  content:''; position:absolute; top:-45%; right:-25%; width:75%; height:75%; z-index:-1;
  background: radial-gradient(circle, var(--accent) 0%, transparent 70%);
  opacity:var(--ma-glow-opacity); filter: blur(18px); pointer-events:none; transition: opacity .22s ease;
}
.ma-card:hover::after { opacity:var(--ma-glow-hover-opacity); }
.ma-pat-dots::before { background-image: radial-gradient(var(--accent) 1px, transparent 1.4px); background-size:16px 16px; }
.ma-pat-grid::before { background-image: linear-gradient(var(--accent) 1px, transparent 1px), linear-gradient(90deg, var(--accent) 1px, transparent 1px); background-size:26px 26px; }
.ma-pat-diagonal::before { background-image: repeating-linear-gradient(45deg, var(--accent) 0 1px, transparent 1px 14px); }
.ma-pat-radial::before { background-image: radial-gradient(circle at 78% 18%, var(--accent) 0%, transparent 55%); opacity:calc(var(--ma-pat-opacity) + 0.05); }
.ma-pat-waves::before { background-image: repeating-radial-gradient(circle at 50% -30%, transparent 0 20px, var(--accent) 20px 21px); }
.ma-pat-mesh::before { background-image: radial-gradient(circle at 12% 18%, var(--accent) 0%, transparent 42%), radial-gradient(circle at 88% 82%, var(--accent) 0%, transparent 42%); opacity:calc(var(--ma-pat-opacity) + 0.03); }
.ma-pat-cross::before { background-image: repeating-linear-gradient(45deg, var(--accent) 0 1px, transparent 1px 18px), repeating-linear-gradient(-45deg, var(--accent) 0 1px, transparent 1px 18px); }
.ma-pat-rings::before { background-image: repeating-radial-gradient(circle at 82% 20%, transparent 0 14px, var(--accent) 14px 15px); }
.ma-pat-zigzag::before { background-image: linear-gradient(135deg, var(--accent) 25%, transparent 25%), linear-gradient(225deg, var(--accent) 25%, transparent 25%); background-size: 22px 12px; background-position: 0 0, 11px 0; opacity:calc(var(--ma-pat-opacity) - 0.03); }
.ma-pat-plus::before { background-image: radial-gradient(var(--accent) 0.8px, transparent 1px), linear-gradient(var(--accent) 1px, transparent 1px), linear-gradient(90deg, var(--accent) 1px, transparent 1px); background-size: 24px 24px, 24px 24px, 24px 24px; background-position: 12px 12px, 0 11.5px, 11.5px 0; opacity:calc(var(--ma-pat-opacity) - 0.02); }
.ma-pat-checker::before { background-image: repeating-conic-gradient(var(--accent) 0% 25%, transparent 0% 50%); background-size: 26px 26px; opacity:calc(var(--ma-pat-opacity) - 0.04); }
.ma-pat-beams::before { background-image: repeating-linear-gradient(100deg, var(--accent) 0 2px, transparent 2px 34px); }
.ma-top { display:flex; justify-content:flex-end; gap:6px; }
.ma-badge {
  display:inline-flex; align-items:center; height:22px; padding:0 10px; border-radius:999px;
  font-size:11px; font-weight:600; letter-spacing:0;
  color: var(--ma-title); background: color-mix(in srgb, var(--ma-title) 7%, transparent);
}
.ma-badge.off { color: var(--ma-off-fg); background: var(--ma-off-bg); }
.ma-badge.err { color:#ef4444; background:rgba(239,68,68,.14); }
.ma-title { font-size:clamp(17px,2.3cqw,21px); font-weight:600; letter-spacing:-0.02em; color:var(--ma-title); margin:clamp(12px,2cqw,18px) 0 8px; }
.ma-desc {
  font-size:clamp(13px,1.5cqw,14.5px); font-weight:400; line-height:1.45; color:var(--ma-desc); margin:0;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;
}
.ma-footer { margin-top:auto; padding-top:clamp(14px,2cqw,22px); display:flex; align-items:center; justify-content:space-between; gap:10px; }
.ma-source { font-size:11.5px; font-weight:600; color:var(--accent); background: color-mix(in srgb, var(--accent) var(--ma-pill-mix), transparent); padding:5px 10px; border-radius:999px; white-space:nowrap; }
.ma-lastrun { font-size:11.5px; color:var(--ma-lastrun); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ma-new {
  width:100%; font:inherit; min-height:clamp(190px,24cqw,244px); border-radius:18px; border:1px dashed var(--ma-new-border);
  background:transparent; display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:8px; color:var(--ma-new-title); cursor:pointer; transition: border-color .2s ease, background .2s ease;
}
.ma-new:hover { border-color:var(--ma-border-hover); background:color-mix(in srgb, var(--accent, #888) 6%, transparent); }
.ma-new-title { font-size:14.5px; font-weight:600; color:var(--ma-new-title); }
.ma-new-hint { font-size:12px; color:var(--ma-new-hint); text-align:center; padding:0 12px; }
.ma-empty { padding:36px 8px; text-align:center; color:var(--ma-sub); font-size:14px; grid-column:1/-1; }
@container (max-width: 380px) {
  .ma-footer { flex-direction:column; align-items:flex-start; gap:6px; }
}
`

function Card({
  app,
  index,
  onOpen,
  isPinned,
  onTogglePin,
  activity
}: {
  app: rowboatApp.AppSummary
  index: number
  onOpen: () => void
  isPinned: boolean
  onTogglePin: () => void
  activity: AppActivity
}) {
  // Identity determines the color, so sorting and filtering don't recolor apps.
  const identity = [...app.folder].reduce((n, c) => n + c.charCodeAt(0), 0)
  const theme = themeForIndex(identity)
  const tasks = activity.tasks.filter((t) => app.agentSlugs.includes(t.slug))
  const running = tasks.some((t) => activity.running(t.slug))
  const failed =
    tasks.some((t) => activity.failure(t)) ||
    app.readiness === 'error' ||
    app.status === 'invalid' ||
    !!getAppHistory()[app.folder]?.runtimeError
  const label = running
    ? 'Updating…'
    : failed
      ? 'Needs attention'
      : app.readiness === 'building'
        ? 'Building'
        : app.readiness === 'setup'
          ? 'Needs setup'
          : 'Ready to open'
  const updated = app.dataUpdatedAt
    ? new Date(app.dataUpdatedAt).toLocaleString()
    : null
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={`ma-card ma-pat-${patternFor(app.folder)}`}
          style={
            {
              '--accent': theme.accent,
              '--glow': theme.glow
            } as React.CSSProperties
          }
        >
          <div className="flex items-center justify-between gap-2">
            <AppIcon
              name={app.manifest?.name ?? app.folder}
              src={
                app.manifest?.icon
                  ? `${app.origin}/${app.manifest.icon}`
                  : undefined
              }
            />
            <button
              type="button"
              onClick={onTogglePin}
              aria-label={isPinned ? 'Remove from sidebar' : 'Add to sidebar'}
              aria-pressed={isPinned}
              title={isPinned ? 'Remove from sidebar' : 'Add to sidebar'}
              className="rounded-md p-2 hover:bg-accent"
            >
              {isPinned ? (
                <PanelLeftClose className="size-4" />
              ) : (
                <PanelLeft className="size-4" />
              )}
            </button>
          </div>
          <button
            type="button"
            onClick={onOpen}
            className="flex flex-1 flex-col text-left after:absolute after:inset-x-0 after:bottom-0 after:top-16"
            aria-label={`Open ${app.manifest?.name ?? app.folder}`}
          >
            <div className="ma-title">
              {appTitle(app.manifest?.name ?? app.folder)}
            </div>
            <div className="ma-desc">
              {app.manifest?.description || 'Open your app to get started.'}
            </div>
            <div className="ma-footer w-full">
              <span className={`ma-badge${failed ? ' err' : ''}`}>{label}</span>
              <span className="ma-lastrun" title={updated ?? undefined}>
                {updated
                  ? `Updated ${new Date(app.dataUpdatedAt!).toLocaleDateString()}`
                  : index === 0 && getAppHistory()[app.folder]?.openedAt
                    ? 'Recently used'
                    : app.kind === 'local'
                      ? 'Created by you'
                      : 'From catalog'}
              </span>
            </div>
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onTogglePin}>
          {isPinned ? 'Remove from sidebar' : 'Add to sidebar'}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function AppsView({
  initialAppFolder,
  initialVersion,
  onBuildApp,
  onEditApp,
  onContinueApp
}: {
  initialAppFolder?: string | null
  initialVersion?: number
  onBuildApp: (prompt: string, folder: string) => void
  onEditApp: (app: rowboatApp.AppSummary, problem?: string) => void
  onContinueApp: (app: rowboatApp.AppSummary) => void
}) {
  const [tab, setTab] = useState<'mine' | 'catalog'>('mine')
  const [selectedFolder, setSelectedFolder] = useState<string | null>(
    initialAppFolder ?? null
  )
  const [apps, setApps] = useState<rowboatApp.AppSummary[]>([])
  const [appsLoaded, setAppsLoaded] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [pinnedFolders, setPinnedFolders] = useState<string[]>(() =>
    getPinnedApps()
  )
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('recent')
  const [refreshNonce, setRefreshNonce] = useState(0)
  const activity = useAppActivity()
  useEffect(() => onPinnedAppsChanged(setPinnedFolders), [])
  const [appliedVersion, setAppliedVersion] = useState(initialVersion)
  if (initialVersion !== appliedVersion) {
    setAppliedVersion(initialVersion)
    setSelectedFolder(initialAppFolder ?? null)
  }
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const r = await window.ipc.invoke('apps:list', {})
        if (cancelled) return
        setApps(r.apps)
        setAppsLoaded(true)
        if (r.serverRunning) {
          const live = new Set(r.apps.map((a) => a.folder))
          for (const f of getPinnedApps()) if (!live.has(f)) unpinApp(f)
        }
        setServerError(
          r.serverRunning
            ? null
            : (r.serverError ?? 'Apps server is not running.')
        )
      } catch (e) {
        if (!cancelled)
          setServerError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) timer = setTimeout(load, 4000)
      }
    }
    void load()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [initialVersion, refreshNonce])
  const open = (folder: string) => {
    rememberApp(folder, { openedAt: Date.now() })
    setSelectedFolder(folder)
  }
  const selected = selectedFolder
    ? apps.find((a) => a.folder === selectedFolder)
    : undefined
  const history = getAppHistory()
  const filtered = apps
    .filter((a) =>
      `${a.manifest?.name} ${a.manifest?.description} ${a.folder}`
        .toLowerCase()
        .includes(query.toLowerCase())
    )
    .sort((a, b) =>
      sort === 'recent'
        ? (history[b.folder]?.openedAt ?? 0) -
            (history[a.folder]?.openedAt ?? 0) ||
          a.folder.localeCompare(b.folder)
        : (a.manifest?.name ?? a.folder).localeCompare(
            b.manifest?.name ?? b.folder
          )
    )
  return (
    <>
      {selected ? (
        <AppFrame
          key={selected.folder}
          app={selected}
          activity={activity}
          serverError={serverError}
          onBack={() => {
            setSelectedFolder(null)
            setRefreshNonce((n) => n + 1)
          }}
          onEdit={(problem) => onEditApp(selected, problem)}
          onContinue={() => onContinueApp(selected)}
        />
      ) : (
        <div className="ma-page">
          <style>{CARD_CSS}</style>
          <div className="ma-inner">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h1 className="ma-h1">Apps</h1>
                <p className="ma-sub">
                  Your own tools, built around the way you work.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                <Plus className="size-4" />
                New app
              </button>
            </div>
            <div className="ma-tabs" role="tablist" aria-label="App library">
              <button
                role="tab"
                aria-selected={tab === 'mine'}
                className={`ma-tab${tab === 'mine' ? ' on' : ''}`}
                onClick={() => setTab('mine')}
              >
                My apps
              </button>
              <button
                role="tab"
                aria-selected={tab === 'catalog'}
                className={`ma-tab${tab === 'catalog' ? ' on' : ''}`}
                onClick={() => setTab('catalog')}
              >
                Catalog
              </button>
            </div>
            {serverError && (
              <div role="alert" className="ma-banner">
                Apps are unavailable: {serverError}{' '}
                <button
                  className="ml-2 underline"
                  onClick={() => setRefreshNonce((n) => n + 1)}
                >
                  Try again
                </button>
              </div>
            )}
            {selectedFolder && appsLoaded && !selected && (
              <div className="mb-4 rounded-lg border p-3 text-sm">
                {serverError
                  ? 'Waiting to reconnect to your app.'
                  : 'This app is not available yet or has been removed.'}
                <button
                  onClick={() => setSelectedFolder(null)}
                  className="ml-2 underline"
                >
                  Back to library
                </button>
              </div>
            )}
            {tab === 'catalog' ? (
              <CatalogTab
                onInstalled={(folder) => {
                  setRefreshNonce((n) => n + 1)
                  open(folder)
                  setTab('mine')
                }}
              />
            ) : !appsLoaded && !serverError ? (
              <p
                role="status"
                className="py-12 text-center text-muted-foreground"
              >
                Loading your apps…
              </p>
            ) : (
              <>
                {apps.length > 0 ? (
                  <div className="mb-5 flex gap-3">
                    <label className="relative flex-1">
                      <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
                      <input
                        aria-label="Search my apps"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Find an app…"
                        className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm"
                      />
                    </label>
                    <select
                      aria-label="Sort apps"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                      className="rounded-lg border bg-background px-3 text-sm"
                    >
                      <option value="recent">Recently used</option>
                      <option value="name">Name</option>
                    </select>
                  </div>
                ) : (
                  !serverError && (
                    <div className="mb-6 rounded-xl border p-6">
                      <h2 className="mb-2 text-lg font-semibold">
                        Make a tool you’ll use every day
                      </h2>
                      <p className="mb-4 text-sm text-muted-foreground">
                        A daily briefing, a project dashboard, or a personal
                        tracker. Start with an idea, then shape it with the
                        copilot.
                      </p>
                      <button
                        className="mr-4 text-sm font-medium underline"
                        onClick={() => setCreating(true)}
                      >
                        Build your first app
                      </button>
                      <button
                        className="text-sm underline"
                        onClick={() => setTab('catalog')}
                      >
                        Explore ready-made apps
                      </button>
                    </div>
                  )
                )}
                <div className="ma-grid">
                  {filtered.map((app, i) => (
                    <Card
                      key={app.folder}
                      app={app}
                      index={i}
                      activity={activity}
                      onOpen={() => open(app.folder)}
                      isPinned={pinnedFolders.includes(app.folder)}
                      onTogglePin={() =>
                        pinnedFolders.includes(app.folder)
                          ? unpinApp(app.folder)
                          : pinApp(app.folder)
                      }
                    />
                  ))}
                  {query && !filtered.length && (
                    <p className="ma-empty">
                      No apps match “{query}”.{' '}
                      <button
                        className="underline"
                        onClick={() => setQuery('')}
                      >
                        Clear search
                      </button>
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {creating && (
        <NewAppDialog
          onClose={() => setCreating(false)}
          onBuild={(prompt, folder) => {
            setRefreshNonce((n) => n + 1)
            open(folder)
            onBuildApp(prompt, folder)
          }}
        />
      )}
    </>
  )
}
