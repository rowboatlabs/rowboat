import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_LABELS } from '@/lib/email-labels'
import { EmailRail, type EmailRailSelection } from './email-rail'

afterEach(cleanup)

const COUNTS = { newsletter: 5, correspondence: 2, unclassified: 3 }

function renderRail(overrides: Partial<Parameters<typeof EmailRail>[0]> = {}) {
  const onSelect = vi.fn<(sel: EmailRailSelection) => void>()
  const onTogglePin = vi.fn()
  render(
    <EmailRail
      view="inbox"
      inboxFilter="all"
      otherCategory={null}
      categoryCounts={COUNTS}
      labels={BUILTIN_LABELS}
      draftCount={0}
      open
      onTogglePin={onTogglePin}
      onSelect={onSelect}
      {...overrides}
    />,
  )
  return { onSelect, onTogglePin }
}

describe('EmailRail', () => {
  it('renders the fixed views and one row per non-empty category', () => {
    renderRail()
    for (const label of ['All mail', 'Important', 'Everything else', 'Drafts']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    // Registry display names, pill order: News before Direct, Uncategorized last.
    expect(screen.getByText('News')).toBeTruthy()
    expect(screen.getByText('Direct')).toBeTruthy()
    expect(screen.getByText('Uncategorized')).toBeTruthy()
    // Everything-else total = sum of the section's category counts.
    expect(screen.getByText('10')).toBeTruthy()
  })

  it('reports selections for the fixed views', () => {
    const { onSelect } = renderRail()
    fireEvent.click(screen.getByText('Important'))
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'important' })
    fireEvent.click(screen.getByText('Drafts'))
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'drafts' })
    fireEvent.click(screen.getByText('Everything else'))
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'other' })
    fireEvent.click(screen.getByText('All mail'))
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'all' })
  })

  it('selects a category, and clicking the active category clears it', () => {
    const { onSelect } = renderRail()
    fireEvent.click(screen.getByText('News'))
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'other', category: 'newsletter' })

    cleanup()
    const second = renderRail({ inboxFilter: 'other', otherCategory: 'newsletter' })
    fireEvent.click(screen.getByText('News'))
    expect(second.onSelect).toHaveBeenLastCalledWith({ kind: 'other', category: null })
  })

  it('marks the active row', () => {
    renderRail({ inboxFilter: 'important' })
    const important = screen.getByText('Important').closest('button')
    const allMail = screen.getByText('All mail').closest('button')
    expect(important?.className).toContain('font-medium')
    expect(allMail?.className).not.toContain('font-medium')
  })

  it('highlights Drafts when the drafts view is open', () => {
    renderRail({ view: 'drafts' })
    expect(screen.getByText('Drafts').closest('button')?.className).toContain('font-medium')
  })

  it('collapses to an edge strip that reopens on click', () => {
    const { onTogglePin } = renderRail({ open: false })
    expect(screen.queryByText('All mail')).toBeNull()
    fireEvent.click(screen.getByTitle('Show mail filters'))
    expect(onTogglePin).toHaveBeenCalled()
  })
})
