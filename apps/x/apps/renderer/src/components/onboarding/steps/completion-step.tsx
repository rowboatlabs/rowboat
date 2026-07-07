import { CheckCircle2, Volume2 } from "lucide-react"
import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { TalkingHead } from "@/components/talking-head"
import type { OnboardingState } from "../use-onboarding-state"

interface CompletionStepProps {
  state: OnboardingState
}

const zeroLevel = () => 0

export function CompletionStep({ state }: CompletionStepProps) {
  const { connectedProviders, gmailConnected, googleCalendarConnected, handleComplete, handleCompleteWithTour } = state
  const hasConnections = connectedProviders.length > 0 || gmailConnected || googleCalendarConnected

  return (
    <div className="flex flex-col items-center justify-center text-center flex-1">
      {/* Title with checkmark on the right */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="flex items-center gap-3 mb-3"
      >
        <h2 className="text-3xl font-bold tracking-tight">
          You're All Set!
        </h2>
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.35 }}
          className="shrink-0"
        >
          <CheckCircle2 className="size-9 text-green-600 dark:text-green-400" />
        </motion.span>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35 }}
        className="text-base text-muted-foreground leading-relaxed max-w-sm mb-6"
      >
        {hasConnections ? (
          <>Give me 30 minutes to build your context graph. I can still help with other things on your computer.</>
        ) : (
          <>You can connect your accounts anytime from the sidebar to start syncing data.</>
        )}
      </motion.p>

      {/* Connected accounts summary */}
      {hasConnections && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="w-full max-w-sm rounded-xl border bg-muted/30 p-4 mb-6"
        >
          <p className="text-sm font-semibold mb-3 text-left">Connected</p>
          <div className="space-y-2">
            {gmailConnected && (
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.5 }}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <CheckCircle2 className="size-4 text-green-600 dark:text-green-400" />
                <span>Gmail (Email)</span>
              </motion.div>
            )}
            {googleCalendarConnected && (
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.52 }}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <CheckCircle2 className="size-4 text-green-600 dark:text-green-400" />
                <span>Google Calendar</span>
              </motion.div>
            )}
            {connectedProviders.includes('google') && (
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.5 }}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <CheckCircle2 className="size-4 text-green-600 dark:text-green-400" />
                <span>Google (Email & Calendar)</span>
              </motion.div>
            )}
            {connectedProviders.includes('fireflies-ai') && (
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.55 }}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <CheckCircle2 className="size-4 text-green-600 dark:text-green-400" />
                <span>Fireflies (Meeting transcripts)</span>
              </motion.div>
            )}
          </div>
        </motion.div>
      )}

      {/* Captain's tour hand-off */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.55 }}
        className="w-full max-w-sm rounded-xl border bg-muted/30 px-5 pt-4 pb-5 mb-4"
      >
        <div className="flex items-center gap-4">
          <motion.div
            initial={{ scale: 0, rotate: -12 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 18, delay: 0.65 }}
            className="shrink-0"
          >
            <TalkingHead ttsState="idle" getLevel={zeroLevel} size={88} hat="captain" />
          </motion.div>
          <div className="text-left">
            <p className="text-base font-semibold mb-1">Want the captain's tour?</p>
            <p className="text-sm text-muted-foreground leading-snug">
              A one-minute guided voyage through everything you just set up
              {hasConnections ? <> — perfect while I chart your data</> : null}.
            </p>
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Volume2 className="size-3.5 shrink-0" />
              <span>I narrate it out loud, so sound on!</span>
            </p>
          </div>
        </div>
      </motion.div>

      {/* CTAs */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
        className="flex w-full max-w-xs flex-col items-center gap-2"
      >
        <Button
          onClick={handleCompleteWithTour}
          size="lg"
          className="w-full h-12 text-base font-medium"
        >
          Take the 1-minute tour
        </Button>
        <Button
          onClick={handleComplete}
          variant="ghost"
          className="text-muted-foreground"
        >
          Skip — I'll explore myself
        </Button>
      </motion.div>
    </div>
  )
}
