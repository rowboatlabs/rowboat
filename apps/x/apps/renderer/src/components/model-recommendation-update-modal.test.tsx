import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelRecommendationUpdateModal, type RecommendationUpdate } from './model-recommendation-update-modal'

// Same preload stub pattern as the other renderer tests: invoke routes by
// channel through a per-test handler map.
let handlers: Record<string, (args: unknown) => Promise<unknown>> = {}
const invokes: Array<{ channel: string; args: unknown }> = []

;(window as unknown as { ipc: unknown }).ipc = {
  on: () => () => undefined,
  invoke: (channel: string, args: unknown) => {
    invokes.push({ channel, args })
    const handler = handlers[channel]
    return handler ? handler(args) : Promise.reject(new Error(`no handler: ${channel}`))
  },
}

const UPDATE: RecommendationUpdate = {
  shouldShow: true,
  flavor: 'rowboat',
  providerId: 'rowboat',
  hash: 'abc',
  assistantModel: { provider: 'rowboat', model: 'google/gemini-3.5-flash' },
  rows: [
    {
      slot: 'assistantModel',
      current: { provider: 'rowboat', model: 'google/gemini-3.5-flash' },
      recommended: { provider: 'rowboat', model: 'Auto' },
    },
    { slot: 'knowledgeGraph', current: null, recommended: { provider: 'rowboat', model: 'Auto-background' } },
    { slot: 'chatTitle', current: { provider: 'rowboat', model: 'lite' }, recommended: null },
  ],
}

afterEach(() => { cleanup() })

beforeEach(() => {
  handlers = {}
  invokes.length = 0
  handlers['models:resolveRecommendationUpdate'] = async (args) => ({
    applied: (args as { apply: string[] }).apply,
  })
})

describe('ModelRecommendationUpdateModal', () => {
  it('renders one checked row per slot, with inherit rows spelled out', () => {
    render(<ModelRecommendationUpdateModal update={UPDATE} onClose={() => {}} />)
    expect(screen.getByRole('checkbox', { name: 'Assistant' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Knowledge graph' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Chat titles' })).toBeChecked()
    // knowledgeGraph's current and chatTitle's recommended both inherit.
    expect(screen.getAllByText('Same as Assistant')).toHaveLength(2)
    expect(screen.getByTitle('Same as Assistant (google/gemini-3.5-flash)')).toBeInTheDocument()
    expect(screen.getByText('Auto')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Switch to recommended models?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch' })).toBeEnabled()
  })

  it('applies exactly the checked slots and closes', async () => {
    const onClose = vi.fn()
    render(<ModelRecommendationUpdateModal update={UPDATE} onClose={onClose} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Knowledge graph' }))
    fireEvent.click(screen.getByRole('button', { name: 'Switch' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(invokes).toEqual([{
      channel: 'models:resolveRecommendationUpdate',
      args: { flavor: 'rowboat', hash: 'abc', apply: ['assistantModel', 'chatTitle'] },
    }])
  })

  it('"Not Now" answers with no slots', async () => {
    const onClose = vi.fn()
    render(<ModelRecommendationUpdateModal update={UPDATE} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Not Now' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(invokes).toEqual([{
      channel: 'models:resolveRecommendationUpdate',
      args: { flavor: 'rowboat', hash: 'abc', apply: [] },
    }])
  })

  it('the group checkbox toggles every task row', () => {
    render(<ModelRecommendationUpdateModal update={UPDATE} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Background tasks' }))
    expect(screen.getByRole('checkbox', { name: 'Knowledge graph' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Chat titles' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Assistant' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Switch' })).toBeEnabled()
    expect(screen.getByText(/Tasks you don't switch keep following the Assistant/)).toBeInTheDocument()
    // With every row unchecked there is nothing to switch.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Assistant' }))
    expect(screen.getByRole('button', { name: 'Switch' })).toBeDisabled()
  })

  it('renders nothing without a pending update', () => {
    const { container } = render(<ModelRecommendationUpdateModal update={null} onClose={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
