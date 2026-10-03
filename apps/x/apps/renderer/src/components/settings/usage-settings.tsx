import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, Clock, Gift, ImageIcon, Loader2, RefreshCw } from 'lucide-react'
import type { BillingInfo, BillingUsageBucket, MediaCredits } from '@x/shared/dist/billing.js'
import { MediaCreditsPanel } from '@/components/settings/media-credits'
import { getBillingPlanData } from '@x/shared/dist/billing.js'
import { Button } from '@/components/ui/button'
import { useBilling } from '@/hooks/useBilling'
import { openPlans } from '@/lib/plans-window'
import {
  nextSessionText, sessionResetText, sessionStartedText, usageHeadline, weekPaceText, weekResetText,
} from '@/lib/usage-reset'

// Settings › Usage (Baarali, 03/10/2026): its own page, under Account. What
// is left of the 5-hour session and of the week, when each one started and
// starts over, at what pace the week can be spent, and how the limits work.
// The countdowns move by themselves; the numbers refresh every minute.

const usedPct = (b: BillingUsageBucket) =>
  b.sanctionedCredits > 0 ? Math.min(100, Math.max(0, Math.round((b.usedCredits / b.sanctionedCredits) * 100))) : 0

/** Now, again every `everyMs`. */
function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(id)
  }, [everyMs])
  return now
}

function Meter({ title, pct, lines }: { title: string; pct: number; lines: (string | undefined)[] }) {
  return (
    <section className="space-y-2 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-semibold">{title}</h4>
        <span className="text-xs tabular-nums text-muted-foreground">{`${pct}% used`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${pct >= 90 ? 'bg-destructive' : 'bg-primary'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="space-y-0.5">
        {lines.filter(Boolean).map((line) => (
          <p key={line} className="text-[12.5px] tabular-nums text-muted-foreground">{line}</p>
        ))}
      </div>
    </section>
  )
}

function Rule({ icon: Icon, title, text }: { icon: React.ElementType; title: string; text: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="size-3.5 text-muted-foreground" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-[12.5px] text-muted-foreground">{text}</p>
      </div>
    </div>
  )
}

export function UsageView({ billing, media, loadedAt, onRefresh, refreshing }: {
  billing: BillingInfo
  /** Media credits (control /v1/media); null while unknown or when none are served. */
  media?: MediaCredits | null
  loadedAt: number
  onRefresh: () => void
  refreshing: boolean
}) {
  const now = useNow()
  const plan = getBillingPlanData(billing.catalog, billing.subscriptionPlanId)
  const sessionOpen = !!billing.daily.resetsAt && Date.parse(billing.daily.resetsAt) > now
  const session = sessionOpen ? usedPct(billing.daily) : 0
  const week = usedPct(billing.monthly)
  const minutes = Math.floor((now - loadedAt) / 60_000)
  const bonus = billing.store.availableCredits
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {plan?.displayName ?? 'No plan'}
            </span>
          </div>
          <p className="text-base font-semibold leading-snug text-balance">
            {usageHeadline(100 - session, 100 - week, sessionOpen)}
          </p>
        </div>
        {plan?.category !== 'pro' && (
          <Button size="sm" onClick={() => openPlans()}>Upgrade</Button>
        )}
      </div>

      <div className="divide-y">
        <Meter
          title="5-hour session"
          pct={session}
          lines={sessionOpen
            ? [sessionResetText(billing.daily.resetsAt, now), sessionStartedText(billing.daily.resetsAt, now)]
            : [sessionResetText(undefined, now), nextSessionText(now)]}
        />
        <Meter
          title="This week"
          pct={week}
          lines={[weekResetText(billing.monthly.resetsAt, now), weekPaceText(100 - week, billing.monthly.resetsAt, now)]}
        />
        {bonus > 0 && (
          <section className="flex items-center justify-between gap-3 py-4">
            <div className="flex items-center gap-2">
              <Gift className="size-4 text-muted-foreground" />
              <h4 className="text-sm font-semibold">Bonus credits</h4>
            </div>
            <span className="text-sm tabular-nums">{`${bonus} credits`}</span>
          </section>
        )}
      </div>

      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <span>{minutes < 1 ? 'Last updated: just now' : `Last updated: ${minutes} min ago`}</span>
        <button type="button" onClick={onRefresh} disabled={refreshing} aria-label="Refresh" title="Refresh"
          className="inline-flex size-6 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50">
          <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {media && <div className="mt-4"><MediaCreditsPanel media={media} /></div>}

      <div className="mt-4 space-y-3 rounded-lg bg-muted/40 p-4">
        <h4 className="text-sm font-semibold">How the limits work</h4>
        <Rule icon={Clock} title="A session lasts 5 hours"
          text="It opens with your first message. When it ends, your next message opens a new one, with everything available again." />
        <Rule icon={CalendarDays} title="The week renews by itself"
          text="Seven days after it began, the week starts over. If it runs out before then, wait for the renewal or move to a bigger plan." />
        <Rule icon={ImageIcon} title="Images, videos and voices are separate"
          text="They are paid with media credits, which these limits do not touch." />
      </div>
    </div>
  )
}

export function UsageSettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [connected, setConnected] = useState<boolean | null>(null)
  useEffect(() => {
    if (!dialogOpen) return
    void window.ipc.invoke('oauth:getState', null).then(
      (result) => setConnected(result.config?.rowboat?.connected ?? false),
      () => setConnected(false),
    )
  }, [dialogOpen])
  const { billing, isLoading, refresh } = useBilling(connected === true)
  // When the numbers on screen were fetched: « Last updated » counts from it.
  const [loadedAt, setLoadedAt] = useState(() => Date.now())
  const [media, setMedia] = useState<MediaCredits | null>(null)
  const reload = useCallback(async () => {
    const [, nextMedia] = await Promise.all([
      refresh(),
      window.ipc.invoke('billing:getMedia', null).catch(() => null),
    ])
    setMedia(nextMedia)
    setLoadedAt(Date.now())
  }, [refresh])
  // The media credits once the page opens; the minute refresh brings them again.
  useEffect(() => {
    if (!dialogOpen || connected !== true) return
    let live = true
    void window.ipc.invoke('billing:getMedia', null).then((next) => live && setMedia(next), () => {})
    return () => { live = false }
  }, [dialogOpen, connected])
  // Fresh numbers every minute while the page is open.
  useEffect(() => {
    if (!dialogOpen || connected !== true) return
    const id = window.setInterval(() => void reload(), 60_000)
    return () => window.clearInterval(id)
  }, [dialogOpen, connected, reload])

  if (connected === null || (isLoading && !billing)) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!connected) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Log in to your account to see your usage.</p>
  }
  if (!billing) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Unable to load plan details</p>
  }
  return <UsageView billing={billing} media={media} loadedAt={loadedAt} onRefresh={() => void reload()} refreshing={isLoading} />
}
