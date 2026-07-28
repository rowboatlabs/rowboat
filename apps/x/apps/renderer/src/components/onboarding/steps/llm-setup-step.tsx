import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProvidersSection } from "@/components/settings/providers-section"
import { useModels } from "@/hooks/use-models"
import type { OnboardingState } from "../use-onboarding-state"

interface LlmSetupStepProps {
  state: OnboardingState
}

// Screen 2 of onboarding: the SAME provider surface as Settings (connected
// list + add-provider flow), reframed for first-run. Users who signed in on
// screen 1 already have a working assistant (initial selection runs at
// sign-in) and see "Add more providers"; users who skipped sign-in connect
// their first provider here. Continue gates on an assistant model existing —
// the one thing chat can't run without.
export function LlmSetupStep({ state }: LlmSetupStepProps) {
  const { handleNext, handleBack } = state
  const { defaultModel, isRowboatConnected } = useModels()
  const hasAssistant = defaultModel !== null

  return (
    <div className="flex flex-col flex-1">
      {/* Title */}
      <h2 className="text-3xl font-bold tracking-tight text-center mb-2">
        {isRowboatConnected ? "Add more providers" : "Connect a model provider"}
      </h2>
      <p className="text-base text-muted-foreground text-center mb-6">
        {isRowboatConnected
          ? "Rowboat is ready to use. Optionally connect your own API keys or local models — their models appear alongside your Rowboat models."
          : "Connect an API key or a local model to power the Assistant."}
      </p>

      <ProvidersSection dialogOpen variant="onboarding" />

      {/* Footer */}
      <div className="flex items-center justify-between mt-6 pt-4 border-t">
        <Button variant="ghost" onClick={handleBack} className="gap-1">
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <Button onClick={handleNext} disabled={!hasAssistant} className="min-w-[140px]">
          Continue
        </Button>
      </div>
    </div>
  )
}
