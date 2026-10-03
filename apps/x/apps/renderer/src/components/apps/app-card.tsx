import type { CSSProperties, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { Access } from '@/components/apps/fiches'
import type { CardTheme } from '@/components/apps/card-theme'

// Baarali (02/10/2026): one card for the catalog and for « My apps ». A
// tinted band with the app's icon, its name, who made it, what it is for,
// what it reaches, then the action. The upstream card showed a package name,
// the publisher's English sentence and a GitHub path.

export const FICHE_CSS = `
.ma-card.fc { padding:0; min-height:0; }
.fc-cover { position:relative; height:64px; flex-shrink:0;
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 22%, transparent), color-mix(in srgb, var(--accent) 8%, transparent)); }
.fc-tile { position:absolute; left:18px; bottom:-20px; width:44px; height:44px; border-radius:13px; display:grid; place-items:center;
  background:var(--ma-card-from); color:var(--accent); box-shadow:0 4px 14px -6px rgba(0,0,0,.35), inset 0 0 0 1px var(--ma-border);
  transition: transform .25s cubic-bezier(.2,.8,.3,1); }
.ma-card.fc:hover .fc-tile { transform: scale(1.06) rotate(-3deg); }
.fc-corner { position:absolute; right:12px; top:10px; display:flex; gap:6px; align-items:center; }
.fc-body { padding:30px 18px 16px; display:flex; flex-direction:column; gap:6px; flex:1; }
.fc-body .ma-title { margin:0; font-size:16px; }
.fc-by { font-size:12px; color:var(--ma-sub); margin-top:-3px; }
.fc-body .ma-desc { font-size:13.5px; }
.fc-chips { display:flex; flex-wrap:wrap; gap:5px; margin-top:2px; }
.fc-chip { font-size:11.5px; padding:2px 8px; border-radius:999px; background:var(--ma-off-bg); color:var(--ma-off-fg); white-space:nowrap; }
.fc-chip.account { background:rgba(245,158,11,.14); color:#b45309; }
.dark .fc-chip.account { color:#fbbf24; }
.fc-chip.agent { background:color-mix(in srgb, var(--primary) 14%, transparent); color:var(--primary); }
.fc-body .ma-footer { padding-top:10px; }
.ma-card.fc { transition: transform .2s cubic-bezier(.2,.8,.3,1), box-shadow .22s ease, border-color .22s ease, background .22s ease; }
.ma-card.fc:hover { transform: translateY(-2px); }
.fc-shelves { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:16px; }
.fc-shelf { border:1px solid var(--ma-border); background:transparent; color:var(--ma-sub); border-radius:999px; padding:4px 12px; font-size:12.5px; cursor:pointer; }
.fc-shelf.on { border-color:var(--primary); color:var(--primary); background:color-mix(in srgb, var(--primary) 10%, transparent); font-weight:600; }
.fc-more { margin-top:28px; font-size:13px; color:var(--ma-sub); background:none; border:none; padding:0; cursor:pointer; text-decoration:underline; text-underline-offset:3px; }
.fc-section { font-size:14px; font-weight:600; color:var(--ma-title); margin:28px 0 12px; }
`

export function AppCard({ theme, icon: Icon, title, by, summary, access, corner, footer, onOpen, label }: {
  theme: CardTheme
  icon: LucideIcon
  title: string
  by: ReactNode
  summary: string
  access: Access[]
  corner?: ReactNode
  footer: ReactNode
  onOpen: () => void
  /** Hover text, e.g. the reason a local app is invalid. */
  label?: string
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      title={label}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className="ma-card fc"
      style={{ '--accent': theme.accent, '--glow': theme.glow } as CSSProperties}
    >
      <div className="fc-cover">
        <span className="fc-tile"><Icon className="size-5" /></span>
        {corner && <div className="fc-corner">{corner}</div>}
      </div>
      <div className="fc-body">
        <div className="ma-title">{title}</div>
        <div className="fc-by">{by}</div>
        <div className="ma-desc">{summary}</div>
        <div className="fc-chips">
          {access.map((a) => <span key={a.label} className={`fc-chip${a.tone === 'plain' ? '' : ` ${a.tone}`}`}>{a.label}</span>)}
        </div>
        <div className="ma-footer">{footer}</div>
      </div>
    </div>
  )
}
