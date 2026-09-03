// The email label set (chips, filter pills, rail rows, correction dropdown)
// comes from the backend label registry: built-ins (display names follow
// Superhuman's Auto Label vocabulary — Marketing / Pitch / News / Calendar)
// plus any labels the user defined in their agent instructions. The static
// copy of the built-ins is the fallback used until the registry loads, and
// for ids the registry no longer knows (a custom label the user later
// removed). Shared between the email view and its filter rail.

export interface EmailLabelInfo {
  id: string
  name: string
  kind: 'builtin' | 'custom'
}

export const BUILTIN_LABELS: EmailLabelInfo[] = [
  { id: 'correspondence', name: 'Direct', kind: 'builtin' },
  { id: 'meeting', name: 'Calendar', kind: 'builtin' },
  { id: 'notification', name: 'Notification', kind: 'builtin' },
  { id: 'newsletter', name: 'News', kind: 'builtin' },
  { id: 'promotion', name: 'Marketing', kind: 'builtin' },
  { id: 'cold_outreach', name: 'Pitch', kind: 'builtin' },
  { id: 'receipt', name: 'Receipt', kind: 'builtin' },
]

// Category order in the "Everything else" filter row and the rail's Categories
// section: noise first (that's what gets bulk-archived), then the rest of the
// built-ins; custom labels are appended in registry order at render time.
// 'unclassified' (threads the classifier hasn't reached yet) is always last
// and unarchivable.
export const BUILTIN_PILL_ORDER = ['newsletter', 'promotion', 'notification', 'cold_outreach', 'receipt', 'meeting', 'correspondence']

// Fallback for ids the registry doesn't know: "portfolio_updates" → "Portfolio updates".
export function prettifyLabelId(id: string): string {
  const words = id.replace(/_/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : id
}

export function labelNameFor(labels: EmailLabelInfo[], category: string): string {
  if (category === 'unclassified') return 'Uncategorized'
  return labels.find((l) => l.id === category)?.name ?? prettifyLabelId(category)
}

/** Categories with mail in them, in display order: built-ins, custom labels,
 *  stale ids still present in counts, then 'unclassified'. */
export function orderedCategoryIds(labels: EmailLabelInfo[], counts: Record<string, number>): string[] {
  return [
    ...BUILTIN_PILL_ORDER,
    ...labels.filter((l) => l.kind === 'custom').map((l) => l.id),
    // Stale custom ids still present in counts render too.
    ...Object.keys(counts).filter((c) => c !== 'unclassified' && !BUILTIN_PILL_ORDER.includes(c) && !labels.some((l) => l.id === c)),
    'unclassified',
  ].filter((c) => (counts[c] ?? 0) > 0)
}
