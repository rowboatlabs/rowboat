import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AppChatDialog } from './app-chat-dialog'
import { rememberApp } from '@/lib/app-history'
afterEach(() => {
  cleanup()
  localStorage.clear()
})
const request = { folder: 'test-app', prompt: '' }
function setup(enabled = true) {
  const invoke = vi.fn(async (channel: string) =>
    channel === 'codeMode:getConfig'
      ? { enabled }
      : {
          claude: { installed: true, signedIn: true },
          codex: { installed: true, signedIn: false }
        }
  )
  Object.defineProperty(window, 'ipc', {
    configurable: true,
    value: { invoke }
  })
  const onContinue = vi.fn().mockResolvedValue(undefined)
  render(
    <AppChatDialog
      request={request}
      onClose={vi.fn()}
      onContinue={onContinue}
    />
  )
  return { invoke, onContinue }
}
it('offers usable agents and keeps the current conversation by default', async () => {
  const { onContinue } = setup()
  const picker = await screen.findByRole('combobox', {
    name: 'Building assistant'
  })
  expect(
    screen.queryByRole('option', { name: 'Codex' })
  ).not.toBeInTheDocument()
  fireEvent.change(picker, { target: { value: 'claude' } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue in this chat' }))
  await waitFor(() =>
    expect(onContinue).toHaveBeenCalledWith(request, 'claude', false)
  )
})
it('only requests a fresh session when explicitly selected', async () => {
  const { onContinue, invoke } = setup(false)
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Continue in this chat' })
    ).toBeEnabled()
  )
  expect(invoke).not.toHaveBeenCalledWith('codeMode:checkAgentStatus', null)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Start a new chat' }))
  fireEvent.click(screen.getByRole('button', { name: 'Start new chat' }))
  await waitFor(() =>
    expect(onContinue).toHaveBeenCalledWith(request, undefined, true)
  )
})
it('restores the app’s chosen agent', async () => {
  rememberApp(request.folder, {
    conversationId: 'saved-session',
    codeMode: 'claude'
  })
  setup()
  expect(await screen.findByRole('combobox')).toHaveValue('claude')
})
