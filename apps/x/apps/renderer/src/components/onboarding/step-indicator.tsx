import * as React from "react"
import { CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Step, OnboardingPath } from "./use-onboarding-state"

const ROWBOAT_STEPS = [
  { step: 0 as Step, label: "Welcome" },
  { step: 2 as Step, label: "Connect" },
  { step: 3 as Step, label: "Done" },
]

const BYOK_STEPS = [
  { step: 0 as Step, label: "Welcome" },
  { step: 1 as Step, label: "Model" },
  { step: 2 as Step, label: "Connect" },
  { step: 3 as Step, label: "Done" },
]

interface StepIndicatorProps {
  currentStep: Step
  path: OnboardingPath
}

export function StepIndicator({ currentStep, path }: StepIndicatorProps) {
  const steps = path === 'byok' ? BYOK_STEPS : ROWBOAT_STEPS
  const currentIndex = steps.findIndex(s => s.step === currentStep)

  return (
    <div className="flex items-center gap-2 mb-8 px-4">
      {steps.map((s, i) => (
        <React.Fragment key={s.step}>
          {i > 0 && (
            <div
              className={cn(
                "h-px flex-1 transition-colors duration-500",
                i <= currentIndex ? "bg-primary" : "bg-border"
              )}
            />
          )}
          <div className="flex flex-col items-center gap-1.5">
            <div
              className={cn(
                "size-8 rounded-full flex items-center justify-center text-xs font-medium transition-all duration-300",
                i < currentIndex && "bg-primary text-primary-foreground",
                i === currentIndex && "bg-primary text-primary-foreground ring-4 ring-primary/20",
                i > currentIndex && "bg-muted text-muted-foreground"
              )}
            >
              {i < currentIndex ? (
                <CheckCircle2 className="size-4" />
              ) : (
                i + 1
              )}
            </div>
            <span
              className={cn(
                "text-[11px] font-medium transition-colors duration-300",
                i <= currentIndex ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {s.label}
            </span>
          </div>
        </React.Fragment>
      ))}
    </div>
  )
}
