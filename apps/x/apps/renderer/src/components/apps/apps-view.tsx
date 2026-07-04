import { useEffect, useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import type { rowboatApp } from '@x/shared'
import { AppFrame } from '@/components/apps/app-frame'

// Apps home (spec §14): "My apps" grid + Catalog placeholder (M3). Cards are
// AppSummary-driven; click opens the app full-height on its own origin.

type Theme = { accent: string; glow: string }

const THEMES: Theme[] = [
  { accent: '#FF4D8D', glow: 'rgba(255,77,141,0.45)' }, // Pink
  { accent: '#EF4444', glow: 'rgba(239,68,68,0.45)' }, // Red
  { accent: '#22C55E', glow: 'rgba(34,197,94,0.40)' }, // Emerald
  { accent: '#F59E0B', glow: 'rgba(245,158,11,0.42)' }, // Amber
  { accent: '#14B8A6', glow: 'rgba(20,184,166,0.40)' }, // Teal
  { accent: '#EC4899', glow: 'rgba(236,72,153,0.42)' }, // Rose
]
const PATTERNS = ['dots', 'grid', 'diagonal', 'radial', 'waves', 'mesh']

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}
const themeForIndex = (i: number): Theme => THEMES[i % THEMES.length]
const patternFor = (id: string): string => PATTERNS[hash(id + '·pat') % PATTERNS.length]

const CARD_CSS = `
.ma-page {
  container-type: inline-size;
  --ma-bg:#eceef1;
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
.ma-inner { max-width:1120px; margin:0 auto; padding:clamp(20px,3.5cqw,34px) clamp(16px,3cqw,30px) 48px; }
.ma-h1 { font-size:clamp(19px,2.6cqw,24px); font-weight:650; letter-spacing:-0.02em; color:var(--ma-h1); margin:0 0 4px; }
.ma-sub { font-size:clamp(13px,1.5cqw,14px); color:var(--ma-sub); margin:0 0 clamp(14px,2cqw,20px); }
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
.ma-top { display:flex; justify-content:flex-end; gap:6px; }
.ma-badge {
  display:inline-flex; align-items:center; height:22px; padding:0 10px; border-radius:999px;
  font-size:9.5px; font-weight:600; letter-spacing:0.07em;
  color: var(--accent); background: color-mix(in srgb, var(--accent) var(--ma-badge-mix), transparent);
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

function Card({ app, index, onOpen }: { app: rowboatApp.AppSummary; index: number; onOpen: () => void }) {
  const theme = themeForIndex(index)
  const pattern = patternFor(app.folder)
  const invalid = app.status === 'invalid'
  return (
    <button
      type="button"
      onClick={onOpen}
      title={invalid ? app.manifestError : undefined}
      className={`ma-card ma-pat-${pattern}`}
      style={{ '--accent': theme.accent, '--glow': theme.glow } as React.CSSProperties}
    >
      <div className="ma-top">
        {invalid && <span className="ma-badge err">INVALID</span>}
        <span className={`ma-badge${app.kind === 'installed' ? '' : ' off'}`}>
          {app.kind === 'installed' ? 'INSTALLED' : 'LOCAL'}
        </span>
      </div>
      <div className="ma-title">{app.manifest?.name ?? app.folder}</div>
      <div className="ma-desc">{invalid ? (app.manifestError ?? 'Invalid manifest') : (app.manifest?.description || 'No description yet.')}</div>
      <div className="ma-footer">
        <span className="ma-source">v{app.manifest?.version ?? '?'}</span>
        <span className="ma-lastrun">{app.folder}</span>
      </div>
    </button>
  )
}

export function AppsView({ initialAppFolder, initialVersion, onNewApp }: {
  initialAppFolder?: string | null
  initialVersion?: number
  onNewApp?: () => void
} = {}) {
  const [tab, setTab] = useState<'mine' | 'catalog'>('mine')
  const [selectedFolder, setSelectedFolder] = useState<string | null>(initialAppFolder ?? null)
  const [apps, setApps] = useState<rowboatApp.AppSummary[]>([])
  const [serverError, setServerError] = useState<string | null>(null)

  // Open a specific app when asked from outside (app-navigation open-app).
  const [appliedVersion, setAppliedVersion] = useState(initialVersion)
  if (initialVersion !== appliedVersion) {
    setAppliedVersion(initialVersion)
    if (initialAppFolder) setSelectedFolder(initialAppFolder)
  }

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await window.ipc.invoke('apps:list', {})
        if (cancelled) return
        setApps(r.apps)
        setServerError(r.serverRunning ? null : (r.serverError ?? 'Apps server is not running.'))
      } catch (e) {
        if (!cancelled) setServerError(e instanceof Error ? e.message : String(e))
      }
    }
    void load()
    const interval = setInterval(load, 4000) // keep the grid fresh (copilot installs)
    return () => { cancelled = true; clearInterval(interval) }
  }, [initialVersion])

  const selected = selectedFolder ? apps.find((a) => a.folder === selectedFolder) : undefined
  if (selected) {
    return <AppFrame app={selected} onBack={() => setSelectedFolder(null)} />
  }

  return (
    <div className="ma-page">
      <style>{CARD_CSS}</style>
      <div className="ma-inner">
        <h1 className="ma-h1">Apps</h1>
        <p className="ma-sub">Apps that live inside Rowboat, powered by your agents and integrations.</p>

        <div className="ma-tabs">
          <button type="button" className={`ma-tab${tab === 'mine' ? ' on' : ''}`} onClick={() => setTab('mine')}>My apps</button>
          <button type="button" className={`ma-tab${tab === 'catalog' ? ' on' : ''}`} onClick={() => setTab('catalog')}>Catalog</button>
        </div>

        {serverError && (
          <div className="ma-banner">
            <RefreshCw className="mr-1.5 inline size-3.5" /> Apps server unavailable: {serverError}
          </div>
        )}

        {tab === 'catalog' ? (
          <div className="ma-empty">The community catalog is coming soon.</div>
        ) : (
          <div className="ma-grid">
            {apps.map((app, i) => (
              <Card key={app.folder} app={app} index={i} onOpen={() => setSelectedFolder(app.folder)} />
            ))}
            <button type="button" className="ma-new" onClick={onNewApp}>
              <Plus className="size-5" />
              <div className="ma-new-title">New app</div>
              <div className="ma-new-hint">Describe one to the copilot</div>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
