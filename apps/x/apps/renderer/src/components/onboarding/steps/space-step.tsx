import { ArrowLeft, Loader2 } from "lucide-react"
import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
import type { OnboardingState } from "../use-onboarding-state"
import { CompletionSpaceName } from "./completion-space"

interface SpaceStepProps {
  state: OnboardingState
}

// Screen 2 of 3 (2026-11-03, spaces-first onboarding): name your space, or,
// when an invite already put you in one, land there.
export function SpaceStep({ state }: SpaceStepProps) {
  const { space, confirmSpace, setCurrentStep } = state
  const joined = !space.loading && !space.needed && space.org
  const disabled = space.loading || space.busy || (space.needed && !space.name.trim())

  return (
    <div className="flex flex-col items-center justify-center text-center flex-1">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="mb-6 max-w-sm"
      >
        <h2 className="text-3xl font-bold tracking-tight mb-3">
          {joined ? <>You&apos;re in {space.org!.name}</> : "Name your space"}
        </h2>
        <p className="text-base text-muted-foreground leading-relaxed">
          {joined
            ? "Your team and your AI coworkers are already here."
            : "Where you, your team and your AI coworkers work. You can rename it any time."}
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

      <div className="w-full max-w-sm space-y-2">
        <Button
          onClick={() => confirmSpace()}
          disabled={disabled || (!!space.error && !space.needed)}
          size="lg"
          className="w-full h-12 text-base font-medium"
        >
          {space.busy && <Loader2 className="size-4 animate-spin mr-2" />}
          {joined ? <>Open {space.org!.name}</> : "Continue"}
        </Button>
        {joined && (
          <Button
            onClick={() => confirmSpace({ startTour: true })}
            disabled={disabled}
            variant="ghost"
            className="w-full text-muted-foreground"
          >
            Take a 1-minute tour first
          </Button>
        )}
      </div>
      <Button
        onClick={() => setCurrentStep(0)}
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
