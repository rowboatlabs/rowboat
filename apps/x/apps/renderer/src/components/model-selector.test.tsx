import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetModelsForTests } from '@/hooks/use-models'
import { ModelSelector } from './model-selector'

// Radix popper content needs these in jsdom.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub
Element.prototype.scrollIntoView = () => {}

// Same preload stub pattern as use-models.test.tsx: invoke routes by channel.
let handlers: Record<string, (args: unknown) => Promise<unknown>> = {}

;(window as unknown as { ipc: unknown }).ipc = {
  on: () => () => undefined,
  invoke: (channel: string, args: unknown) => {
    const handler = handlers[channel]
    return handler ? handler(args) : Promise.reject(new Error(`no handler: ${channel}`))
  },
}

function serveTwoProviders(): void {
  handlers['models:list'] = async () => ({
    providers: [
      { id: 'openai', flavor: 'openai', status: 'ok', models: [{ id: 'gpt-5.4' }] },
      { id: 'anthropic', flavor: 'anthropic', status: 'ok', models: [{ id: 'claude-opus-4-8' }] },
    ],
    defaultModel: { provider: 'openai', model: 'gpt-5.4' },
  })
}

async function openMenu(): Promise<void> {
  const trigger = screen.getByRole('button')
  // Radix opens the menu from the trigger's keydown handler in jsdom
  // (pointerdown would ALSO toggle — one gesture only).
  fireEvent.keyDown(trigger, { key: 'Enter' })
  await waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull())
}

beforeEach(() => {
  __resetModelsForTests()
  handlers = {}
})

afterEach(cleanup)

