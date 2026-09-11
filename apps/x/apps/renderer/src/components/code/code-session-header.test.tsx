import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CodeSession } from '@x/shared/src/code-sessions.js'
import { CodeSessionHeader } from './code-session-header'
import { fetchCodeAgentOptions } from './code-agent-options'
import { refreshCodeSessions } from './use-code-sessions'
import { toast } from 'sonner'

vi.mock('./code-agent-options', async importOriginal => ({
  ...await importOriginal<typeof import('./code-agent-options')>(),
  fetchCodeAgentOptions: vi.fn(),
}))
vi.mock('./use-code-sessions', () => ({ refreshCodeSessions: vi.fn() }))
vi.mock('./code-agent-status', () => ({ AGENT_LABEL: { opencode: 'OpenCode' }, fetchCodeAgentsStatus: async () => null, isAgentReady: () => true }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const session: CodeSession = { id: 'session', projectId: 'project', title: 'Example', agent: 'opencode', cwd: '/project with spaces', createdAt: '2026-09-11T00:00:00Z', agentModel: 'opencode/free' }
const options = { models: [{ value: 'opencode/free', label: 'Free model' }, { value: 'opencode-go/model', label: 'Go model' }], efforts: [], currentModel: 'opencode/free' }
let invoke: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchCodeAgentOptions).mockResolvedValue(options)
  invoke = vi.fn().mockResolvedValue(session)
  Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } })
})
afterEach(cleanup)
function setup(status: 'idle' | 'working' = 'idle') {
  return render(<CodeSessionHeader session={session} status={status} changedCount={0} panel={null} onTogglePanel={vi.fn()} />)
}
function openModels() {
  fireEvent.keyDown(screen.getByRole('button', { name: 'Choose coding model' }), { key: 'ArrowDown' })
}

it('exposes the native model picker directly and persists the qualified selection', async () => {
  setup()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Choose coding model' })).toHaveTextContent('Free model'))
  expect(fetchCodeAgentOptions).toHaveBeenCalledWith('opencode', session.cwd, session.agentModel, undefined)
  openModels()
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Go model' }))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('codeSession:update', { sessionId: 'session', patch: { agentModel: 'opencode-go/model' } }))
  expect(refreshCodeSessions).toHaveBeenCalled()
})

it('shows loading, reports discovery failure and retries in the same picker', async () => {
  let reject!: (error: Error) => void
  vi.mocked(fetchCodeAgentOptions).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
  setup()
  openModels()
  expect(await screen.findByRole('status')).toHaveTextContent('Loading models')
  reject(new Error('Engine unavailable'))
  expect(await screen.findByRole('alert')).toHaveTextContent('Engine unavailable')
  fireEvent.click(screen.getByRole('menuitem', { name: 'Refresh models' }))
  expect(await screen.findByRole('menuitemradio', { name: 'Go model' })).toBeTruthy()
})

it('does not claim that a rejected model change succeeded', async () => {
  invoke.mockRejectedValue(new Error('Model unavailable'))
  setup()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Choose coding model' })).toHaveTextContent('Free model'))
  openModels()
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Go model' }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Model unavailable'))
  expect(refreshCodeSessions).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Choose coding model' })).toHaveTextContent('Free model')
})

it('shows models while working but prevents changing them mid-operation', async () => {
  setup('working')
  openModels()
  expect(await screen.findByRole('menuitemradio', { name: 'Go model' })).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByText('Stop the current operation before changing models.')).toBeTruthy()
  expect(invoke).not.toHaveBeenCalled()
})


it('shows a Go/Zen switch for dual connections and only the chosen service models', async () => {
  vi.mocked(fetchCodeAgentOptions).mockResolvedValue({ ...options, openCodeProviders: ['zen', 'go'] })
  setup()
  openModels()
  expect(await screen.findByRole('group', { name: 'OpenCode service' })).toBeTruthy()
  expect(screen.getByRole('menuitemradio', { name: 'Free model' })).toBeTruthy()
  expect(screen.queryByRole('menuitemradio', { name: 'Go model' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Go' }))
  expect(screen.getByRole('menuitemradio', { name: 'Go model' })).toBeTruthy()
  expect(screen.queryByRole('menuitemradio', { name: 'Free model' })).toBeNull()
  // Browsing a service alone must not silently change the selected coding model.
  expect(invoke).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Go model' }))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('codeSession:update', { sessionId: 'session', patch: { agentModel: 'opencode-go/model' } }))
})

it('refreshes from Go-only to public free options on account disconnect', async () => {
  vi.mocked(fetchCodeAgentOptions).mockResolvedValueOnce({ ...options, models: [options.models[1]], openCodeProviders: ['go'] })
  setup()
  openModels()
  expect(await screen.findByText('Go subscription models')).toBeTruthy()
  expect(screen.queryByRole('group', { name: 'OpenCode service' })).toBeNull()
  expect(screen.queryByRole('menuitemradio', { name: 'Free model' })).toBeNull()
  vi.mocked(fetchCodeAgentOptions).mockResolvedValue({ ...options, models: [options.models[0]], openCodeProviders: ['free'] })
  fireEvent(window, new Event('opencode-configuration-changed'))
  expect(await screen.findByText(/Free models.*no OpenCode account/)).toBeTruthy()
  expect(screen.getByRole('menuitemradio', { name: 'Free model' })).toBeTruthy()
  expect(screen.queryByRole('menuitemradio', { name: 'Go model' })).toBeNull()
})
