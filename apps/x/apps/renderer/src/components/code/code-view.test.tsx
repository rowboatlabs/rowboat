import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { codeWorkspaceKey, type CodeSession } from '@x/shared/src/code-sessions.js'
import type { ProjectRow } from './use-code-sessions'
import { CodeView } from './code-view'

const { sessions, projects, refresh } = vi.hoisted(() => ({ sessions: [] as CodeSession[], projects: [] as ProjectRow[], refresh: vi.fn() }))
vi.mock('./use-code-sessions', () => ({
  useCodeSessions: () => ({ projects, sessions, statusOf: () => 'idle', refresh }), projectLabel: () => 'Project',
}))
vi.mock('./code-agent-status', () => ({ AGENT_LABEL: {}, fetchCodeAgentsStatus: async () => null, isAgentReady: () => true }))
vi.mock('./session-rail', () => ({ SessionRail: ({ onSelectSession }: { onSelectSession: (id: string) => void }) =>
  <div><button onClick={() => onSelectSession('s1')}>First worktree</button><button onClick={() => onSelectSession('s3')}>Second worktree</button></div> }))
afterEach(() => { cleanup(); localStorage.clear(); sessions.length = 0; projects.length = 0; vi.clearAllMocks() })

it('restores each worktree’s last session and preserves the selection after remount', async () => {
  const first: CodeSession = { id: 's1', title: 'First', projectId: 'p', agent: 'codex', cwd: '/wt',
    worktree: { path: '/wt', branch: 'rowboat/one', baseBranch: 'main' }, createdAt: '2026-09-01T00:00:00Z' }
  sessions.push(first, { ...first, id: 's2' }, { ...first, id: 's3', cwd: '/other', worktree: { ...first.worktree!, path: '/other' } })
  localStorage.setItem(`x:code-workspace-session:${codeWorkspaceKey(first)}`, 's2')
  const onSessionSelected = vi.fn()
  const view = render(<CodeView onSessionSelected={onSessionSelected} />)
  fireEvent.click(screen.getByText('First worktree'))
  await waitFor(() => expect(onSessionSelected).toHaveBeenLastCalledWith(expect.objectContaining({ session: expect.objectContaining({ id: 's2' }) })))
  fireEvent.click(screen.getByText('Second worktree'))
  await waitFor(() => expect(onSessionSelected).toHaveBeenLastCalledWith(expect.objectContaining({ session: expect.objectContaining({ id: 's3' }) })))
  fireEvent.click(screen.getByText('First worktree'))
  await waitFor(() => expect(onSessionSelected).toHaveBeenLastCalledWith(expect.objectContaining({ session: expect.objectContaining({ id: 's2' }) })))
  view.unmount()
  render(<CodeView onSessionSelected={onSessionSelected} />)
  await waitFor(() => expect(onSessionSelected).toHaveBeenLastCalledWith(expect.objectContaining({ session: expect.objectContaining({ id: 's2' }) })))
})

it('creates a worktree immediately without prompting for a branch', async () => {
  projects.push({ project: { id: 'p', path: '/repo', name: 'Project', addedAt: '2026-09-01T00:00:00Z' },
    git: { isGitRepo: true, hasCommits: true, branch: 'release', dirtyCount: 0, root: '/repo', subpath: '' } })
  const invoke = vi.fn().mockResolvedValue({ session: { id: 'new' } })
  Object.assign(window, { ipc: { invoke } })
  render(<CodeView />)
  fireEvent.click(screen.getByRole('button', { name: 'New worktree in Project' }))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('codeSession:create', { projectId: 'p', agent: 'claude', isolation: 'worktree' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(invoke).not.toHaveBeenCalledWith('codeProject:branches', expect.anything())
})
