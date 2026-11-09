import { Loader2, CheckCircle2 } from "lucide-react"
import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
import type { OnboardingState } from "../use-onboarding-state"
import { useCompletionSpace } from "./completion-space"

interface WelcomeStepProps {
  state: OnboardingState
}

// Onboarding is this one page (2026-11-09): sign in with Rowboat, and the
// app opens in Spaces. ChatGPT sign-in, model providers, naming a space and
// adding coding agents left it; a first space is still made, under its
// suggested name, when you have none (completion-space.ts).
export function WelcomeStep({ state }: WelcomeStepProps) {
  const rowboatState = state.providerStates['rowboat'] || { isConnected: false, isLoading: false, isConnecting: false }
  const connected = rowboatState.isConnected
  const loading = state.providersLoading || rowboatState.isLoading
  const space = useCompletionSpace(connected)

  return (
    <div className="flex flex-col items-center justify-center text-center flex-1">
      {/* Logo + main heading on the same level */}
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

      {/* Tagline badge */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-3.5 py-1.5 text-xs font-medium text-muted-foreground mb-6"
      >
        <span className="size-1.5 rounded-full bg-[var(--rowboat-success)] animate-pulse" />
        Your team of AI coworkers
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="w-full max-w-sm space-y-3"
      >
        <p className="text-sm text-muted-foreground mb-4">
          Sign in with your Rowboat account to get started.
        </p>
        {connected ? (
          <>
            <p role="status" className="flex items-center justify-center gap-1.5 text-sm font-medium text-[var(--rowboat-success)]">
              <CheckCircle2 className="size-4" />
              Signed in to Rowboat
            </p>
            {space.error && <p role="alert" className="text-sm text-destructive">{space.error}</p>}
            <Button
              onClick={() => void space.complete(state.handleComplete)}
              disabled={space.loading || space.busy}
              size="lg"
              aria-label="Continue"
              className="w-full h-12 text-base font-medium"
            >
              {space.loading || space.busy ? <Loader2 className="size-5 animate-spin" /> : "Continue"}
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={() => void state.startConnect("rowboat")}
              disabled={loading || rowboatState.isConnecting}
              size="lg"
              aria-label="Sign in with Rowboat"
              className="w-full h-12 text-base font-medium"
            >
              {loading || rowboatState.isConnecting ? <Loader2 className="size-5 animate-spin" /> : "Sign in with Rowboat"}
            </Button>
            {rowboatState.isConnecting && (
              <p role="status" className="text-xs text-muted-foreground">Complete sign in in your browser, then return here.</p>
            )}
          </>
        )}
      </motion.div>
    </div>
  )
}
