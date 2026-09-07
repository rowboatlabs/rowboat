import { describe, expect, it } from 'vitest'
import { BUILTIN_LABELS, labelNameFor, orderedCategoryIds, prettifyLabelId } from './email-labels'

describe('labelNameFor', () => {
  it('maps unclassified to Uncategorized', () => {
    expect(labelNameFor(BUILTIN_LABELS, 'unclassified')).toBe('Uncategorized')
  })

  it('uses the registry name when known', () => {
    expect(labelNameFor(BUILTIN_LABELS, 'newsletter')).toBe('News')
  })

  it('prettifies unknown ids', () => {
    expect(labelNameFor(BUILTIN_LABELS, 'portfolio_updates')).toBe('Portfolio updates')
    expect(prettifyLabelId('cold_outreach')).toBe('Cold outreach')
  })
})

describe('orderedCategoryIds', () => {
  it('orders builtins first, then custom, then stale ids, then unclassified — dropping empty ones', () => {
    const labels = [...BUILTIN_LABELS, { id: 'investor', name: 'Investor', kind: 'custom' as const }]
    const counts = {
      correspondence: 2,
      newsletter: 5,
      investor: 1,
      removed_label: 3, // stale id no longer in the registry
      unclassified: 4,
      receipt: 0, // empty categories don't render
    }
    expect(orderedCategoryIds(labels, counts)).toEqual([
      'newsletter', 'correspondence', 'investor', 'removed_label', 'unclassified',
    ])
  })

  it('returns nothing when there are no counts', () => {
    expect(orderedCategoryIds(BUILTIN_LABELS, {})).toEqual([])
  })
})
