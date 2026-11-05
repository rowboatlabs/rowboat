import { Loader2, CheckCircle2 } from "lucide-react"
import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
import type { OnboardingState } from "../use-onboarding-state"

interface WelcomeStepProps {
  state: OnboardingState
}

// Screen 1 of 3 (2026-11-03, spaces-first onboarding): what Rowboats is, and
// the Rowboat sign-in that Spaces needs. ChatGPT and API keys moved to
// Settings, since neither gets you a space.
export function WelcomeStep({ state }: WelcomeStepProps) {
  const { rowboat, signIn, setCurrentStep } = state

  return (
    <div className="flex flex-col items-center justify-center text-center flex-1">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="flex items-center gap-4 mb-4"
      >
        <h1 className="text-3xl font-bold tracking-tight">
          Welcome to Rowboat
        </h1>
        {/* Logo with ambient glow */}
        <div className="relative shrink-0">
          <div className="absolute inset-0 size-12 rounded-2xl bg-primary/10 blur-xl scale-[2.5]" />
          <img src="/logo-only.png" alt="Rowboat" className="relative size-12" />
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-3.5 py-1.5 text-xs font-medium text-muted-foreground mb-6"
      >
        <span className="size-1.5 rounded-full bg-[var(--rowboat-success)] animate-pulse" />
        Your team of AI coworkers
      </motion.div>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-base text-muted-foreground leading-relaxed max-w-sm mb-8"
      >
        Spin up agents like Hermes, Claude Code and Codex, give them roles, add them to a group chat, and watch them collaborate on your shared goals.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="w-full max-w-sm space-y-3"
      >
        {rowboat.isConnected ? (
          <>
            <p role="status" className="flex items-center justify-center gap-1.5 text-sm font-medium text-[var(--rowboat-success)]">
              <CheckCircle2 className="size-4" />
              Signed in to Rowboat
            </p>
            <Button onClick={() => setCurrentStep(1)} size="lg" className="w-full h-12 text-base font-medium">
              Continue
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={() => void signIn()}
              disabled={rowboat.isLoading || rowboat.isConnecting}
              size="lg"
              className="w-full h-12 text-base font-medium"
            >
              {rowboat.isLoading || rowboat.isConnecting
                ? <Loader2 className="size-5 animate-spin" />
                : <><img src="/logo-only.png" alt="" className="size-5" /> Continue with Rowboat</>}
            </Button>
            <p role={rowboat.isConnecting ? "status" : undefined} className="text-xs text-muted-foreground">
              {rowboat.isConnecting
                ? "Complete sign in in your browser, then return here."
                : "Free plan included."}
            </p>
          </>
        )}
      </motion.div>
    </div>
  )
}
