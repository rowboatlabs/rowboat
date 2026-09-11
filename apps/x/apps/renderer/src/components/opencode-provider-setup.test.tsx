import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { OpenCodeSetupState } from '@x/shared/dist/opencode-setup'
import { OpenCodeProviderSetup } from './opencode-provider-setup'
let state: OpenCodeSetupState, invoke: ReturnType<typeof vi.fn>
beforeEach(() => {
  state = { setupId: 'lease', generation: 1, providers: ['opencode-go', 'opencode', 'openai'].map(id => ({ id, name: id, connected: false, methods: [{ index: 0, type: 'api', label: 'API key', supported: true, prompts: [] }], models: [] })) }
  invoke = vi.fn(async (channel: string, args: any) => {
    if (channel === 'opencodeSetup:saveKey' || channel === 'opencodeSetup:disconnect') state = { ...state, providers: state.providers.map(p => p.id === args.providerId ? { ...p, connected: channel === 'opencodeSetup:saveKey' } : p) }
    return { success: true, data: state }
  })
  Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } })
})
afterEach(() => { cleanup(); localStorage.clear() })
it('offers only Go and Zen, explains public access, and keeps model selection out of Settings', async () => {
  render(<OpenCodeProviderSetup onClose={vi.fn()} />)
  await screen.findByLabelText('Account access')
  expect(screen.getAllByRole('option')).toHaveLength(2)
  expect(screen.getByText(/Free models work without an account/)).toBeTruthy()
  expect(screen.queryByLabelText('Model')).toBeNull()
  expect(screen.queryByText('Open managed login')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Open OpenCode account' }))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('opencodeSetup:openAccount', null))
})
it('saves only the selected account key, clears the field, and does not claim verification', async () => {
  render(<OpenCodeProviderSetup onClose={vi.fn()} />)
  const input = await screen.findByLabelText('OpenCode account API key')
  fireEvent.change(input, { target: { value: 'secret-test' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save account key' }))
  expect((input as HTMLInputElement).value).toBe('')
  await screen.findByText('Account key saved. Choose a model in Code mode.')
  expect(invoke).toHaveBeenCalledWith('opencodeSetup:saveKey', { setupId: 'lease', providerId: 'opencode-go', method: 0, key: 'secret-test' })
  expect(JSON.stringify(localStorage)).not.toContain('secret-test')
  expect(screen.queryByText(/Ready/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
  await screen.findByText('Account disconnected. Free models remain available in Code mode.')
  cleanup()
  expect(invoke).toHaveBeenCalledWith('opencodeSetup:stop', { setupId: 'lease' })
})
it('clears secrets when switching accounts and reports save failure honestly', async () => {
  render(<OpenCodeProviderSetup onClose={vi.fn()} />)
  const input = await screen.findByLabelText('OpenCode account API key')
  fireEvent.change(input, { target: { value: 'go-key' } })
  fireEvent.change(screen.getByLabelText('Account access'), { target: { value: 'opencode' } })
  expect((input as HTMLInputElement).value).toBe('')
  invoke.mockResolvedValueOnce({ success: false, error: { message: 'Could not save account key.' } })
  fireEvent.change(input, { target: { value: 'zen-key' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save account key' }))
  await screen.findByRole('alert')
  expect(screen.queryByText('Account key saved. Choose a model in Code mode.')).toBeNull()
})
it('stops a setup lease that arrives after the panel closes', async () => {
  let finish!: (result: unknown) => void
  invoke.mockImplementation((channel: string) => channel === 'opencodeSetup:start' ? new Promise(resolve => { finish = resolve }) : Promise.resolve({ success: true, data: null }))
  const panel = render(<OpenCodeProviderSetup onClose={vi.fn()} />)
  panel.unmount()
  finish({ success: true, data: state })
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('opencodeSetup:stop', { setupId: 'lease' }))
})