describe('ModelSelector', () => {
  it('renders the defaultOption label when value is null and round-trips null through onChange', async () => {
    serveTwoProviders()
    const onChange = vi.fn()
    render(
      <ModelSelector
        variant="field"
        value={{ provider: 'openai', model: 'gpt-5.4' }}
        onChange={onChange}
        defaultOption={{ label: 'Rowboat default' }}
      />,
    )
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('gpt-5.4'))

    await openMenu()
    const sentinel = await screen.findByText('Rowboat default')
    fireEvent.click(sentinel)
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('shows the sentinel as the trigger label when value is null', async () => {
    serveTwoProviders()
    render(
      <ModelSelector
        variant="field"
        value={null}
        onChange={() => {}}
        defaultOption={{ label: 'Same as assistant' }}
      />,
    )
    expect(screen.getByRole('button')).toHaveTextContent('Same as assistant')
  })

  it('providerFilter restricts the list to that provider', async () => {
    serveTwoProviders()
    render(
      <ModelSelector
        variant="field"
        value={null}
        onChange={() => {}}
        providerFilter="anthropic"
        defaultOption={{ label: 'Same as assistant' }}
      />,
    )
    await openMenu()
    await screen.findByText('claude-opus-4-8')
    expect(screen.queryByText('gpt-5.4')).toBeNull()
  })

  it('inheritDefault renders its label muted in the trigger when value is null', () => {
    serveTwoProviders()
    render(
      <ModelSelector
        variant="field"
        value={null}
        onChange={() => {}}
        inheritDefault={{ label: '(global default)' }}
      />,
    )
    const label = screen.getByText('(global default)')
    expect(label.className).toContain('text-muted-foreground')
  })

  it('un-scoped allowCustom splits "provider/model" on the first slash', async () => {
    serveTwoProviders()
    const onChange = vi.fn()
    render(
      <ModelSelector
        variant="field"
        value={null}
        onChange={onChange}
        inheritDefault={{ label: '(global default)' }}
        allowCustom
      />,
    )
    await openMenu()
    fireEvent.change(screen.getByPlaceholderText('Search models…'), {
      target: { value: 'openrouter/meituan/longcat-2.0' },
    })
    fireEvent.click(await screen.findByText('Use "openrouter/meituan/longcat-2.0"'))
    expect(onChange).toHaveBeenCalledWith({ provider: 'openrouter', model: 'meituan/longcat-2.0' })
  })

  it('un-scoped allowCustom pairs slash-less text with the default provider', async () => {
    serveTwoProviders()
    const onChange = vi.fn()
    render(
      <ModelSelector
        variant="field"
        value={null}
        onChange={onChange}
        inheritDefault={{ label: '(global default)' }}
        allowCustom
      />,
    )
    await openMenu()
    // Wait for the store snapshot (the default provider comes from it).
    await screen.findByText('claude-opus-4-8')
    fireEvent.change(screen.getByPlaceholderText('Search models…'), { target: { value: 'my-local-model' } })
    fireEvent.click(await screen.findByText('Use "my-local-model"'))
    expect(onChange).toHaveBeenCalledWith({ provider: 'openai', model: 'my-local-model' })
  })

  it('liveCredentials live-fetches a provider that is not saved anywhere', async () => {
    serveTwoProviders()
    // openrouter is absent from models.json AND the static catalog — only
    // the form's typed credentials can produce its list.
    handlers['models:listForProvider'] = async () => ({
      success: true,
      models: ['meituan/longcat-2.0', 'qwen/qwen-3'],
    })
    const onChange = vi.fn()
    render(
      <ModelSelector
        variant="field"
        value={null}
        onChange={onChange}
        providerFilter="openrouter"
        liveCredentials={{ flavor: 'openrouter', apiKey: 'sk-or-typed', baseURL: '' }}
        allowCustom
        defaultOption={{ label: 'Auto (recommended)' }}
      />,
    )
    await openMenu()
    // 600ms debounce in useProviderModels before the fetch fires.
    const row = await screen.findByText('meituan/longcat-2.0', undefined, { timeout: 3000 })
    expect(screen.queryByText('gpt-5.4')).toBeNull()
    fireEvent.click(row)
    expect(onChange).toHaveBeenCalledWith({ provider: 'openrouter', model: 'meituan/longcat-2.0' })
  })

  it('staticOptions renders only the supplied rows and round-trips ids and null', async () => {
    serveTwoProviders()
    const onChange = vi.fn()
    render(
      <ModelSelector
        variant="field"
        value={null}
        onChange={onChange}
        defaultOption={{ label: 'Default (recommended)' }}
        staticOptions={[
          { id: 'opus', label: 'Opus' },
          { id: 'claude-opus-4-8', label: 'Opus' },
          { id: 'sonnet', label: 'Sonnet' },
        ]}
      />,
    )
    await openMenu()
    // Only the caller's rows — nothing from the shared catalog store.
    expect(screen.queryByText('gpt-5.4')).toBeNull()
    expect(screen.queryByText('claude-opus-4-8', { selector: '[role="menuitemradio"] span' })).not.toBeNull()
    // Colliding "Opus" labels are disambiguated by their raw id.
    expect(screen.getAllByText('Opus')).toHaveLength(2)

    fireEvent.click(screen.getByText('Sonnet'))
    expect(onChange).toHaveBeenCalledWith({ provider: '', model: 'sonnet' })

    await openMenu()
    fireEvent.click(screen.getByText('Default (recommended)', { selector: '[role="menuitemradio"] span' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('allowCustom offers the typed id when nothing matches', async () => {
    serveTwoProviders()
    const onChange = vi.fn()
    render(
      <ModelSelector
        variant="field"
        value={null}
        onChange={onChange}
        providerFilter="anthropic"
        allowCustom
        defaultOption={{ label: 'Same as assistant' }}
      />,
    )
    await openMenu()
    fireEvent.change(screen.getByPlaceholderText('Search models…'), { target: { value: 'my-custom-model' } })
    const custom = await screen.findByText('Use "my-custom-model"')
    fireEvent.click(custom)
    expect(onChange).toHaveBeenCalledWith({ provider: 'anthropic', model: 'my-custom-model' })
  })
})
