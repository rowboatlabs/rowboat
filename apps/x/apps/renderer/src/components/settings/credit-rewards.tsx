"use client"

import { Check, Gift } from "lucide-react"
import { cn } from "@/lib/utils"
import { CREDIT_ACTIVITY_ICONS, useCreditsState } from "@/hooks/use-credits-state"
import { formatCreditsAsDollars } from "@x/shared/dist/credits.js"
import type { BillingStoreBucket } from "@x/shared/dist/billing.js"

interface CreditRewardsProps {
  // bonus-credit balance from billing info; null while billing is loading
  store: BillingStoreBucket | null
}

/**
 * "Earn credits" settings section: the first-time actions that grant bonus
 * credits, which are done, and the current bonus balance. Claimed state
 * refreshes live when a `credits:didActivate` event arrives (the parent
 * refreshes the balance itself).
 */
export function CreditRewards({ store }: CreditRewardsProps) {
  const state = useCreditsState()

  // Hidden while loading, when the feature flag is off, when not eligible
  // (rewards are for signed-in free-tier users — not BYOK, not paid plans),
  // or when the API hasn't served a reward catalog.
  if (!state || !state.enabled || !state.eligible || state.activities.length === 0) return null

  const earnedCount = state.activities.filter((a) => a.claimed).length

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Gift className="size-4 text-muted-foreground" />
        <h4 className="text-sm font-medium">Earn credits</h4>
      </div>
      <p className="text-xs text-muted-foreground">
        Try these for the first time and we&apos;ll add bonus credits to your account.
      </p>
      <div className="rounded-lg border">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <p className="text-xs text-muted-foreground">
            {earnedCount} of {state.activities.length} earned
          </p>
          {store && (
            <p className="text-xs font-medium tabular-nums">
              {formatCreditsAsDollars(store.availableCredits)} bonus credits available
            </p>
          )}
        </div>
        <div className="divide-y">
          {state.activities.map((activity) => {
            const Icon = CREDIT_ACTIVITY_ICONS[activity.code] ?? Gift
            return (
              <div key={activity.code} className="flex items-center gap-3 px-4 py-3">
                <div
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full",
                    activity.claimed ? "bg-emerald-500/15" : "bg-muted",
                  )}
                >
                  {activity.claimed ? (
                    <Check className="size-4 text-emerald-600" />
                  ) : (
                    <Icon className="size-4 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-medium", activity.claimed && "text-muted-foreground")}>
                    {activity.title}
                  </p>
                  {activity.description && (
                    <p className="text-xs text-muted-foreground">{activity.description}</p>
                  )}
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums",
                    activity.claimed
                      ? "bg-emerald-500/15 text-emerald-600"
                      : "bg-primary/10 text-primary",
                  )}
                >
                  {activity.claimed ? "Earned" : `+${formatCreditsAsDollars(activity.credits)}`}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
