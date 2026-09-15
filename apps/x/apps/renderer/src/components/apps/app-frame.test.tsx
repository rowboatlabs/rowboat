import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { rowboatApp } from '@x/shared'
import { AppFrame } from './app-frame'
import type { AppActivity } from './app-activity'
vi.mock('@/lib/analytics', () => ({ appOpened: vi.fn() }))
vi.mock('./app-detail', () => ({ AppDetail: () => <div>Details</div> }))
vi.mock('./publish-dialog', () => ({ PublishDialog: () => <div>Publish</div> }))
const app = {
  folder: 'test-app',
  origin: 'http://test-app.apps.localhost:3210',
  status: 'ok',
  kind: 'local',
  hasDist: true,
  readiness: 'ready',
  agentSlugs: [],
  manifest: {
    schemaVersion: 1,
    name: 'test-app',
    version: '1.0.0',
    description: '',
    entry: 'index.html',
    agents: [],
    capabilities: [],
    dataContracts: []
  }
} as rowboatApp.AppSummary
const activity = {
  tasks: [],
  error: null,
  refresh: vi.fn(),
  running: () => false,
  run: vi.fn(),
  failure: () => undefined
} as AppActivity
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.useRealTimers()
})
describe('app preview health', () => {
  it('requires a signal from the actual app, not iframe load or another sender', () => {
    const onEdit = vi.fn()
    render(
      <AppFrame
        app={app}
        activity={activity}
        onBack={vi.fn()}
        onEdit={onEdit}
      />
    )
    const frame = screen.getByTitle('Test app') as HTMLIFrameElement
    fireEvent.load(frame)
    expect(screen.getByText('Opening Test app…')).toBeInTheDocument()
    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: app.origin,
          source: window,
          data: { type: 'rowboat:app-health', state: 'loaded' }
        })
      )
    )
    expect(screen.getByText('Opening Test app…')).toBeInTheDocument()
    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: app.origin,
          source: frame.contentWindow!,
          data: { type: 'rowboat:app-health', state: 'loaded' }
        })
      )
    )
    expect(screen.queryByText('Opening Test app…')).not.toBeInTheDocument()
    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: app.origin,
          source: frame.contentWindow!,
          data: {
            type: 'rowboat:app-health',
            state: 'error',
            message: 'Data connection failed'
          }
        })
      )
    )
    fireEvent.click(screen.getByRole('button', { name: 'Fix with copilot' }))
    expect(onEdit).toHaveBeenCalledWith('Data connection failed')
  })
  it('keeps unfinished apps out of the iframe and offers continuation', () => {
    const onContinue = vi.fn()
    render(
      <AppFrame
        app={{ ...app, readiness: 'building' }}
        activity={activity}
        onBack={vi.fn()}
        onEdit={vi.fn()}
        onContinue={onContinue}
      />
    )
    expect(screen.queryByTitle('Test app')).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue building' })
    )
    expect(onContinue).toHaveBeenCalled()
  })
  it('offers recovery when the app never responds', () => {
    vi.useFakeTimers()
    render(
      <AppFrame
        app={app}
        activity={activity}
        onBack={vi.fn()}
        onEdit={vi.fn()}
      />
    )
    act(() => vi.advanceTimersByTime(10000))
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(screen.getByText('Opening Test app…')).toBeInTheDocument()
  })
})
