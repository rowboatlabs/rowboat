import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BackgroundTaskSummary } from '@x/shared/dist/background-task.js'
import { BgTaskCard } from './bg-task-card'

// A scheduled task as a card (Baarali, 02/10/2026).

afterEach(cleanup)

const task = (over: Partial<BackgroundTaskSummary> = {}): BackgroundTaskSummary => ({
  slug: 'resume-du-matin', name: 'Résumé du matin', instructions: 'Résume mes e-mails non lus.\nEn cinq lignes.',
  active: true, triggers: { cronExpr: '0 7 * * *' }, createdAt: '2026-10-01T00:00:00Z', ...over,
})

const props = (over: Partial<Parameters<typeof BgTaskCard>[0]> = {}) => ({
  task: task(), lastRun: '2h ago', running: false, stopping: false, busy: false, updating: false,
  onOpen: vi.fn(), onToggleActive: vi.fn(), onRun: vi.fn(), onStop: vi.fn(), menu: null, ...over,
})

describe('BgTaskCard', () => {
  it('says what the task does and when, in words', () => {
    render(<BgTaskCard {...props()} />)
    expect(screen.getByText('Résumé du matin')).toBeTruthy()
    expect(screen.getByText('Résume mes e-mails non lus.')).toBeTruthy()
    expect(screen.getByText('Every day at 07:00 GMT')).toBeTruthy()
    expect(screen.getByText('Last run 2h ago')).toBeTruthy()
    expect(screen.queryByText('resume-du-matin')).toBeNull()
  })

  it('runs now without opening a menu', () => {
    const p = props()
    render(<BgTaskCard {...p} />)
    fireEvent.click(screen.getByText('Run now'))
    expect(p.onRun).toHaveBeenCalled()
  })

  it('says a run failed, and why', () => {
    render(<BgTaskCard {...props({ task: task({ lastRunError: 'Gmail is not connected' }) })} />)
    expect(screen.getByText('Last run failed')).toBeTruthy()
    expect(screen.getByText('Gmail is not connected')).toBeTruthy()
  })

  it('describes the morning planner instead of quoting its doctrine', () => {
    render(<BgTaskCard {...props({ task: task({ slug: 'morning-planner', name: 'Morning planner', instructions: 'Each morning, propose a FEW high-signal to-do items', active: false, triggers: { windows: [{ startTime: '06:30', endTime: '09:30' }] } }), lastRun: null })} />)
    expect(screen.getByText(/Suggests up to three to-dos each morning/)).toBeTruthy()
    expect(screen.queryByText(/high-signal/)).toBeNull()
    expect(screen.getByText('Every day between 06:30 and 09:30 GMT')).toBeTruthy()
    expect(screen.getByText('Never run')).toBeTruthy()
    expect(screen.getByText('Paused')).toBeTruthy()
  })

  it('offers Stop while it runs', () => {
    const p = props({ running: true })
    render(<BgTaskCard {...p} />)
    fireEvent.click(screen.getByText('Stop'))
    expect(p.onStop).toHaveBeenCalled()
  })
})
