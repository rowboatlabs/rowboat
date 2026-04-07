import { useState, useEffect, useCallback, useRef } from 'react'

interface BillingInfo {
  userEmail: string | null
  userId: string | null
  subscriptionPlan: string | null
  subscriptionStatus: string | null
  trialDaysRemaining: number | null
  sanctionedCredits: number
  availableCredits: number
}

const POLLING_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

export function useBilling(isRowboatConnected: boolean) {
  const [billing, setBilling] = useState<BillingInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchBilling = useCallback(async () => {
    if (!isRowboatConnected) {
      setBilling(null)
      return
    }
    try {
      setIsLoading(true)
      const result = await window.ipc.invoke('billing:getInfo', null)
      setBilling({
        ...result,
        trialDaysRemaining: result.trialDaysRemaining ?? null,
      })
    } catch (error) {
      console.error('Failed to fetch billing info:', error)
      setBilling(null)
    } finally {
      setIsLoading(false)
    }
  }, [isRowboatConnected])

  // Fetch on mount / when connection state changes, and poll every 5 minutes
  useEffect(() => {
    fetchBilling()

    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    if (isRowboatConnected) {
      intervalRef.current = setInterval(fetchBilling, POLLING_INTERVAL_MS)
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [fetchBilling, isRowboatConnected])

  // Also refetch when OAuth connection completes (e.g. on app launch auto-reconnect)
  useEffect(() => {
    const cleanup = window.ipc.on('oauth:didConnect', (event) => {
      if (event.provider === 'rowboat') {
        fetchBilling()
      }
    })
    return cleanup
  }, [fetchBilling])

  return { billing, isLoading, refresh: fetchBilling }
}
