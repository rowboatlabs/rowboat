import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { BillingInfo, BillingUsageBucket } from '@x/shared/dist/billing.js'
import { sessionResetText, usageHeadline, weekResetText } from '@/lib/usage-reset'

// Settings › Account › usage (Baarali, 02/10/2026): one sentence saying what
// is left, then the 5-hour session and the week, each with the time it starts
// over and a countdown that moves by itself, in GMT.

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

function Row({ label, helper, pct }: { label: string; helper?: string; pct: number }) {
  return (
    <div className="grid grid-cols-1 items-center gap-x-4 gap-y-1.5 py-3 sm:grid-cols-[minmax(0,200px)_1fr_auto]">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {helper && <p className="text-[12px] text-muted-foreground tabular-nums">{helper}</p>}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs tabular-nums text-muted-foreground sm:text-right">{`${pct}% used`}</p>
    </div>
  )
}

export function UsagePanel({ billing, loadedAt, onRefresh, refreshing }: {
  billing: BillingInfo
  /** When the numbers were fetched (ms). */
  loadedAt: number
  onRefresh: () => void
  refreshing: boolean
}) {
  const now = useNow()
  const sessionOpen = !!billing.daily.resetsAt && Date.parse(billing.daily.resetsAt) > now
  const session = sessionOpen ? usedPct(billing.daily) : 0
  const week = usedPct(billing.monthly)
  const minutes = Math.floor((now - loadedAt) / 60_000)
  return (
    <div className="space-y-1 border-t pt-3">
      <p className="text-base font-semibold leading-snug text-balance">{usageHeadline(100 - session, 100 - week, sessionOpen)}</p>
      <div className="divide-y">
        <Row label="5-hour session" helper={sessionResetText(billing.daily.resetsAt, now)} pct={session} />
        <Row label="This week" helper={weekResetText(billing.monthly.resetsAt, now)} pct={week} />
      </div>
      <div className="flex items-center gap-2 pt-1 text-[12px] text-muted-foreground">
        <span>{minutes < 1 ? 'Last updated: just now' : `Last updated: ${minutes} min ago`}</span>
        <button type="button" onClick={onRefresh} disabled={refreshing} aria-label="Refresh" title="Refresh"
          className="inline-flex size-6 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50">
          <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  )
}
