import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { useCompletionSpace, type OnboardingOrg } from "./steps/completion-space"

// Spaces-first onboarding (2026-11-03): sign in with Rowboat, name your space
// (or land in the one an invite put you in), invite your team, open it.
// Models, connected accounts and coding agents live in Settings.

export type Step = 0 | 1 | 2

export interface RowboatAccountState {
  isConnected: boolean
  isLoading: boolean
  isConnecting: boolean
}

export type OnboardingCompleteOptions = { startTour?: boolean }

export function useOnboardingState(open: boolean, onComplete: (opts?: OnboardingCompleteOptions) => void) {
  const [currentStep, setCurrentStep] = useState<Step>(0)
  const [rowboat, setRowboat] = useState<RowboatAccountState>({ isConnected: false, isLoading: true, isConnecting: false })
  const [org, setOrg] = useState<OnboardingOrg | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void window.ipc.invoke('oauth:getState', null)
      .then((result) => {
        if (!cancelled) setRowboat({ isConnected: result.config?.rowboat?.connected ?? false, isLoading: false, isConnecting: false })
      })
      .catch(() => {
        if (!cancelled) setRowboat({ isConnected: false, isLoading: false, isConnecting: false })
      })
    return () => { cancelled = true }
  }, [open])

  useEffect(() => window.ipc.on('oauth:didConnect', ({ provider, success }) => {
    if (provider === 'rowboat') setRowboat({ isConnected: success, isLoading: false, isConnecting: false })
  }), [])

  const signIn = useCallback(async () => {
    setRowboat(prev => ({ ...prev, isConnecting: true }))
    try {
      const result = await window.ipc.invoke('oauth:connect', { provider: 'rowboat' })
      if (!result.success) {
        toast.error(result.error || 'Failed to sign in to Rowboat')
        setRowboat(prev => ({ ...prev, isConnecting: false }))
      }
    } catch (error) {
      console.error('Failed to sign in to Rowboat:', error)
      toast.error('Failed to sign in to Rowboat')
      setRowboat(prev => ({ ...prev, isConnecting: false }))
    }
  }, [])

  const space = useCompletionSpace(rowboat.isConnected)

  /** Leaving the space screen: a space made here goes on to invites; one
   *  someone else made (an invite already accepted) opens straight away. */
  const confirmSpace = useCallback((opts?: OnboardingCompleteOptions) => {
    void space.complete((landed, createdHere) => {
      setOrg(landed)
      if (createdHere) setCurrentStep(2)
      else onComplete(opts)
    })
  }, [space, onComplete])

  return {
    currentStep,
    setCurrentStep,
    rowboat,
    signIn,
    space,
    org,
    confirmSpace,
    finish: onComplete,
  }
}

export type OnboardingState = ReturnType<typeof useOnboardingState>
