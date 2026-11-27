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
  fireEvent.click(screen.getByRole('button', { name: 'New thread in Project' }))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('codeSession:create', { projectId: 'p', agent: 'claude', isolation: 'worktree', codeModeEnabled: true }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(invoke).not.toHaveBeenCalledWith('codeProject:branches', expect.anything())
})

it('opens non-git directories in place with Code off', async () => {
  projects.push({ project: { id: 'p', path: '/documents', name: 'Project', addedAt: '2026-09-01T00:00:00Z' },
    git: { isGitRepo: false, hasCommits: false, branch: null, dirtyCount: 0, root: null, subpath: null } })
  const invoke = vi.fn().mockResolvedValue({ session: { id: 'new' } })
  Object.assign(window, { ipc: { invoke } })
  render(<CodeView />)
  fireEvent.click(screen.getByRole('button', { name: 'New thread in Project' }))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('codeSession:create', { projectId: 'p', agent: 'claude', isolation: 'in-repo', codeModeEnabled: false }))
})

it('opens a directory from an old Projects link and restores its existing session', async () => {
  const row: ProjectRow = { project: { id: 'p', path: '/documents', name: 'Project', addedAt: '2026-09-01T00:00:00Z' },
    git: { isGitRepo: false, hasCommits: false, branch: null, dirtyCount: 0, root: null, subpath: null } }
  const session: CodeSession = { id: 's1', title: 'Existing chat', projectId: 'p', agent: 'claude', cwd: '/documents', createdAt: '2026-09-01T00:00:00Z', codeModeEnabled: false }
  sessions.push(session)
  const invoke = vi.fn(async (channel: string) => channel === 'codeProject:add' ? row : { sessions: [session] })
  Object.assign(window, { ipc: { invoke } })
  const selected = vi.fn()
  const consumed = vi.fn()
  render(<CodeView focusProjectPath="knowledge/Workspace/Documents" onProjectFocusConsumed={consumed} onSessionSelected={selected} />)
  await waitFor(() => expect(selected).toHaveBeenLastCalledWith({ session, status: 'idle' }))
  expect(invoke).toHaveBeenCalledWith('codeProject:add', { path: 'knowledge/Workspace/Documents' })
  expect(invoke).not.toHaveBeenCalledWith('codeSession:create', expect.anything())
  expect(consumed).toHaveBeenCalled()
})

it('opens native directory dialog in local/child mode and adds project', async () => {
  const row: ProjectRow = { project: { id: 'p2', path: '/local/dir', name: 'dir', addedAt: '2026-09-01T00:00:00Z' },
    git: { isGitRepo: false, hasCommits: false, branch: null, dirtyCount: 0, root: null, subpath: null } }
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'server:getConnection') return { mode: 'child', url: null, fromEnv: false }
    if (channel === 'dialog:openDirectory') return { path: '/local/dir' }
    if (channel === 'codeProject:add') return row
    if (channel === 'codeSession:create') return { session: { id: 'new' } }
    return null
  })
  Object.assign(window, { ipc: { invoke } })
  render(<CodeView />)
  fireEvent.click(screen.getByRole('button', { name: 'Add a project to get started' }))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('server:getConnection', null))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('dialog:openDirectory', { title: 'Choose a project folder' }))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('codeProject:add', { path: '/local/dir' }))
})

it('opens remote path dialog in remote mode and adds project on submit', async () => {
  const row: ProjectRow = { project: { id: 'p3', path: '/home/user/project', name: 'project', addedAt: '2026-09-01T00:00:00Z' },
    git: { isGitRepo: false, hasCommits: false, branch: null, dirtyCount: 0, root: null, subpath: null } }
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'server:getConnection') return { mode: 'remote', url: 'http://remote:3000', fromEnv: false }
    if (channel === 'codeProject:add') return row
    if (channel === 'codeSession:create') return { session: { id: 'new' } }
    return null
  })
  Object.assign(window, { ipc: { invoke } })
  render(<CodeView />)
  fireEvent.click(screen.getByRole('button', { name: 'Add a project to get started' }))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('server:getConnection', null))
  expect(invoke).not.toHaveBeenCalledWith('dialog:openDirectory', expect.anything())

  expect(screen.getByRole('heading', { name: 'Add remote project' })).toBeInTheDocument()
  const input = screen.getByPlaceholderText('/home/user/project')
  const submitButton = screen.getByRole('button', { name: 'Add project' })

  // Button disabled on empty input
  expect(submitButton).toBeDisabled()

  // Whitespace input keeps submit button disabled
  fireEvent.change(input, { target: { value: '   ' } })
  expect(submitButton).toBeDisabled()

  // Enter valid remote path and submit
  fireEvent.change(input, { target: { value: ' /home/user/project ' } })
  expect(submitButton).not.toBeDisabled()
  fireEvent.click(submitButton)

  await waitFor(() => expect(invoke).toHaveBeenCalledWith('codeProject:add', { path: '/home/user/project' }))
})

it('keeps remote project dialog open when adding the project fails', async () => {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'server:getConnection') {
      return { mode: 'remote', url: 'http://remote:3000', fromEnv: false }
    }

    if (channel === 'codeProject:add') {
      throw new Error('Project path does not exist on remote server')
    }

    return null
  })

  Object.assign(window, { ipc: { invoke } })

  render(<CodeView />)

  fireEvent.click(screen.getByRole('button', { name: 'Add a project to get started' }))

  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Add remote project' })).toBeInTheDocument(),
  )

  const input = screen.getByPlaceholderText('/home/user/project')

  fireEvent.change(input, {
    target: { value: '/home/user/missing-project' },
  })

  fireEvent.click(screen.getByRole('button', { name: 'Add project' }))

  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('codeProject:add', {
      path: '/home/user/missing-project',
    }),
  )

  expect(screen.getByRole('heading', { name: 'Add remote project' })).toBeInTheDocument()
})

it('canceling remote project dialog does not add project', async () => {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'server:getConnection') return { mode: 'remote', url: 'http://remote:3000', fromEnv: false }
    return null
  })
  Object.assign(window, { ipc: { invoke } })
  render(<CodeView />)
  fireEvent.click(screen.getByRole('button', { name: 'Add a project to get started' }))
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Add remote project' })).toBeInTheDocument())

  const input = screen.getByPlaceholderText('/home/user/project')
  fireEvent.change(input, { target: { value: '/home/user/project' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Add remote project' })).toBeNull())
  expect(invoke).not.toHaveBeenCalledWith('codeProject:add', expect.anything())
})
