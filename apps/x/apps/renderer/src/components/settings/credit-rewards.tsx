"use client"

import { useState } from "react"
import { Check, Copy, Gift, UserPlus } from "lucide-react"
import { cn } from "@/lib/utils"
import { CREDIT_ACTIVITY_ICONS, useCreditsState } from "@/hooks/use-credits-state"
import { InviteCodeClaim } from "@/components/invite-code-claim"
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
  const [copied, setCopied] = useState(false)

  // Hidden while loading, when the feature flag is off, when not eligible
  // (rewards are for signed-in free-tier users — not BYOK, not paid plans),
  // or when there is nothing to show (no reward catalog and no referral).
  if (!state || !state.enabled || !state.eligible) return null
  if (state.activities.length === 0 && !state.referral) return null

  const referral = state.referral
  const inviteSlotsLeft = referral ? Math.max(0, referral.maxClaims - referral.claimsUsed) : 0
  // invites count as one list item, earned once every claim slot is used
  const totalCount = state.activities.length + (referral ? 1 : 0)
  const earnedCount =
    state.activities.filter((a) => a.claimed).length + (referral && inviteSlotsLeft === 0 ? 1 : 0)

  const copyInviteCode = async () => {
    if (!referral) return
    try {
      await navigator.clipboard.writeText(referral.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      console.error("Failed to copy invite code:", error)
    }
  }

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
            {earnedCount} of {totalCount} earned
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
          {referral && (
            <div className="flex items-center gap-3 px-4 py-3">
              <div
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full",
                  inviteSlotsLeft === 0 ? "bg-emerald-500/15" : "bg-muted",
                )}
              >
                {inviteSlotsLeft === 0 ? (
                  <Check className="size-4 text-emerald-600" />
                ) : (
                  <UserPlus className="size-4 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-medium", inviteSlotsLeft === 0 && "text-muted-foreground")}>
                  Invite friends
                </p>
                <p className="text-xs text-muted-foreground">
                  {inviteSlotsLeft === 0
                    ? `All ${referral.maxClaims} invites used`
                    : `You each get ${formatCreditsAsDollars(referral.referrerCredits)} when a friend signs up with your code · ${referral.claimsUsed} of ${referral.maxClaims} joined`}
                </p>
                {inviteSlotsLeft > 0 && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs tracking-wider">
                      {referral.code}
                    </code>
                    <button
                      type="button"
                      onClick={copyInviteCode}
                      className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                )}
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums",
                  inviteSlotsLeft === 0
                    ? "bg-emerald-500/15 text-emerald-600"
                    : "bg-primary/10 text-primary",
                )}
              >
                {inviteSlotsLeft === 0
                  ? "Earned"
                  : `+${formatCreditsAsDollars(referral.referrerCredits)} each`}
              </span>
            </div>
          )}
        </div>
      </div>
      <InviteCodeClaim />
    </div>
  )
}
