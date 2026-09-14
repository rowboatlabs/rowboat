import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodeSession } from '@x/shared/src/code-sessions.js'
import { SessionRail } from './session-rail'
import type { CodeAgentsStatus } from './code-agent-status'
import type { ProjectRow } from './use-code-sessions'

afterEach(() => { cleanup(); localStorage.clear() })

const project: ProjectRow = {
  project: { id: 'project', name: 'Example', path: '/Example', addedAt: '2026-09-08T00:00:00Z' },
  git: { isGitRepo: true, branch: 'main', hasCommits: true, dirtyCount: 0, root: '/Example', subpath: '' },
}
const session: CodeSession = {
  id: 'session', projectId: 'project', title: 'Fix rendering', agent: 'codex',
  cwd: '/Example', createdAt: '2026-09-08T00:00:00Z',
}
const ready: CodeAgentsStatus = {
  claude: { installed: true, signedIn: true },
  codex: { installed: true, signedIn: true },
}

function setup(done = false, agentsStatus: CodeAgentsStatus | null = ready) {
  const target = { ...session, ...(done ? { doneAt: '2026-09-08T01:00:00Z' } : {}) }
  const callbacks = {
    onSelectSession: vi.fn(), onAddProject: vi.fn(), onRemoveProject: vi.fn(),
    onNewSession: vi.fn(), onSetDone: vi.fn(), onDeleteSession: vi.fn(),
  }
  localStorage.setItem('x:code-done-open', '1')
  render(<SessionRail
    {...callbacks}
    projects={[project]}
    sessions={[target]}
    statusOf={() => 'working'}
    agentsStatus={agentsStatus}
    selectedSessionId={null}
  />)
  return { ...callbacks, target }
}

function openSessionMenu() {
  fireEvent.contextMenu(screen.getByText(session.title), { button: 2 })
}

function openProjectMenu() {
  fireEvent.contextMenu(screen.getByText('Example'), { button: 2 })
}

describe('code rail context menus', () => {
  it.each([false, true])('updates done=%s on the clicked session without selecting it', (done) => {
    const { onSetDone, onSelectSession, target } = setup(done)
    openSessionMenu()
    expect(onSelectSession).not.toHaveBeenCalled()
    expect(screen.queryByRole('menuitem', { name: 'New session' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: done ? 'Reopen' : 'Mark as done' }))
    expect(onSetDone).toHaveBeenCalledExactlyOnceWith(target, !done)
    expect(onSelectSession).not.toHaveBeenCalled()
  })

  it('routes deletion through the existing parent confirmation callback', () => {
    const { onDeleteSession, onSelectSession, target } = setup()
    openSessionMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete session' }))
    expect(onDeleteSession).toHaveBeenCalledExactlyOnceWith(target)
    expect(onSelectSession).not.toHaveBeenCalled()
  })

  it.each([
    ['New worktree', undefined], ['New Claude Code worktree', 'claude'], ['New Codex worktree', 'codex'],
  ] as const)('creates %s in the clicked project without collapsing it', (name, agent) => {
    const { onNewSession } = setup()
    openProjectMenu()
    expect(screen.getByRole('button', { name: 'Collapse project', hidden: true })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name }))
    expect(onNewSession.mock.calls).toEqual([agent ? ['project', agent] : ['project']])
  })

  it('disables agents that are missing or signed out', () => {
    const { onNewSession } = setup(false, {
      claude: { installed: false, signedIn: false },
      codex: { installed: true, signedIn: false },
    })
    openProjectMenu()
    for (const name of ['New Claude Code worktree', 'New Codex worktree']) {
      const item = screen.getByRole('menuitem', { name })
      expect(item).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(item)
    }
    expect(onNewSession).not.toHaveBeenCalled()
  })

  it('keeps explicit agent choices enabled while status is loading', () => {
    setup(false, null)
    openProjectMenu()
    expect(screen.getByRole('menuitem', { name: 'New Codex worktree' })).not.toHaveAttribute('aria-disabled')
  })

  it('removes the clicked project through its existing handler', () => {
    const { onRemoveProject } = setup()
    openProjectMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove project' }))
    expect(onRemoveProject).toHaveBeenCalledExactlyOnceWith('project')
  })

  it('keeps keyboard actions in the three-dot menu from selecting the session', () => {
    const { onSelectSession, onSetDone, target } = setup()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Session actions' }), { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Mark as done' }), { key: 'Enter' })
    expect(onSetDone).toHaveBeenCalledExactlyOnceWith(target, true)
    expect(onSelectSession).not.toHaveBeenCalled()
  })
})

it('groups sibling sessions into one worktree and exposes the parent branch control', () => {
  const worktree = { path: '/wt', branch: 'rowboat/work', baseBranch: 'main' }
  const onSwitchBranch = vi.fn()
  const onSelectSession = vi.fn()
  render(<SessionRail projects={[project]} sessions={[
    { ...session, worktree },
    { ...session, id: 'second', title: 'Second chat', createdAt: '2026-09-08T02:00:00Z', worktree },
  ]} selectedSessionId="second" statusOf={() => 'idle'} agentsStatus={ready}
    onSelectSession={onSelectSession} onSwitchBranch={onSwitchBranch}
    onAddProject={vi.fn()} onRemoveProject={vi.fn()} onNewSession={vi.fn()} onSetDone={vi.fn()} onDeleteSession={vi.fn()} />)
  // One card for the worktree, named after its first chat — never the branch.
  expect(screen.queryByText('rowboat/work')).toBeNull()
  expect(screen.getAllByText(session.title)).toHaveLength(1)
  expect(screen.getByText('2 sessions')).toBeTruthy()
  fireEvent.click(screen.getByText(session.title))
  expect(onSelectSession).toHaveBeenCalledWith('second')
  expect(screen.queryByRole('button', { name: 'Change branch for Example' })).toBeNull()
  openProjectMenu()
  fireEvent.click(screen.getByRole('menuitem', { name: 'Change branch' }))
  expect(onSwitchBranch).toHaveBeenCalledWith('project')
})
