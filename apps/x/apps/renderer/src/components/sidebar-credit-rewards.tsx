"use client"

import { useCallback, useState } from "react"
import { Check, ChevronRight, Copy, Gift, UserPlus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Popover, PopoverArrow, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { CREDIT_ACTIVITY_ICONS, useCreditsState } from "@/hooks/use-credits-state"
import { formatCreditsAsDollars, type CreditActivityCode } from "@x/shared/dist/credits.js"

const DISMISSED_KEY = "rowboat.credit-rewards-card-dismissed"

interface SidebarCreditRewardsProps {
  onOpenEmail?: () => void
  onOpenMeetings?: () => void
  onOpenAgents?: () => void
  onOpenApps?: () => void
  onConnectAccounts: () => void
}

/**
 * Persistent sidebar entry for first-time-action credit rewards: a compact
 * "Earn $X in credits" pill above the plan card that opens the checklist in
 * a popover. Rows navigate to where the action happens. Shown only when the
 * credit-rewards feature flag is on and the user is an eligible (signed-in,
 * free-tier) account; gone for good once every reward is earned or the user
 * dismisses it from the popover.
 */
export function SidebarCreditRewards({
  onOpenEmail,
  onOpenMeetings,
  onOpenAgents,
  onOpenApps,
  onConnectAccounts,
}: SidebarCreditRewardsProps) {
  const state = useCreditsState()
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISSED_KEY) === "1")
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleDismiss = useCallback(() => {
    localStorage.setItem(DISMISSED_KEY, "1")
    setDismissed(true)
    setOpen(false)
  }, [])

  if (dismissed || !state || !state.enabled || !state.eligible) return null

  const referral = state.referral
  const inviteSlotsLeft = referral ? Math.max(0, referral.maxClaims - referral.claimsUsed) : 0
  const remaining = state.activities.filter((a) => !a.claimed)
  if (remaining.length === 0 && inviteSlotsLeft === 0) return null

  // invites count as one checklist item, earned once every claim slot is used
  const totalCount = state.activities.length + (referral ? 1 : 0)
  const earnedCount =
    state.activities.length - remaining.length + (referral && inviteSlotsLeft === 0 ? 1 : 0)
  const remainingTotal =
    remaining.reduce((sum, a) => sum + a.credits, 0) +
    (referral ? inviteSlotsLeft * referral.referrerCredits : 0)

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

  const actionFor = (code: CreditActivityCode): (() => void) | undefined => {
    switch (code) {
      case "first_gmail_connected": return onConnectAccounts
      case "first_email_sent": return onOpenEmail
      case "first_meeting_note": return onOpenMeetings
      case "first_bg_agent": return onOpenAgents
      case "first_app_built": return onOpenApps
    }
  }

  return (
    <div className="px-3 pt-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/20 px-3 py-2 text-left transition-colors hover:bg-sidebar-accent/40"
          >
            <Gift className="size-4 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-sidebar-foreground">
                Earn {formatCreditsAsDollars(remainingTotal)} in credits
              </span>
              <span className="block text-[10px] text-sidebar-foreground/60">
                {earnedCount} of {totalCount} earned
              </span>
            </div>
            <ChevronRight className="size-3 shrink-0 text-sidebar-foreground/50" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" sideOffset={10} className="w-80 p-0">
          <PopoverArrow className="fill-popover" />
          <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15">
                <Gift className="size-4 text-amber-500" />
              </span>
              <div>
                <h4 className="text-sm font-semibold">Earn {formatCreditsAsDollars(remainingTotal)} in credits</h4>
                <p className="text-xs text-muted-foreground">
                  Try these firsts and we&apos;ll credit your account
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleDismiss}
              className="rounded-md p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Dismiss earn-credits checklist"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="p-2">
            {state.activities.map((activity) => {
              const Icon = CREDIT_ACTIVITY_ICONS[activity.code] ?? Gift
              const action = actionFor(activity.code)
              return (
                <button
                  key={activity.code}
                  type="button"
                  disabled={activity.claimed || !action}
                  onClick={() => {
                    setOpen(false)
                    action?.()
                  }}
                  className={cn(
                    "group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left",
                    activity.claimed ? "opacity-60" : "transition-colors hover:bg-accent/60",
                  )}
                >
                  <div
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full",
                      activity.claimed ? "bg-emerald-500/15" : "bg-muted",
                    )}
                  >
                    {activity.claimed ? (
                      <Check className="size-3.5 text-emerald-600" />
                    ) : (
                      <Icon className="size-3.5 text-muted-foreground" />
                    )}
                  </div>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[13px]",
                      activity.claimed ? "text-muted-foreground line-through" : "font-medium",
                    )}
                  >
                    {activity.title}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-px text-[11px] font-medium tabular-nums",
                      activity.claimed ? "text-muted-foreground" : "bg-primary/10 text-primary",
                    )}
                  >
                    {activity.claimed ? "Earned" : `+${formatCreditsAsDollars(activity.credits)}`}
                  </span>
                </button>
              )
            })}
          </div>
          {referral && (
            <div className="border-t p-2">
              <div className="flex items-center gap-2.5 px-2 py-1.5">
                <div
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full",
                    inviteSlotsLeft === 0 ? "bg-emerald-500/15" : "bg-muted",
                  )}
                >
                  {inviteSlotsLeft === 0 ? (
                    <Check className="size-3.5 text-emerald-600" />
                  ) : (
                    <UserPlus className="size-3.5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">Invite friends</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {referral.claimsUsed} of {referral.maxClaims} joined
                  </span>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-px text-[11px] font-medium tabular-nums",
                    inviteSlotsLeft === 0 ? "text-muted-foreground" : "bg-primary/10 text-primary",
                  )}
                >
                  {inviteSlotsLeft === 0
                    ? "Earned"
                    : `+${formatCreditsAsDollars(referral.referrerCredits)} each`}
                </span>
              </div>
              {inviteSlotsLeft > 0 && (
                <div className="mx-2 mb-1 flex items-center gap-2">
                  <code className="flex-1 truncate rounded-md bg-muted px-2 py-1 text-center font-mono text-xs tracking-wider">
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
              {inviteSlotsLeft > 0 && (
                <p className="mx-2 mb-1 text-[11px] leading-snug text-muted-foreground">
                  Share your code — you each get {formatCreditsAsDollars(referral.referrerCredits)} when a
                  friend signs up and enters it.
                </p>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
