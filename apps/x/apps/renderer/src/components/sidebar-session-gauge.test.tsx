import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BillingInfo } from '@x/shared/dist/billing.js'
import { SessionGauge } from './sidebar-session-gauge'
import { closePlans, isPlansOpen } from '@/lib/plans-window'

// The bottom of the sidebar (Baarali, 02/10/2026): the session spent, when
// it starts over, and the way to a bigger plan.

afterEach(() => { cleanup(); vi.useRealTimers() })

const billing = (resetsAt?: string): BillingInfo => ({
  userEmail: 'awa@example.com', userId: 'u', subscriptionPlanId: null, subscriptionStatus: null, trialExpiresAt: null,
  catalog: { plans: [] },
  monthly: { sanctionedCredits: 100, usedCredits: 21, availableCredits: 79 },
  daily: { sanctionedCredits: 100, usedCredits: 64, availableCredits: 36, usageDay: '', ...(resetsAt ? { resetsAt } : {}) },
  store: { availableCredits: 0 },
}) as BillingInfo

describe('SessionGauge', () => {
  it('shows the open session and its countdown', () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-02T16:34:00Z') })
    render(<SessionGauge billing={billing('2026-10-02T19:42:00Z')} upgradeLabel="Upgrade" />)
    expect(screen.getByText('64%')).toBeTruthy()
    expect(screen.getByText('Resets in 3 h 08')).toBeTruthy()
  })

  it('shows nothing spent while no session is open', () => {
    render(<SessionGauge billing={billing()} upgradeLabel="Upgrade" />)
    expect(screen.getByText('0%')).toBeTruthy()
    expect(screen.getByText('Starts with your next message')).toBeTruthy()
  })

  it('opens the plans inside the app', () => {
    closePlans()
    render(<SessionGauge billing={billing()} upgradeLabel="Upgrade" />)
    fireEvent.click(screen.getByText('Upgrade'))
    expect(isPlansOpen()).toBe(true)
    closePlans()
  })
})
