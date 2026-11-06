"use client"

import * as React from "react"
import { AnimatePresence, motion } from "motion/react"

import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog"
import { useOnboardingState } from "./use-onboarding-state"
import { StepIndicator } from "./step-indicator"
import { WelcomeStep } from "./steps/welcome-step"
import { LlmSetupStep } from "./steps/llm-setup-step"
import { SpaceStep } from "./steps/space-step"
import { LocalAgentsStep } from "./steps/local-agents-step"

interface OnboardingModalProps {
  open: boolean
  onComplete: () => void
}

export function OnboardingModal({ open, onComplete }: OnboardingModalProps) {
  const state = useOnboardingState(open, onComplete)
  const dialogRef = React.useRef<HTMLDivElement>(null)

  const stepContent = React.useMemo(() => {
    switch (state.currentStep) {
      case 0:
        return <WelcomeStep state={state} />
      case 1:
        return <LlmSetupStep state={state} />
      case 2:
        return <SpaceStep state={state} />
      case 3:
        return <LocalAgentsStep state={state} />
    }
  }, [state.currentStep, state])

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        ref={dialogRef}
        tabIndex={-1}
        className="flex flex-col gap-0 w-[90vw] max-w-2xl h-[min(720px,85dvh)] p-0 overflow-hidden"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          // Avoid promoting the API-key link while account status loads
          // (2026-09-22, onboarding startup focus).
          event.preventDefault()
          dialogRef.current?.focus({ preventScroll: true })
        }}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-8 md:p-10">
          <div className="shrink-0">
            <StepIndicator currentStep={state.currentStep} />
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={state.currentStep}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="grow shrink-0 flex flex-col"
            >
              {stepContent}
            </motion.div>
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  )
}
