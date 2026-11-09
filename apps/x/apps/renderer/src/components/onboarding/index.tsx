"use client"

import * as React from "react"

import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog"
import { useOnboardingState } from "./use-onboarding-state"
import { WelcomeStep } from "./steps/welcome-step"

interface OnboardingModalProps {
  open: boolean
  onComplete: () => void
}

// One page since 2026-11-09: sign in with Rowboat (steps/welcome-step.tsx).
export function OnboardingModal({ open, onComplete }: OnboardingModalProps) {
  const state = useOnboardingState(open, onComplete)
  const dialogRef = React.useRef<HTMLDivElement>(null)

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        ref={dialogRef}
        tabIndex={-1}
        className="flex flex-col gap-0 w-[90vw] max-w-xl max-h-[85dvh] p-0 overflow-hidden"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          // Don't focus the sign-in button while account status loads
          // (2026-09-22, onboarding startup focus).
          event.preventDefault()
          dialogRef.current?.focus({ preventScroll: true })
        }}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-8 md:p-12">
          <WelcomeStep state={state} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
