import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BillingInfo } from '@x/shared/dist/billing.js'
import { UsagePopover } from './sidebar-session-gauge'
import { closePlans, isPlansOpen } from '@/lib/plans-window'

// The usage ring at the bottom of the sidebar (Baarali, 03/10/2026): a click
// tells the session and the week, and leads to the usage page and the plans.

afterEach(() => { cleanup(); vi.useRealTimers() })

const billing = (resetsAt?: string): BillingInfo => ({
  userEmail: 'awa@example.com', userId: 'u', subscriptionPlanId: null, subscriptionStatus: null, trialExpiresAt: null,
  catalog: { plans: [] },
  monthly: { sanctionedCredits: 100, usedCredits: 21, availableCredits: 79, resetsAt: '2026-10-06T01:45:00Z' },
  daily: { sanctionedCredits: 100, usedCredits: 64, availableCredits: 36, usageDay: '', ...(resetsAt ? { resetsAt } : {}) },
  store: { availableCredits: 0 },
}) as BillingInfo

const openRing = () => fireEvent.click(screen.getByLabelText('Usage'))

describe('UsagePopover', () => {
  it('tells the open session and the week', () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-02T16:34:00Z') })
    render(<UsagePopover billing={billing('2026-10-02T19:42:00Z')} planName="Découverte" upgradeLabel="Upgrade" />)
    openRing()
    expect(screen.getByText('Plan usage limits · Découverte')).toBeTruthy()
    expect(screen.getByText('64%')).toBeTruthy()
    expect(screen.getByText('Resets in 3 h 08 · at 19:42 GMT')).toBeTruthy()
    expect(screen.getByText('21%')).toBeTruthy()
    expect(screen.getByText(/\(in 3 d 9 h\)/)).toBeTruthy()
  })

  it('counts nothing spent while no session is open', () => {
    render(<UsagePopover billing={billing()} planName={null} upgradeLabel="Upgrade" />)
    openRing()
    expect(screen.getByText('0%')).toBeTruthy()
    expect(screen.getByText('Starts with your next message')).toBeTruthy()
  })

  it('leads to the usage page and to the plans', () => {
    const usage = vi.fn()
    closePlans()
    render(<UsagePopover billing={billing()} planName={null} upgradeLabel="Upgrade" onOpenUsage={usage} />)
    openRing()
    fireEvent.click(screen.getByText('See usage'))
    expect(usage).toHaveBeenCalled()
    fireEvent.click(screen.getByText('Upgrade'))
    expect(isPlansOpen()).toBe(true)
    closePlans()
  })
})
