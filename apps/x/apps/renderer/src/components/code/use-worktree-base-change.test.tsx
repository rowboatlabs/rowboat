import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { CodeSession } from '@x/shared/src/code-sessions.js'
import { useWorktreeBaseChange } from './use-worktree-base-change'
const { members, refresh, invoke } = vi.hoisted(() => ({ members: [] as CodeSession[], refresh: vi.fn(), invoke: vi.fn() }))
vi.mock('./use-code-sessions', () => ({ refreshCodeSessions: refresh }))
vi.mock('./branch-dialog', () => ({ BranchDialog: ({ onConfirm }: { onConfirm: (branch: string) => Promise<void> }) =>
  <button onClick={() => void onConfirm('release')}>Select release</button> }))
const session: CodeSession = { id: 's1', projectId: 'p', title: 'Empty session', cwd: '/wt', agent: 'codex', createdAt: '2026-09-01T00:00:00Z',
  worktree: { path: '/wt', branch: 'rowboat/test', baseBranch: 'main', baseCommit: 'old' } }
function WorktreeBaseMenu({ session }: { session: CodeSession }) {
  const action = useWorktreeBaseChange(session, true, members.some((s) => !!s.lastActivityAt))
  return <><button disabled={action.disabled} onClick={action.onSelect}>Change base branch</button>{action.dialog}</>
}
afterEach(() => { cleanup(); members.length = 0; vi.clearAllMocks() })
it('changes the base of an eligible worktree and refreshes session metadata', async () => {
  members.push(session)
  Object.assign(window, { ipc: { invoke } })
  invoke.mockResolvedValue({ canChange: true, reason: null, baseBranch: 'main' })
  render(<WorktreeBaseMenu session={session} />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Change base branch' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Change base branch' }))
  fireEvent.click(screen.getByText('Select release'))
  await waitFor(() => expect(refresh).toHaveBeenCalled())
  expect(invoke).toHaveBeenCalledWith('codeSession:changeBaseBranch', { sessionId: 's1', baseBranch: 'release' })
})
it('disables changing the base when any sibling session has started', async () => {
  members.push(session, { ...session, id: 's2', lastActivityAt: '2026-09-02T00:00:00Z' })
  Object.assign(window, { ipc: { invoke } })
  invoke.mockResolvedValue({ canChange: false, reason: "Base branch can't be changed after a session has started.", baseBranch: 'main' })
  render(<WorktreeBaseMenu session={session} />)
  await waitFor(() => expect(invoke).toHaveBeenCalled())
  expect(screen.getByRole('button', { name: 'Change base branch' })).toBeDisabled()
})
