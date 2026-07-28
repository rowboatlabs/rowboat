"use client"

import { useState } from "react"
import { CheckCircle2, Loader2, Ticket } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useCreditsState } from "@/hooks/use-credits-state"
import { formatCreditsAsDollars } from "@x/shared/dist/credits.js"

/**
 * "Have an invite code?" entry: redeem another user's referral code — both
 * sides earn credits (the backend enforces one lifetime claim per account,
 * new accounts only). Self-gating: renders nothing unless the credit-rewards
 * feature is on, the user is eligible (signed-in, free tier), and this
 * account hasn't already redeemed a code. Shown in onboarding and in
 * settings → Account.
 */
export function InviteCodeClaim() {
  const state = useCreditsState()
  const [code, setCode] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [granted, setGranted] = useState<number | null>(null)

  // referral state doubles as the claimed-by-me source; without it we can't
  // tell whether the entry still applies, so stay hidden
  if (!state || !state.enabled || !state.eligible || !state.referral) return null
  if (state.referral.claimedByMe && granted === null) return null

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
      console.error("Failed to claim invite code:", err)
      setError("Could not apply the invite code. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (granted !== null) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-emerald-500/5 px-4 py-3">
        <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
        <p className="text-sm">
          Invite code applied — {formatCreditsAsDollars(granted)} in credits added to your account.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <Ticket className="size-4 text-muted-foreground" />
        <p className="text-sm font-medium">Have an invite code?</p>
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
          placeholder="ABC-DEF-GHJ"
          className="h-8 font-mono text-sm uppercase"
          maxLength={16}
        />
        <Button size="sm" onClick={submit} disabled={!code.trim() || submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : "Apply"}
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Enter a friend&apos;s code and you both earn {formatCreditsAsDollars(state.referral.refereeCredits)} in credits.
      </p>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}
