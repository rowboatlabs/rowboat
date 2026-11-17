"use client"

import { useState } from "react"
import { CheckCircle2, Loader2, Ticket } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useCreditsState } from "@/hooks/use-credits-state"
import { formatCreditsAsDollars } from "@x/shared/dist/credits.js"

/**
 * "Have a code?" entry. Takes two kinds of code (2026-11-17, hackathon promo
 * codes), and the backend decides which one was typed:
 *  - a shared promo code — credits for this account, once per code;
 *  - another user's referral code — both sides earn credits (one lifetime
 *    claim per account, new accounts only).
 * Self-gating: renders nothing unless the credit-rewards feature is on and
 * the user is eligible (signed-in, free tier). It stays up after an invite
 * code has been redeemed, because a promo code can still be applied. Shown
 * in onboarding and in settings → Account.
 */
export function InviteCodeClaim() {
  const state = useCreditsState()
  const [code, setCode] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [granted, setGranted] = useState<number | null>(null)

  if (!state || !state.enabled || !state.eligible) return null
  // the friend's-code offer applies only while this account can still redeem
  // an invite code; without referral state we can't tell, so don't promise it
  const inviteOffer = state.referral && !state.referral.claimedByMe ? state.referral : null

  const submit = async () => {
    if (!code.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await window.ipc.invoke("referral:claim", { code })
      if (result.ok) {
        setGranted(result.creditsGranted)
      } else {
        setError(result.message)
      }
    } catch (err) {
      console.error("Failed to apply code:", err)
      setError("Could not apply the code. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (granted !== null) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-emerald-500/5 px-4 py-3">
        <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
        <p className="text-sm">
          Code applied — {formatCreditsAsDollars(granted)} in credits added to your account.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <Ticket className="size-4 text-muted-foreground" />
        <p className="text-sm font-medium">{inviteOffer ? "Have an invite or promo code?" : "Have a promo code?"}</p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={code}
          onChange={(e) => {
            setCode(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit()
          }}
          placeholder={inviteOffer ? "ABC-DEF-GHJ" : "Promo code"}
          className="h-8 font-mono text-sm uppercase placeholder:normal-case"
          maxLength={40}
        />
        <Button size="sm" onClick={submit} disabled={!code.trim() || submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : "Apply"}
        </Button>
      </div>
      {inviteOffer && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Enter a friend&apos;s code and you both earn {formatCreditsAsDollars(inviteOffer.refereeCredits)} in credits.
        </p>
      )}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}
