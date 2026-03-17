"use client"

import * as React from "react"
import { AnimatePresence, motion } from "motion/react"

import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog"
import { GoogleClientIdModal } from "@/components/google-client-id-modal"
import { ComposioApiKeyModal } from "@/components/composio-api-key-modal"
import { useOnboardingState } from "./use-onboarding-state"
import { StepIndicator } from "./step-indicator"
import { WelcomeStep } from "./steps/welcome-step"
import { LlmSetupStep } from "./steps/llm-setup-step"
import { ConnectAccountsStep } from "./steps/connect-accounts-step"
import { CompletionStep } from "./steps/completion-step"

interface OnboardingModalProps {
  open: boolean
  onComplete: () => void
}

export function OnboardingModal({ open, onComplete }: OnboardingModalProps) {
  const state = useOnboardingState(open, onComplete)

  const stepContent = React.useMemo(() => {
    switch (state.currentStep) {
      case 0:
        return <WelcomeStep state={state} />
      case 1:
        return <LlmSetupStep state={state} />
      case 2:
        return <ConnectAccountsStep state={state} />
      case 3:
        return <CompletionStep state={state} />
    }
  }, [state.currentStep, state])

  return (
    <>
      <GoogleClientIdModal
        open={state.googleClientIdOpen}
        onOpenChange={state.setGoogleClientIdOpen}
        onSubmit={state.handleGoogleClientIdSubmit}
        isSubmitting={state.providerStates.google?.isConnecting ?? false}
      />
      <ComposioApiKeyModal
        open={state.composioApiKeyOpen}
        onOpenChange={state.setComposioApiKeyOpen}
        onSubmit={state.handleComposioApiKeySubmit}
        isSubmitting={state.gmailConnecting}
      />
      <Dialog open={open} onOpenChange={() => {}}>
        <DialogContent
          className="w-[90vw] max-w-2xl max-h-[85vh] p-0 overflow-hidden"
          showCloseButton={false}
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <div className="flex flex-col h-full max-h-[85vh] overflow-y-auto p-8 md:p-10">
            <StepIndicator
              currentStep={state.currentStep}
              path={state.onboardingPath}
            />
            <AnimatePresence mode="wait">
              <motion.div
                key={state.currentStep}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
                className="flex-1 flex flex-col"
              >
                {stepContent}
              </motion.div>
            </AnimatePresence>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
