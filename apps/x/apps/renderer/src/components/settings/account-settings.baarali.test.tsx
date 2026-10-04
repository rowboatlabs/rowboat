import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BillingInfo } from '@x/shared/dist/billing.js'

// BAARALI(03/10/2026): an admin's account links to the console, and only an
// admin's (control /v1/me hands the address to that account alone).

let billing: BillingInfo | null = null
vi.mock('@/hooks/useBilling', () => ({
  useBilling: () => ({ billing, isLoading: false, refresh: () => {} }),
}))
vi.mock('@/hooks/use-rowboat-config', () => ({ useRowboatConfig: () => null }))
vi.mock('@/components/settings/credit-rewards', () => ({ CreditRewards: () => null }))

;(window as unknown as { ipc: unknown }).ipc = {
  on: () => () => undefined,
  invoke: async (channel: string) => {
    if (channel === 'oauth:getState') return { config: { rowboat: { connected: true } } }
    return null
  },
}

import { AccountSettings } from './account-settings'

const info = (adminUrl: string | null): BillingInfo => ({
  userEmail: 'awa@example.com', userId: 'u', adminUrl, subscriptionPlanId: null, subscriptionStatus: null, trialExpiresAt: null,
  catalog: { plans: [] },
  monthly: { sanctionedCredits: 100, usedCredits: 0, availableCredits: 100 },
  daily: { sanctionedCredits: 100, usedCredits: 0, availableCredits: 100, usageDay: '' },
  store: { availableCredits: 0 },
}) as BillingInfo

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('AccountSettings, Baarali', () => {
  it('opens the console for an admin', async () => {
    billing = info('https://app.baarali.com/admin')
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<AccountSettings dialogOpen />)
    await waitFor(() => expect(screen.getByText('Admin console')).toBeTruthy())
    fireEvent.click(screen.getByText('Open the console'))
    expect(open).toHaveBeenCalledWith('https://app.baarali.com/admin')
  })

  it('shows nothing of it to anyone else', async () => {
    billing = info(null)
    render(<AccountSettings dialogOpen />)
    await waitFor(() => expect(screen.getByText('awa@example.com')).toBeTruthy())
    expect(screen.queryByText('Admin console')).toBeNull()
  })
})
