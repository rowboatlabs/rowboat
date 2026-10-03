import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BillingInfo } from '@x/shared/dist/billing.js'
import { UsageView } from './usage-settings'

// Settings › Usage (Baarali, 03/10/2026): what is left, when it started and
// starts over, and at what pace the week can be spent.

afterEach(() => { cleanup(); vi.useRealTimers() })

const NOW = Date.parse('2026-10-02T16:34:00Z')
const billing = (sessionResetsAt?: string, bonus = 0): BillingInfo => ({
  userEmail: 'awa@example.com', userId: 'u', subscriptionPlanId: null, subscriptionStatus: null, trialExpiresAt: null,
  catalog: { plans: [] },
  monthly: { sanctionedCredits: 100, usedCredits: 21, availableCredits: 79, resetsAt: '2026-10-06T01:45:00Z' },
  daily: { sanctionedCredits: 100, usedCredits: 64, availableCredits: 36, usageDay: '', ...(sessionResetsAt ? { resetsAt: sessionResetsAt } : {}) },
  store: { availableCredits: bonus },
}) as BillingInfo

describe('UsageView', () => {
  it('tells an open session: what is left, when it started, when it ends', () => {
    vi.useFakeTimers({ now: NOW })
    render(<UsageView billing={billing('2026-10-02T19:42:00Z')} loadedAt={NOW} onRefresh={() => {}} refreshing={false} />)
    expect(screen.getByText('You have 36% of your session and 79% of your week left.')).toBeTruthy()
    expect(screen.getByText('Resets at 19:42 GMT (in 3 h 08)')).toBeTruthy()
    expect(screen.getByText('Started at 14:42 GMT')).toBeTruthy()
    expect(screen.getByText(/\(in 3 d 9 h\)/)).toBeTruthy()
    expect(screen.getByText('About 19% a day for the 4 days left')).toBeTruthy()
    expect(screen.getByText('64% used')).toBeTruthy()
    expect(screen.getByText('Last updated: just now')).toBeTruthy()
  })

  it('before the session opens, says until when one opened now would run', () => {
    vi.useFakeTimers({ now: NOW })
    render(<UsageView billing={billing()} loadedAt={NOW} onRefresh={() => {}} refreshing={false} />)
    expect(screen.getByText('Your session starts with your next message. 79% of your week is left.')).toBeTruthy()
    expect(screen.getByText('A message sent now opens a session until 21:34 GMT')).toBeTruthy()
    expect(screen.getByText('0% used')).toBeTruthy()
  })

  it('shows bonus credits only when there are some', () => {
    render(<UsageView billing={billing(undefined, 40)} loadedAt={Date.now()} onRefresh={() => {}} refreshing={false} />)
    expect(screen.getByText('40 credits')).toBeTruthy()
    cleanup()
    render(<UsageView billing={billing()} loadedAt={Date.now()} onRefresh={() => {}} refreshing={false} />)
    expect(screen.queryByText('Bonus credits')).toBeNull()
  })

  it('refreshes on demand', () => {
    const refresh = vi.fn()
    render(<UsageView billing={billing()} loadedAt={Date.now()} onRefresh={refresh} refreshing={false} />)
    fireEvent.click(screen.getByLabelText('Refresh'))
    expect(refresh).toHaveBeenCalled()
  })
})
