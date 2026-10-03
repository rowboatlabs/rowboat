import type { MediaCredits, MediaHistoryEntry } from '@x/shared/dist/billing.js'
import { say } from '@/lib/say'
import { USAGE_TIME_ZONE } from '@/lib/usage-reset'

// The words of the media credits on the usage page (Baarali, 03/10/2026).

export const MEDIA: Record<string, string> = { image: 'Image', video: 'Video', speech: 'Voice', music: 'Music' }

export const when = new Intl.DateTimeFormat('fr-FR', { timeZone: USAGE_TIME_ZONE, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** "Top-up", "Video · Veo 3.1 Fast", "Refund · Veo 3.1 Fast". */
export function entryLabel(e: MediaHistoryEntry): string {
  // The pieces are joined with a model's name, which the page's translation
  // would not match: each word is asked for in the person's language first.
  if (e.kind === 'topup') return say('Top-up')
  const what = [e.media ? say(MEDIA[e.media] ?? e.media) : null, e.model].filter(Boolean).join(' · ') || say('Generation')
  return e.kind === 'refund' ? `${say('Refund')} · ${what}` : what
}

/** "5 €", "3 280 F CFA": a price in minor units, written. */
export function priceText(amount: number, currency: string): string {
  if (currency === 'EUR') return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(amount / 100)} €`
  if (currency === 'XOF' || currency === 'XAF') return `${new Intl.NumberFormat('fr-FR').format(amount)} F CFA`
  return `${amount} ${currency}`
}

/** "2 to 6 credits" per kind of media, from the models' prices. */
export function costRanges(costs: MediaCredits['costs']): { kind: string; text: string }[] {
  const byKind = new Map<string, number[]>()
  for (const c of costs) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c.credits])
  return [...byKind.entries()].map(([kind, list]) => {
    const lo = Math.min(...list)
    const hi = Math.max(...list)
    return { kind, text: lo === hi ? `${lo} credits` : `${lo} to ${hi} credits` }
  })
}
