import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { OpenCodeEngineSettings } from './opencode-engine-settings'
vi.mock('@xterm/xterm', () => ({ Terminal: vi.fn() }))

afterEach(cleanup)

it('reports installation without claiming readiness, and re-check clears a missing executable', async () => {
  let installed = true
  const invoke = vi.fn(async () => ({ installed, version: '1.18.30', supported: true, connection: 'setup-unavailable', ready: false }))
  Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } })
  render(<OpenCodeEngineSettings active />)
  await screen.findByText(/Installed\. Choose a free model/)
  expect(screen.queryByText('Ready')).toBeNull()
  installed = false
  fireEvent.click(screen.getByRole('button', { name: 'Re-check' }))
  await screen.findByText('Not installed')
  expect(screen.getByRole('button', { name: 'Enable' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Remove engine' })).toBeNull()
})

it('removes only through engine removal IPC and refreshes installation', async () => {
  let installed = true
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'codeMode:removeOpenCodeEngine') { installed = false; return { success: true } }
    return { installed, version: '1.18.30', supported: true, connection: 'setup-unavailable', ready: false }
  })
  Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } })
  render(<OpenCodeEngineSettings active />)
  fireEvent.click(await screen.findByRole('button', { name: 'Remove engine' }))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('codeMode:removeOpenCodeEngine', null))
  await screen.findByText('Not installed')
})
