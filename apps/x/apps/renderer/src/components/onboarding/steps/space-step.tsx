import { ArrowLeft, Loader2 } from "lucide-react"
import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
import type { OnboardingState } from "../use-onboarding-state"

import { CompletionSpaceName, useCompletionSpace } from "./completion-space"

interface SpaceStepProps {
  state: OnboardingState
}

// The space comes before the agents (2026-11-06): the app lands in Spaces,
// and the next step adds the person's coding agents to this space.
export function SpaceStep({ state }: SpaceStepProps) {
  const { handleBack, handleNext } = state

  const space = useCompletionSpace(true)
  const disabled = space.loading || space.busy || (space.needed && !space.name.trim())

  return (
    <div className="flex flex-col items-center justify-center text-center flex-1">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="mb-6 max-w-sm"
      >
        <h2 className="text-3xl font-bold tracking-tight mb-3">
          {space.needed ? 'Your space is ready' : 'Spaces'}
        </h2>
        <p className="text-base text-muted-foreground leading-relaxed">
          {space.needed || space.loading
            ? 'A place for your team, your agents and theirs to work together.'
            : space.hasOrgs
              ? 'You’re already in a space. Rowboat opens there.'
              : 'Spaces needs a Rowboat account. Sign in from Spaces whenever you’re ready, or join with an invite.'}
        </p>
      </motion.div>

      {space.loading && <p role="status" className="text-sm text-muted-foreground mb-6">Checking your spaces…</p>}
      {space.needed && (
        <CompletionSpaceName name={space.name} onChange={space.setName} disabled={space.busy} />
      )}
      {space.error && (
        <div role="alert" className="mb-4 text-sm text-destructive">
          <p>{space.error}</p>
          {!space.needed && <Button variant="ghost" onClick={space.retry}>Try again</Button>}
        </div>
      )}

      <Button
        onClick={() => void space.complete(handleNext)}
        disabled={disabled || (!!space.error && !space.needed)}
        size="lg"
        className="w-full h-12 text-base font-medium mt-2"
      >
        {space.busy && <Loader2 className="size-4 animate-spin mr-2" />}
        Continue
      </Button>
      <Button
        onClick={handleBack}
        disabled={space.busy}
        variant="ghost"
        className="mt-4 gap-1 text-muted-foreground"
      >
        <ArrowLeft className="size-4" />
        Back
      </Button>
    </div>
  )
}
