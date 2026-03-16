import { Loader2, CheckCircle2, Brain, Plug, ShieldCheck } from "lucide-react"
import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
import type { OnboardingState } from "../use-onboarding-state"

interface WelcomeStepProps {
  state: OnboardingState
}

const features = [
  {
    icon: Brain,
    label: "Memory",
    desc: "Builds a knowledge graph from your work",
  },
  {
    icon: Plug,
    label: "Connected",
    desc: "Syncs email, calendar, and meetings",
  },
  {
    icon: ShieldCheck,
    label: "Private",
    desc: "Your data stays local on your machine",
  },
]

export function WelcomeStep({ state }: WelcomeStepProps) {
  const rowboatState = state.providerStates['rowboat'] || { isConnected: false, isLoading: false, isConnecting: false }

  return (
    <div className="flex flex-col items-center justify-center text-center flex-1">
      {/* Logo with ambient glow */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative mb-6"
      >
        <div className="absolute inset-0 size-14 rounded-2xl bg-primary/10 blur-xl scale-[2]" />
        <img src="/logo-only.png" alt="Rowboat" className="relative size-14" />
      </motion.div>

      {/* Tagline badge */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-3.5 py-1.5 text-xs font-medium text-muted-foreground mb-6"
      >
        <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
        Your AI coworker, with memory
      </motion.div>

      {/* Main heading */}
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-3xl font-bold tracking-tight mb-3"
      >
        Welcome to Rowboat
      </motion.h1>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-base text-muted-foreground leading-relaxed max-w-sm mb-8"
      >
        Connect your Rowboat account for instant access to all models through our gateway — no API keys needed.
      </motion.p>

      {/* Feature highlights */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-md mb-8">
        {features.map((f, i) => (
          <motion.div
            key={f.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 + i * 0.08 }}
            className="flex flex-col items-center gap-2 rounded-xl border bg-muted/30 p-4"
          >
            <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <f.icon className="size-4.5 text-primary/80" />
            </div>
            <span className="text-xs font-semibold">{f.label}</span>
            <span className="text-[11px] leading-tight text-muted-foreground">{f.desc}</span>
          </motion.div>
        ))}
      </div>

      {/* Sign in / connected state */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="w-full max-w-xs"
      >
        {rowboatState.isConnected ? (
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle2 className="size-5" />
              <span className="text-sm font-medium">Connected to Rowboat</span>
            </div>
            <Button
              onClick={() => {
                state.setOnboardingPath('rowboat')
                state.setCurrentStep(2)
              }}
              size="lg"
              className="w-full h-12 text-base font-medium"
            >
              Continue
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <Button
              onClick={() => {
                state.setOnboardingPath('rowboat')
                state.startConnect('rowboat')
              }}
              size="lg"
              className="w-full h-12 text-base font-medium"
              disabled={rowboatState.isConnecting}
            >
              {rowboatState.isConnecting ? (
                <><Loader2 className="size-5 animate-spin mr-2" />Waiting for sign in...</>
              ) : (
                "Sign in with Rowboat"
              )}
            </Button>
            {rowboatState.isConnecting && (
              <p className="text-xs text-muted-foreground animate-pulse">
                Complete sign in in your browser, then return here.
              </p>
            )}
          </div>
        )}
      </motion.div>

      {/* BYOK link */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
        className="mt-8"
      >
        <button
          onClick={() => {
            state.setOnboardingPath('byok')
            state.setCurrentStep(1)
          }}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4 decoration-muted-foreground/30 hover:decoration-foreground/50"
        >
          I want to bring my own API key
        </button>
      </motion.div>
    </div>
  )
}
