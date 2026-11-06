import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"

export interface ProviderState {
  isConnected: boolean
  isLoading: boolean
  isConnecting: boolean
}

// Welcome, Providers (bring-your-own-key only), Space, Agents (2026-11-06:
// connecting email, calendar and Slack left onboarding for Local).
export type Step = 0 | 1 | 2 | 3

export type OnboardingPath = 'rowboat' | 'chatgpt' | 'byok' | null

export function useOnboardingState(open: boolean, onComplete: () => void) {
  const [currentStep, setCurrentStep] = useState<Step>(0)
  const [onboardingPath, setOnboardingPath] = useState<OnboardingPath>(null)

  // OAuth provider states (the Rowboat sign-in on Welcome)
  const [providers, setProviders] = useState<string[]>([])
  const [providersLoading, setProvidersLoading] = useState(true)
  const [providerStates, setProviderStates] = useState<Record<string, ProviderState>>({})

  useEffect(() => {
    if (!open) return

    async function loadProviders() {
      try {
        setProvidersLoading(true)
        const result = await window.ipc.invoke('oauth:list-providers', null)
        setProviders(result.providers || [])
      } catch (error) {
        console.error('Failed to get available providers:', error)
        setProviders([])
      } finally {
        setProvidersLoading(false)
      }
    }
    loadProviders()
  }, [open])

  const handleNext = useCallback(() => {
    if (currentStep < 3) setCurrentStep((currentStep + 1) as Step)
  }, [currentStep])

  const handleBack = useCallback(() => {
    if (currentStep === 1) {
      setCurrentStep(0)
      setOnboardingPath(null)
    } else if (currentStep > 1) {
      setCurrentStep((currentStep - 1) as Step)
    }
  }, [currentStep])

  const handleComplete = useCallback(() => {
    onComplete()
  }, [onComplete])

  // Check connection status for all providers
  const refreshAllStatuses = useCallback(async () => {
    if (providers.length === 0) return

    const newStates: Record<string, ProviderState> = {}

    try {
      const result = await window.ipc.invoke('oauth:getState', null)
      const config = result.config || {}
      for (const provider of providers) {
        newStates[provider] = {
          isConnected: config[provider]?.connected ?? false,
          isLoading: false,
          isConnecting: false,
        }
      }
    } catch (error) {
      console.error('Failed to check connection status for providers:', error)
      for (const provider of providers) {
        newStates[provider] = {
          isConnected: false,
          isLoading: false,
          isConnecting: false,
        }
      }
    }

    setProviderStates(newStates)
  }, [providers])

  // Refresh statuses when modal opens or providers list changes
  useEffect(() => {
    if (open && providers.length > 0) {
      refreshAllStatuses()
    }
  }, [open, providers, refreshAllStatuses])

  // Listen for OAuth completion events (state updates only — toasts handled by ConnectorsPopover)
  useEffect(() => {
    const cleanup = window.ipc.on('oauth:didConnect', (event) => {
      const { provider, success } = event

      setProviderStates(prev => ({
        ...prev,
        [provider]: {
          isConnected: success,
          isLoading: false,
          isConnecting: false,
        }
      }))
    })

    return cleanup
  }, [])

  const startConnect = useCallback(async (provider: string) => {
    setProviderStates(prev => ({
      ...prev,
      [provider]: { ...prev[provider], isConnecting: true }
    }))

    try {
      const result = await window.ipc.invoke('oauth:connect', { provider })

      if (!result.success) {
        toast.error(result.error || `Failed to connect to ${provider}`)
        setProviderStates(prev => ({
          ...prev,
          [provider]: { ...prev[provider], isConnecting: false }
        }))
      }
    } catch (error) {
      console.error('Failed to connect:', error)
      toast.error(`Failed to connect to ${provider}`)
      setProviderStates(prev => ({
        ...prev,
        [provider]: { ...prev[provider], isConnecting: false }
      }))
    }
  }, [])

  return {
    // Step state
    currentStep,
    setCurrentStep,
    onboardingPath,
    setOnboardingPath,

    // OAuth state
    providers,
    providersLoading,
    providerStates,
    startConnect,

    // Navigation
    handleNext,
    handleBack,
    handleComplete,
  }
}

export type OnboardingState = ReturnType<typeof useOnboardingState>
