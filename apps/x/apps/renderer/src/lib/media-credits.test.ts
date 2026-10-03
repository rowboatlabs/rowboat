import { describe, expect, it } from 'vitest'
import { costRanges, entryLabel, priceText } from './media-credits'

// The words of the media credits (Baarali, 03/10/2026).

describe('media credits', () => {
  it('names what each entry paid for', () => {
    expect(entryLabel({ at: '', kind: 'topup', credits: 150, media: null, model: null })).toBe('Top-up')
    expect(entryLabel({ at: '', kind: 'charge', credits: -40, media: 'video', model: 'Veo 3.1 Fast' })).toBe('Video · Veo 3.1 Fast')
    expect(entryLabel({ at: '', kind: 'refund', credits: 40, media: 'video', model: 'Veo 3.1 Fast' })).toBe('Refund · Video · Veo 3.1 Fast')
    expect(entryLabel({ at: '', kind: 'charge', credits: -2, media: null, model: null })).toBe('Generation')
  })

  it('writes a price in euros and in CFA francs', () => {
    expect(priceText(500, 'EUR')).toBe('5 €')
    expect(priceText(3280, 'XOF').replace(/\s/g, ' ')).toBe('3 280 F CFA')
  })

  it('gives each kind of media its range of credits', () => {
    expect(costRanges([
      { kind: 'image', name: 'A', credits: 2 }, { kind: 'image', name: 'B', credits: 6 }, { kind: 'speech', name: 'C', credits: 2 },
    ])).toEqual([{ kind: 'image', text: '2 to 6 credits' }, { kind: 'speech', text: '2 credits' }])
  })
})
