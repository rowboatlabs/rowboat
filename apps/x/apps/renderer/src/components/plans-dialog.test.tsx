import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PlanOffers } from '@x/shared/src/billing.js'
import { PlansDialog } from './plans-dialog'
import { closePlans, openPlans } from '@/lib/plans-window'

// The plans window (Baarali, 02/10/2026): what the control plane serves,
// laid out, with the person's plan marked — and no way out to a browser.

const OFFERS: PlanOffers = {
  lang: 'fr',
  lead: 'Votre utilisation se renouvelle toutes les 5 heures et chaque semaine.',
  soon: 'Paiement bientôt disponible',
  foot: 'Prix hors taxes.',
  plans: [
    { id: 'decouverte', name: 'Découverte', tag: 'Pour essayer', for: 'Pour découvrir.', plus: 'Inclus', points: ['Des recherches'], featured: false, free: true, levels: [{ id: 'decouverte', label: null, price: null, per: 'pour toujours', note: null }] },
    { id: 'essentiel', name: 'Essentiel', tag: 'Le quotidien', for: 'Chaque jour.', plus: 'Tout Découverte, et :', points: ['Tous les modèles'], featured: true, free: false, levels: [{ id: 'essentiel', label: null, price: { xof: '13 119 F CFA', eur: '20 €' }, per: 'par mois', note: 'À l’année : −10 %' }] },
    { id: 'pro-100', name: 'Pro', tag: 'Gros besoins', for: 'Toute la journée.', plus: 'Tout Essentiel, et :', points: ['Cinq ou dix fois'], featured: false, free: false, levels: [
      { id: 'pro-100', label: '×5', price: { xof: '65 596 F CFA', eur: '100 €' }, per: 'par mois', note: null },
      { id: 'pro-200', label: '×10', price: { xof: '131 191 F CFA', eur: '200 €' }, per: 'par mois', note: null },
    ] },
  ],
}

const bucket = { sanctionedCredits: 100, usedCredits: 8, availableCredits: 92 }
const BILLING = {
  userEmail: 'a@b.c', userId: 'u', subscriptionPlanId: 'decouverte', subscriptionStatus: 'active', trialExpiresAt: null,
  catalog: { plans: [] }, monthly: { ...bucket, resetsAt: '2026-10-06T01:45:00Z' }, daily: { ...bucket, usageDay: '' }, store: { availableCredits: 0 },
}

beforeEach(() => {
  closePlans()
  try { window.localStorage.clear() } catch { /* jsdom without storage */ }
  ;(window as unknown as { ipc: unknown }).ipc = {
    invoke: async (channel: string) => (channel === 'billing:getPlans' ? OFFERS : channel === 'billing:getInfo' ? BILLING : null),
    on: () => () => {},
  }
})

describe('PlansDialog', () => {
  it('shows the plans with the person\'s own marked, in CFA francs first', async () => {
    render(<PlansDialog />)
    act(() => openPlans())
    await waitFor(() => expect(screen.getByText('Essentiel')).toBeTruthy())
    expect(screen.getByText('Your plan')).toBeTruthy()
    expect(screen.getByText('Current plan')).toBeTruthy()
    expect(screen.getByText('13 119 F CFA')).toBeTruthy()
    expect(screen.getAllByText('Paiement bientôt disponible')).toHaveLength(2)
    expect(screen.getByText(/This week: 8% used/)).toBeTruthy()
  })

  it('switches currency, and Pro between its levels', async () => {
    render(<PlansDialog />)
    act(() => openPlans())
    await waitFor(() => expect(screen.getByText('65 596 F CFA')).toBeTruthy())
    fireEvent.click(screen.getByRole('radio', { name: '×10' }))
    expect(screen.getByText('131 191 F CFA')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Euros' }))
    expect(screen.getByText('200 €')).toBeTruthy()
  })
})
