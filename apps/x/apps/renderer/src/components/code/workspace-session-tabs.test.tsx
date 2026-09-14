import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodeSession } from '@x/shared/src/code-sessions.js'
import { WorkspaceSessionTabs } from './workspace-session-tabs'

const { refresh, invoke, sessions } = vi.hoisted(() => ({ refresh: vi.fn(), invoke: vi.fn(), sessions: [] as CodeSession[] }))
vi.mock('./use-code-sessions', () => ({ useCodeSessions: () => ({ sessions, refresh, statusOf: () => 'idle' }) }))
afterEach(() => { cleanup(); vi.clearAllMocks(); sessions.length = 0 })
const session: CodeSession = { id: 's1', projectId: 'p', title: 'First conversation', agent: 'codex', cwd: '/wt',
  createdAt: '2026-09-01T00:00:00Z', worktree: { path: '/wt', branch: 'rowboat/one', baseBranch: 'main' } }

describe('workspace session tabs', () => {
  it('shows only the selected worktree’s sessions, in stable order', () => {
    sessions.push({ ...session, id: 's2', title: 'Second conversation', createdAt: '2026-09-02T00:00:00Z' }, session,
      { ...session, id: 'other', title: 'Other worktree', worktree: { ...session.worktree!, path: '/elsewhere' } })
    const onSelect = vi.fn()
    render(<WorkspaceSessionTabs session={session} onSelect={onSelect} />)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['First conversation', 'Second conversation'])
    expect(screen.queryByText('Other worktree')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Second conversation' }))
    expect(onSelect).toHaveBeenCalledWith('s2')
  })
  it('the plus creates and selects a new chat linked to the same workspace', async () => {
    sessions.push(session)
    Object.assign(window, { ipc: { invoke } })
    invoke.mockResolvedValue({ session: { ...session, id: 's2' } })
    const onSelect = vi.fn()
    render(<WorkspaceSessionTabs session={session} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: 'New session in this worktree' }))
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('s2'))
    expect(invoke).toHaveBeenCalledWith('codeSession:create', expect.objectContaining({ workspaceSessionId: 's1', projectId: 'p', isolation: 'worktree' }))
    expect(refresh).toHaveBeenCalled()
  })
})
