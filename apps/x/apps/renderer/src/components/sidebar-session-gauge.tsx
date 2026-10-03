import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { BillingInfo, BillingUsageBucket } from '@x/shared/dist/billing.js'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { openPlans } from '@/lib/plans-window'
import { sessionCountdown, weekResetText } from '@/lib/usage-reset'

// The usage, as a ring at the bottom of the sidebar (Baarali, 03/10/2026):
// the block that sat there took room the founder wanted back. The ring shows
// the session spent; a click opens what the block said, and a little more:
// the plan's limits, the session and the week with when they start over,
// the way to the usage page and to a bigger plan.

const usedPct = (b: BillingUsageBucket) =>
  b.sanctionedCredits > 0 ? Math.min(100, Math.max(0, Math.round((b.usedCredits / b.sanctionedCredits) * 100))) : 0

/** Now, again every 30 seconds: enough for a countdown in minutes. */
function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(id)
  }, [everyMs])
  return now
}

/** A ring filled to `pct`, red once nearly spent. */
function Ring({ pct }: { pct: number }) {
  const r = 7
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 18 18" className="size-[18px] -rotate-90" aria-hidden="true">
      <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.2" />
      <circle
        cx="9" cy="9" r={r} fill="none" strokeWidth="2.2" strokeLinecap="round"
        className={pct >= 90 ? 'stroke-destructive' : 'stroke-primary'}
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
      />
    </svg>
  )
}

function Line({ label, right, pct }: { label: string; right: string; pct: number }) {
  return (
    <div className="space-y-1.5 py-2">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="truncate">{label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{right}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-foreground/10">
        <div className={`h-full rounded-full ${pct >= 90 ? 'bg-destructive' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function UsagePopover({ billing, planName, upgradeLabel, onOpenUsage }: {
  billing: BillingInfo
  planName: string | null
  upgradeLabel: string
  onOpenUsage?: () => void
}) {
  const now = useNow()
  const open = !!billing.daily.resetsAt && Date.parse(billing.daily.resetsAt) > now
  const session = open ? usedPct(billing.daily) : 0
  const week = usedPct(billing.monthly)
  const weekWhen = weekResetText(billing.monthly.resetsAt, now)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Usage" title="Usage"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
          <Ring pct={session} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 p-3">
        <button type="button" onClick={onOpenUsage}
          className="flex w-full items-center justify-between gap-2 pb-1 text-left text-[12.5px] text-muted-foreground hover:text-foreground">
          <span className="truncate">{planName ? `Plan usage limits · ${planName}` : 'Plan usage limits'}</span>
          <ChevronRight className="size-3.5 shrink-0" />
        </button>
        <Line label="5-hour session" right={`${session}%`} pct={session} />
        <p className="-mt-1 pb-1 text-[11.5px] tabular-nums text-muted-foreground">{sessionCountdown(billing.daily.resetsAt, now)}</p>
        <div className="border-t" />
        <Line label="This week" right={`${week}%`} pct={week} />
        {weekWhen && <p className="-mt-1 pb-1 text-[11.5px] tabular-nums text-muted-foreground">{weekWhen}</p>}
        <div className="mt-2 flex items-center justify-between gap-2 border-t pt-3">
          <button type="button" onClick={onOpenUsage} className="text-[12.5px] text-primary hover:underline">See usage</button>
          <button type="button" onClick={() => openPlans()}
            className="rounded-full bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90">
            {upgradeLabel}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
