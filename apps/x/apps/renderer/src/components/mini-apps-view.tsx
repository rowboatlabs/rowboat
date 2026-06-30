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
   The accent system (badge/pill/glow/pattern via --accent) is identical in both. */
.ma-page {
  --ma-bg:#f6f6f7;
  --ma-card-from:#ffffff; --ma-card-to:#fbfbfc;
  --ma-card-hover-from:#ffffff; --ma-card-hover-to:#f5f5f7;
  --ma-border:rgba(0,0,0,0.08); --ma-border-hover:rgba(0,0,0,0.14);
  --ma-shadow:0 1px 2px rgba(0,0,0,0.06);
  --ma-title:#101013; --ma-desc:rgba(0,0,0,0.62);
  --ma-h1:#101013; --ma-sub:rgba(0,0,0,0.5); --ma-lastrun:rgba(0,0,0,0.42);
  --ma-off-bg:rgba(0,0,0,0.05); --ma-off-fg:rgba(0,0,0,0.5); --ma-off-dot:rgba(0,0,0,0.4);
  --ma-new-border:rgba(0,0,0,0.14); --ma-new-title:rgba(0,0,0,0.6); --ma-new-hint:rgba(0,0,0,0.4);
  --ma-pat-opacity:0.16; --ma-glow-opacity:0.22; --ma-glow-hover-opacity:0.30;
  --ma-badge-mix:22%; --ma-pill-mix:18%;
  height:100%; overflow:auto; background:var(--ma-bg);
}
.dark .ma-page {
  --ma-bg:#0c0c0e;
  --ma-card-from:#17171B; --ma-card-to:#111114;
  --ma-card-hover-from:#19191e; --ma-card-hover-to:#121215;
  --ma-border:rgba(255,255,255,0.06); --ma-border-hover:rgba(255,255,255,0.09);
  --ma-shadow:0 1px 2px rgba(0,0,0,0.18);
  --ma-title:#f5f5f5; --ma-desc:rgba(255,255,255,0.68);
  --ma-h1:#f5f5f5; --ma-sub:rgba(255,255,255,0.55); --ma-lastrun:rgba(255,255,255,0.4);
  --ma-off-bg:rgba(255,255,255,0.06); --ma-off-fg:rgba(255,255,255,0.5); --ma-off-dot:rgba(255,255,255,0.45);
  --ma-new-border:rgba(255,255,255,0.12); --ma-new-title:rgba(255,255,255,0.6); --ma-new-hint:rgba(255,255,255,0.38);
  --ma-pat-opacity:0.07; --ma-glow-opacity:0.10; --ma-glow-hover-opacity:0.13;
  --ma-badge-mix:15%; --ma-pill-mix:13%;
}
.ma-inner { max-width:1080px; margin:0 auto; padding:32px 28px 48px; }
.ma-h1 { font-size:24px; font-weight:600; letter-spacing:-0.02em; color:var(--ma-h1); margin:0 0 4px; }
.ma-sub { font-size:14px; color:var(--ma-sub); margin:0 0 28px; }
.ma-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:28px; }
@media (max-width:1040px) { .ma-grid { grid-template-columns:repeat(2, 1fr); } }
@media (max-width:700px) { .ma-grid { grid-template-columns:1fr; } }

.ma-card {
  position:relative; min-height:252px; border-radius:20px;
  border:1px solid var(--ma-border);
  background:linear-gradient(160deg, var(--ma-card-from) 0%, var(--ma-card-to) 100%);
  padding:22px; text-align:left; cursor:pointer; overflow:hidden;
  display:flex; flex-direction:column; isolation:isolate;
  box-shadow: var(--ma-shadow), 0 6px 18px -20px var(--glow);
  transition: box-shadow .22s ease, border-color .22s ease, background .22s ease;
}
.ma-card:hover {
  border-color: var(--ma-border-hover);
  background:linear-gradient(160deg, var(--ma-card-hover-from) 0%, var(--ma-card-hover-to) 100%);
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

.ma-title { font-size:22px; font-weight:600; letter-spacing:-0.02em; color:var(--ma-title); margin:18px 0 8px; }
.ma-desc {
  font-size:15px; font-weight:400; line-height:1.45; color:var(--ma-desc); margin:0;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;
}
.ma-footer { margin-top:auto; padding-top:22px; display:flex; align-items:center; justify-content:space-between; gap:12px; }
.ma-source { font-size:12px; font-weight:600; color:var(--accent); background: color-mix(in srgb, var(--accent) var(--ma-pill-mix), transparent); padding:5px 11px; border-radius:999px; }
.ma-lastrun { font-size:12px; color:var(--ma-lastrun); }

.ma-new {
  min-height:252px; border-radius:20px; border:1px dashed var(--ma-new-border);
  background:transparent; display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:8px; color:var(--ma-new-title); cursor:default; transition: border-color .2s ease, color .2s ease;
}
.ma-new-title { font-size:15px; font-weight:600; color:var(--ma-new-title); }
.ma-new-hint { font-size:12px; color:var(--ma-new-hint); }
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

export function MiniAppsView() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [manifests, setManifests] = useState<miniApp.MiniAppManifest[]>([])

  // List apps installed under ~/.rowboat/apps. Apps are created there by the
  // copilot builder (or placed manually); none are bundled in the repo.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await window.ipc.invoke('mini-apps:list', null)
        if (cancelled) return
        setManifests([...r.manifests].sort((a, b) => a.title.localeCompare(b.title)))
      } catch {
        if (!cancelled) setManifests([])
      }
    })()
    return () => { cancelled = true }
  }, [])

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

          {/* Placeholder for copilot-generated apps (Phase 3). */}
          <div className="ma-new">
            <Plus className="size-5" />
            <div className="ma-new-title">New app</div>
            <div className="ma-new-hint">Describe one to the copilot (coming soon)</div>
          </div>
        </div>
      </div>
    </div>
  )
}
