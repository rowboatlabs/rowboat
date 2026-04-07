import { useState, useEffect, useCallback } from 'react'

interface BillingInfo {
  userEmail: string | null
  userId: string | null
  subscriptionPlan: string | null
  subscriptionStatus: string | null
  trialExpiresAt: string | null
  sanctionedCredits: number
  availableCredits: number
}

export function useBilling(isRowboatConnected: boolean) {
  const [billing, setBilling] = useState<BillingInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const fetchBilling = useCallback(async () => {
    if (!isRowboatConnected) {
      setBilling(null)
      return
    }
    try {
      setIsLoading(true)
      const result = await window.ipc.invoke('billing:getInfo', null)
      setBilling(result)
    } catch (error) {
      console.error('Failed to fetch billing info:', error)
      setBilling(null)
    } finally {
      setIsLoading(false)
    }
  }, [isRowboatConnected])

  useEffect(() => {
    fetchBilling()
  }, [fetchBilling])

  return { billing, isLoading, refresh: fetchBilling }
}
