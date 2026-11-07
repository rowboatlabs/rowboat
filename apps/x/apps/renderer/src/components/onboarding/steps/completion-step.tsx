import { ArrowLeft, Loader2 } from "lucide-react"
import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
import type { OnboardingState } from "../use-onboarding-state"

import { CompletionSpaceName, useCompletionSpace } from "./completion-space"

interface CompletionStepProps {
  state: OnboardingState
}

export function CompletionStep({ state }: CompletionStepProps) {
  const { handleBack, handleComplete, handleCompleteWithTour } = state

  const space = useCompletionSpace(state.onboardingPath === 'rowboat')
  const creating = space.needed || (space.offered && space.wanted)
  const disabled = space.loading || space.busy || (creating && !space.name.trim())

  return (
    <div className="flex flex-col items-center justify-center text-center flex-1">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="mb-6 max-w-sm"
      >
        <h2 className="text-3xl font-bold tracking-tight mb-3">
          {space.needed ? 'Your space is ready' : 'Ready to explore'}
        </h2>
        {space.needed && (
          <p className="text-base text-muted-foreground leading-relaxed">
            A place for your team and their Rowboat assistants to work together.
          </p>
        )}
      </motion.div>

      {space.loading && <p role="status" className="text-sm text-muted-foreground mb-6">Checking your spaces…</p>}
      {space.needed && (
        <div className="w-full max-w-sm mb-6">
          <CompletionSpaceName name={space.name} onChange={space.setName} disabled={space.busy} />
        </div>
      )}
      {space.offered && (
        <div className="w-full max-w-sm mb-6">
          <label className="flex items-start gap-2 text-left text-sm">
            <input type="checkbox" className="mt-1" checked={space.wanted} disabled={space.busy}
              onChange={event => space.setWanted(event.target.checked)} />
            <span>
              Also start a group chat of my own
              <span className="block text-xs text-muted-foreground">For your own people, apart from the team you joined.</span>
            </span>
          </label>
          {space.wanted && (
            <div className="mt-3">
              <CompletionSpaceName name={space.name} onChange={space.setName} disabled={space.busy}
                hint="Invite people to it from the chat. You can rename it later." />
            </div>
          )}
        </div>
      )}
      {space.error && (
        <div role="alert" className="mb-4 text-sm text-destructive">
          <p>{space.error}</p>
          {!space.needed && <Button variant="ghost" onClick={space.retry}>Try again</Button>}
        </div>
      )}

      {/* CTAs */}
      <div className="w-full border-t pt-5 mt-2 mb-4">
        <p className="text-sm text-muted-foreground">
          Take a quick tour or jump right in.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          🔊 The tour includes narration. Sound on!
        </p>
      </div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
        className="grid w-full grid-cols-1 sm:grid-cols-2 gap-2"
      >
        <Button
          onClick={() => void space.complete(handleCompleteWithTour)}
          disabled={disabled || (!!space.error && !space.needed)}
          size="lg"
          className="w-full h-12 text-base font-medium"
        >
          {space.busy && <Loader2 className="size-4 animate-spin mr-2" />}
          Take a 1-min tour
        </Button>
        <Button
          onClick={() => void space.complete(handleComplete)}
          disabled={disabled || (!!space.error && !space.needed)}
          variant="outline"
          size="lg"
          className="w-full h-12 text-base font-medium"
        >
          Start using Rowboat
        </Button>
      </motion.div>
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
