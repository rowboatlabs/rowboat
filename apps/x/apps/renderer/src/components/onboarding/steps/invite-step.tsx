import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { InviteLinkPanel } from "@/components/spaces/invite-link"
import type { OnboardingState } from "../use-onboarding-state"

interface InviteStepProps {
  state: OnboardingState
}

// Screen 3 of 3 (2026-11-03, spaces-first onboarding): a space with only you
// and Rowboat in it doesn't show what it's for, so its maker gets a link to
// hand out before opening it. The link is the org's (accepting joins its
// default spaces), as in the space's own Invite dialog.
export function InviteStep({ state }: InviteStepProps) {
  const { org, finish } = state
  if (!org) return null

  return (
    <div className="flex flex-col items-center justify-center text-center flex-1">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="mb-6 max-w-sm"
      >
        <h2 className="text-3xl font-bold tracking-tight mb-3">
          Bring your team aboard
        </h2>
        <p className="text-base text-muted-foreground leading-relaxed">
          Your agents work with everyone in the space. Send this link to your teammates.
        </p>
      </motion.div>

      <div className="w-full max-w-sm rounded-xl border bg-muted/20 p-4 text-left mb-6">
        <InviteLinkPanel orgId={org.id} spaceIds={[]} />
      </div>

      <div className="w-full max-w-sm space-y-2">
        <Button onClick={() => finish()} size="lg" className="w-full h-12 text-base font-medium">
          Open {org.name}
        </Button>
        <Button onClick={() => finish({ startTour: true })} variant="ghost" className="w-full text-muted-foreground">
          Take a 1-minute tour first
        </Button>
      </div>
    </div>
  )
}
