import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BillingInfo } from '@x/shared/dist/billing.js'
import { UsagePanel } from './usage-panel'

// The usage panel (Baarali, 02/10/2026): what is left, and when it starts over.

afterEach(() => { cleanup(); vi.useRealTimers() })

const NOW = Date.parse('2026-10-02T16:34:00Z')
const billing = (sessionResetsAt?: string): BillingInfo => ({
  userEmail: 'awa@example.com', userId: 'u', subscriptionPlanId: null, subscriptionStatus: null, trialExpiresAt: null,
  catalog: { plans: [] },
  monthly: { sanctionedCredits: 100, usedCredits: 21, availableCredits: 79, resetsAt: '2026-10-06T01:45:00Z' },
  daily: { sanctionedCredits: 100, usedCredits: 64, availableCredits: 36, usageDay: '', ...(sessionResetsAt ? { resetsAt: sessionResetsAt } : {}) },
  store: { availableCredits: 0 },
}) as BillingInfo

describe('UsagePanel', () => {
  it('says what is left, with countdowns in hours and in days', () => {
    vi.useFakeTimers({ now: NOW })
    render(<UsagePanel billing={billing('2026-10-02T19:42:00Z')} loadedAt={NOW} onRefresh={() => {}} refreshing={false} />)
    expect(screen.getByText('You have 36% of your session and 79% of your week left.')).toBeTruthy()
    expect(screen.getByText(/\(in 3 h 08\)/)).toBeTruthy()
    expect(screen.getByText(/\(in 3 d 9 h\)/)).toBeTruthy()
    expect(screen.getByText('64% used')).toBeTruthy()
    expect(screen.getByText('Last updated: just now')).toBeTruthy()
  })

  it('counts nothing spent before the session opens', () => {
    vi.useFakeTimers({ now: NOW })
    render(<UsagePanel billing={billing()} loadedAt={NOW} onRefresh={() => {}} refreshing={false} />)
    expect(screen.getByText('Your session starts with your next message. 79% of your week is left.')).toBeTruthy()
    expect(screen.getByText('0% used')).toBeTruthy()
  })

  it('refreshes on demand', () => {
    const refresh = vi.fn()
    render(<UsagePanel billing={billing()} loadedAt={Date.now()} onRefresh={refresh} refreshing={false} />)
    fireEvent.click(screen.getByLabelText('Refresh'))
    expect(refresh).toHaveBeenCalled()
  })
})
