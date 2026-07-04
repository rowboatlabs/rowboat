import { useEffect, useState } from 'react'
import { ArrowLeft, Plus } from 'lucide-react'
import { miniApp } from '@x/shared'
import { MiniAppFrame } from '@/components/mini-app-frame'

// The "Mini Apps" section: a gallery of premium product tiles; click one to open
// the app full-screen. Each card's accent theme and decorative pattern are
// derived deterministically from the app id, so identity comes from colour +
// typography rather than an icon.

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
// Spread accents across the grid by card position so adjacent cards differ and
// the full palette is exercised. Pattern stays tied to id (stable per app).
const themeForIndex = (i: number): Theme => THEMES[i % THEMES.length]
const patternFor = (id: string): string => PATTERNS[hash(id + '·pat') % PATTERNS.length]

// Card styling lives here (precise gradients/glows/patterns are awkward in
// Tailwind tokens). Injected once; per-card accent is passed via CSS variables.
const CARD_CSS = `
/* Light is the baseline; .dark (set on <html>) overrides the surface tokens.
   The accent system (badge/pill/glow/pattern via --accent) is identical in both.
   Surfaces are brushed-metal: a base gradient + a diagonal sheen + a hairline
   top highlight. Sizing responds to the PANE width via container queries. */
.ma-page {
  container-type: inline-size;
  --ma-bg:#eceef1;
  /* metallic silver */
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
  /* metallic gunmetal */
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
.ma-sub { font-size:clamp(13px,1.5cqw,14px); color:var(--ma-sub); margin:0 0 clamp(18px,2.5cqw,28px); }
/* Fluid columns: as many ~250px cards as fit the pane; single column when narrow. */
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
  transition: box-shadow .22s ease, border-color .22s ease, background .22s ease, transform .22s ease;
}
.ma-card:hover {
  border-color: var(--ma-border-hover);
  background:
    linear-gradient(135deg, var(--ma-sheen) 0%, transparent 36%),
    linear-gradient(158deg, color-mix(in srgb, var(--accent) var(--ma-tint-hover), transparent) 0%, transparent 64%),
    linear-gradient(158deg, var(--ma-card-hover-from) 0%, var(--ma-card-hover-mid) 52%, var(--ma-card-hover-to) 100%);
}
/* decorative pattern layer (accent-tinted, very low opacity) */
.ma-card::before {
  content:''; position:absolute; inset:0; z-index:-1; opacity:var(--ma-pat-opacity); pointer-events:none;
}
/* ambient glow blob, top-right */
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

.ma-top { display:flex; justify-content:flex-end; }
.ma-badge {
  display:inline-flex; align-items:center; height:22px; padding:0 10px; border-radius:999px;
  font-size:9.5px; font-weight:600; letter-spacing:0.07em;
  color: var(--accent); background: color-mix(in srgb, var(--accent) var(--ma-badge-mix), transparent);
}
.ma-badge.off { color: var(--ma-off-fg); background: var(--ma-off-bg); }

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
  gap:8px; color:var(--ma-new-title); cursor:pointer; transition: border-color .2s ease, color .2s ease, background .2s ease;
}
.ma-new:hover { border-color:var(--ma-border-hover); background:color-mix(in srgb, var(--accent, #888) 6%, transparent); }
.ma-new-title { font-size:14.5px; font-weight:600; color:var(--ma-new-title); }
.ma-new-hint { font-size:12px; color:var(--ma-new-hint); text-align:center; padding:0 12px; }

/* Very narrow pane: tighten footer so source + last-run don't collide. */
@container (max-width: 380px) {
  .ma-footer { flex-direction:column; align-items:flex-start; gap:6px; }
}
`

function Card({ app, index, onOpen }: { app: miniApp.MiniAppManifest; index: number; onOpen: () => void }) {
  const theme = themeForIndex(index)
  const pattern = patternFor(app.id)
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`ma-card ma-pat-${pattern}`}
      style={{ '--accent': theme.accent, '--glow': theme.glow } as React.CSSProperties}
    >
      <div className="ma-top">
        <span className={`ma-badge${app.active ? '' : ' off'}`}>
          {app.active ? 'ACTIVE' : 'PAUSED'}
        </span>
      </div>
      <div className="ma-title">{app.title}</div>
      <div className="ma-desc">{app.description}</div>
      <div className="ma-footer">
        <span className="ma-source">{app.source}</span>
        <span className="ma-lastrun">Last run {app.lastRun}</span>
      </div>
    </button>
  )
}

export function MiniAppsView({ initialAppId, initialVersion, onNewApp }: { initialAppId?: string | null; initialVersion?: number; onNewApp?: () => void } = {}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialAppId ?? null)
  const [manifests, setManifests] = useState<miniApp.MiniAppManifest[]>([])

  // Open a specific app when asked from outside (app-navigation open-app).
  // Adjust-during-render pattern: react to a new request (version bump) without
  // an effect.
  const [appliedVersion, setAppliedVersion] = useState(initialVersion)
  if (initialVersion !== appliedVersion) {
    setAppliedVersion(initialVersion)
    if (initialAppId) setSelectedId(initialAppId)
  }

  // List apps installed under ~/.rowboat/apps (created by the copilot builder or
  // placed manually; none are bundled in the repo). Keeps the list live as apps
  // are installed/updated, and re-lists on each open-app request (the app may
  // have been installed after this view mounted).
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await window.ipc.invoke('mini-apps:list', null)
        if (!cancelled) setManifests([...r.manifests].sort((a, b) => a.title.localeCompare(b.title)))
      } catch {
        if (!cancelled) setManifests([])
      }
    }
    void load()
    const off = window.ipc.on('mini-apps:appsChanged', () => { void load() })
    return () => { cancelled = true; off() }
  }, [initialVersion])

  const selected = selectedId ? manifests.find((m) => m.id === selectedId) : undefined

  if (selected) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Apps
          </button>
          <span className="text-sm font-medium">{selected.title}</span>
        </div>
        <div className="min-h-0 flex-1">
          <MiniAppFrame manifest={selected} />
        </div>
      </div>
    )
  }

  return (
    <div className="ma-page">
      <style>{CARD_CSS}</style>
      <div className="ma-inner">
        <h1 className="ma-h1">Mini Apps</h1>
        <p className="ma-sub">Little apps that live inside Rowboat, powered by your agents and integrations.</p>

        <div className="ma-grid">
          {manifests.map((m, i) => (
            <Card key={m.id} app={m} index={i} onOpen={() => setSelectedId(m.id)} />
          ))}

          {/* Kick off the copilot builder with a pre-filled prompt. */}
          <button type="button" className="ma-new" onClick={onNewApp}>
            <Plus className="size-5" />
            <div className="ma-new-title">New app</div>
            <div className="ma-new-hint">Describe one to the copilot</div>
          </button>
        </div>
      </div>
    </div>
  )
}
