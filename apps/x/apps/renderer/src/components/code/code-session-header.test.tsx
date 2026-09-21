import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { CodeSession } from '@x/shared/src/code-sessions.js'
import { CodeSessionControls, CodeSessionHeader } from './code-session-header'
import { TooltipProvider } from '@/components/ui/tooltip'

const { invoke, refresh } = vi.hoisted(() => ({ invoke: vi.fn(), refresh: vi.fn() }))
vi.mock('./use-code-sessions', () => ({ refreshCodeSessions: refresh }))
vi.mock('./code-agent-options', () => ({
  fetchCodeAgentOptions: async () => ({ models: [{ value: 'model', label: 'Test model' }], efforts: [{ value: 'high', label: 'High' }] }),
  withDefault: (options: unknown[]) => [{ value: 'default', label: 'Default' }, ...options], optionLabel: () => 'Default',
}))
vi.mock('./code-agent-status', () => ({ AGENT_LABEL: { codex: 'Codex', claude: 'Claude Code' }, fetchCodeAgentsStatus: async () => null, isAgentReady: () => true }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
const session: CodeSession = { id: 's1', projectId: 'p1', title: 'Project conversation', agent: 'codex', cwd: '/repo', createdAt: '2026-09-01T00:00:00Z' }
const props = { session, status: 'idle' as const, panel: null, onTogglePanel: vi.fn() }

it('keeps only session identity in the header', () => {
  render(<CodeSessionHeader {...props} />)
  expect(screen.getByText('Project conversation')).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})
it('offers terminal and persisted Harness opt-out beside the composer, without files or diffs', async () => {
  Object.assign(window, { ipc: { invoke } })
  invoke.mockResolvedValue({ session: { ...session, codeModeEnabled: false } })
  const view = render(<TooltipProvider><CodeSessionControls {...props} /></TooltipProvider>)
  expect(screen.queryByRole('button', { name: 'Files' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Changes' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Terminal' }))
  expect(props.onTogglePanel).toHaveBeenCalledWith('terminal')
  fireEvent.click(screen.getByRole('button', { name: 'Harness' }))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('codeSession:update', { sessionId: 's1', patch: expect.objectContaining({ codeModeEnabled: false }) }))
  await waitFor(() => expect(refresh).toHaveBeenCalled())
  view.rerender(<TooltipProvider><CodeSessionControls {...props} session={{ ...session, codeModeEnabled: false }} /></TooltipProvider>)
  expect(screen.getByRole('button', { name: 'Harness' }).getAttribute('aria-pressed')).toBe('false')
  expect(screen.queryByRole('button', { name: 'Terminal' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Harness' }))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('codeSession:update', { sessionId: 's1', patch: expect.objectContaining({ codeModeEnabled: true }) }))
})
