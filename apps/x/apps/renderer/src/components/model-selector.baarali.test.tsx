import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetModelsForTests } from '@/hooks/use-models'
import { ModelSelector } from './model-selector'

// BAARALI(03/10/2026): the gateway's models under a heading per vendor, with
// their strength, « Recommended », and a padlock on what a higher plan opens.

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub
Element.prototype.scrollIntoView = () => {}

const meta = (vendor: string, vendorName: string, vendorRank: number, extra: Record<string, unknown> = {}) =>
  ({ vendor, vendorName, vendorRank, strength: 'Polyvalent', recommended: false, ...extra })

;(window as unknown as { ipc: unknown }).ipc = {
  on: () => () => undefined,
  invoke: async (channel: string) => {
    if (channel !== 'models:list') throw new Error(`no handler: ${channel}`)
    return {
      providers: [{
        id: 'rowboat', flavor: 'rowboat', status: 'ok', models: [
          { id: 'openai/gpt-6', name: 'GPT-6', baarali: meta('openai', 'OpenAI', 1) },
          { id: 'anthropic/opus', name: 'Claude Opus', baarali: meta('anthropic', 'Anthropic', 0, { strength: 'Puissant', unlock: 'Pro max' }) },
          { id: 'anthropic/sonnet', name: 'Claude Sonnet', baarali: meta('anthropic', 'Anthropic', 0, { recommended: true }) },
        ],
      }],
      defaultModel: { provider: 'rowboat', model: 'anthropic/sonnet' },
    }
  },
}

beforeEach(() => __resetModelsForTests())
afterEach(cleanup)

describe('ModelSelector, Baarali', () => {
  it('sorts the gateway by vendor and keeps a padlocked model out of reach', async () => {
    const onChange = vi.fn()
    render(<ModelSelector variant="field" value={{ provider: 'rowboat', model: 'anthropic/sonnet' }} onChange={onChange} />)
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Claude Sonnet'))
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(document.querySelector('[cmdk-root]')).not.toBeNull())

    const text = document.querySelector('[cmdk-list]')!.textContent!
    expect(text.indexOf('Anthropic')).toBeLessThan(text.indexOf('Claude Sonnet'))
    expect(text.indexOf('Claude Sonnet')).toBeLessThan(text.indexOf('Claude Opus'))
    expect(text.indexOf('Claude Opus')).toBeLessThan(text.indexOf('OpenAI'))
    expect(screen.getByText('Recommended')).toBeTruthy()
    expect(screen.getByText(/from Pro max/)).toBeTruthy()

    const opus = screen.getByText('Claude Opus').closest('[cmdk-item]')!
    expect(opus.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(opus)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('GPT-6'))
    expect(onChange).toHaveBeenCalledWith({ provider: 'rowboat', model: 'openai/gpt-6' })
  })
})
