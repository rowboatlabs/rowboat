import { useEffect, useState } from 'react'
import type { BillingInfo } from '@x/shared/dist/billing.js'
import { openPlans } from '@/lib/plans-window'
import { sessionCountdown, weekShortText } from '@/lib/usage-reset'

// The bottom of the sidebar (Baarali, 02/10/2026): how much of the 5-hour
// session is spent and when it starts over, counting down by itself, then
// what is left of the week (03/10/2026); a click opens Settings › Usage. The
// upgrade pill wraps under the text when the sidebar is narrow instead of
// writing over the plan's name, which the upstream row did.

/** Now, again every 30 seconds: enough for a countdown in minutes. */
function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(id)
  }, [everyMs])
  return now
}

export function SessionGauge({ billing, upgradeLabel, onOpenUsage }: { billing: BillingInfo; upgradeLabel: string; onOpenUsage?: () => void }) {
  const now = useNow()
  const { usedCredits, sanctionedCredits, resetsAt } = billing.daily
  const open = !!resetsAt && Date.parse(resetsAt) > now
  const pct = open && sanctionedCredits > 0 ? Math.min(100, Math.round((usedCredits / sanctionedCredits) * 100)) : 0
  const week = billing.monthly.sanctionedCredits > 0
    ? Math.min(100, Math.round((billing.monthly.usedCredits / billing.monthly.sanctionedCredits) * 100))
    : 0
  return (
    <div className="px-3 py-2">
      <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/20 px-3 py-2">
        <button type="button" onClick={onOpenUsage} title="Usage" className="block w-full text-left">
          <div className="flex items-center justify-between gap-2 text-xs text-sidebar-foreground">
            <span className="truncate">5-hour session</span>
            <span className="shrink-0 tabular-nums">{`${pct}%`}</span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-sidebar-foreground/10">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground tabular-nums">{sessionCountdown(resetsAt, now)}</div>
          <div className="text-[11px] leading-snug text-muted-foreground tabular-nums">{weekShortText(100 - week, billing.monthly.resetsAt, now)}</div>
        </button>
        <div className="mt-1.5 flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5">
          <button
            type="button"
            onClick={() => openPlans()}
            className="rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {upgradeLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
