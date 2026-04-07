import { CheckCircle2 } from "lucide-react"
import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
import type { OnboardingState } from "../use-onboarding-state"

interface CompletionStepProps {
  state: OnboardingState
}

export function CompletionStep({ state }: CompletionStepProps) {
  const { connectedProviders, gmailConnected, googleCalendarConnected, handleComplete } = state
  const hasConnections = connectedProviders.length > 0 || gmailConnected || googleCalendarConnected

  return (
    <div className="flex flex-col items-center justify-center text-center flex-1">
      {/* Animated checkmark */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.1 }}
        className="relative mb-8"
      >
        {/* Pulsing ring */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0.6 }}
          animate={{ scale: 1.5, opacity: 0 }}
          transition={{ duration: 1.2, repeat: 2, ease: "easeOut" }}
          className="absolute inset-0 rounded-full bg-green-500/20"
        />
        <div className="relative size-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <CheckCircle2 className="size-10 text-green-600 dark:text-green-400" />
        </div>
      </motion.div>

      {/* Title */}
      <motion.h2
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="text-3xl font-bold tracking-tight mb-3"
      >
        You're All Set!
      </motion.h2>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35 }}
        className="text-base text-muted-foreground leading-relaxed max-w-sm mb-8"
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
          className="w-full max-w-sm rounded-xl border bg-muted/30 p-4 mb-8"
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

      {/* CTA */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
      >
        <Button
          onClick={handleComplete}
          size="lg"
          className="w-full max-w-xs h-12 text-base font-medium"
        >
          Start Using Rowboat
        </Button>
      </motion.div>
    </div>
  )
}
