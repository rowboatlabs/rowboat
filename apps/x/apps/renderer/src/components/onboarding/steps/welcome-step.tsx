import { Loader2, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { OnboardingState } from "../use-onboarding-state"

interface WelcomeStepProps {
  state: OnboardingState
}

export function WelcomeStep({ state }: WelcomeStepProps) {
  const rowboatState = state.providerStates['rowboat'] || { isConnected: false, isLoading: false, isConnecting: false }

  return (
    <div className="flex flex-col items-center justify-center text-center flex-1">
      {/* Logo */}
      <img src="/logo-only.png" alt="Rowboat" className="size-14 mb-6" />

      {/* Tagline badge */}
      <div className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-3.5 py-1.5 text-xs font-medium text-muted-foreground mb-6">
        <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
        Your AI coworker, with memory
      </div>

      {/* Main heading */}
      <h1 className="text-3xl font-bold tracking-tight mb-3">
        Welcome to Rowboat
      </h1>
      <p className="text-base text-muted-foreground leading-relaxed max-w-sm mb-8">
        Connect your Rowboat account for instant access to all models through our gateway — no API keys needed.
      </p>

      {/* Product preview placeholder */}
      <div className="w-full max-w-sm rounded-xl border-2 border-dashed border-muted-foreground/20 bg-muted/30 aspect-video flex items-center justify-center mb-8">
        <span className="text-sm text-muted-foreground/50">Product Preview</span>
      </div>

      {/* Sign in / connected state */}
      {rowboatState.isConnected ? (
        <div className="flex flex-col items-center gap-4 w-full max-w-xs">
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
            <CheckCircle2 className="size-5" />
            <span className="text-sm font-medium">Connected to Rowboat</span>
          </div>
          <Button
            onClick={() => state.setCurrentStep(2)}
            size="lg"
            className="w-full h-12 text-base font-medium"
          >
            Continue
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 w-full max-w-xs">
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

      {/* BYOK link */}
      <div className="mt-8">
        <button
          onClick={() => {
            state.setOnboardingPath('byok')
            state.setCurrentStep(1)
          }}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4 decoration-muted-foreground/30 hover:decoration-foreground/50"
        >
          I want to bring my own API key
        </button>
      </div>
    </div>
  )
}
