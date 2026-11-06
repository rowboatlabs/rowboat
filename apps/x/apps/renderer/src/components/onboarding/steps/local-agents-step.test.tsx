import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OnboardingState } from '../use-onboarding-state'
import { LocalAgentsStep } from './local-agents-step'

const org = { id: 'org1', name: 'Acme', memberId: 'me', spaces: [{ id: 's1' }, { id: 's2' }], directs: [] }
const local = { agents: [] as { orgId: string; kind: string }[], defaultCwd: '/home/me' }
const install = vi.fn(() => Promise.resolve())

vi.mock('@/hooks/use-spaces', () => ({
  useSpacesOrgs: () => ({ orgs: [org] }),
  getSpacesOrgs: () => [org],
  refreshSpacesOrgs: vi.fn(async () => {}),
}))
vi.mock('@/hooks/use-space-members', () => ({
  useSelfDisplayName: () => 'Arjun Kumar',
  refreshMembers: vi.fn(),
  refreshOrgRoster: vi.fn(),
}))
vi.mock('@/components/spaces/local-agent', () => ({
  useLocalAgents: () => local,
  useLocalEngine: () => ({ install }),
  EngineCard: () => null,
}))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

const invoke = vi.fn()
const makeState = () => ({ handleBack: vi.fn(), handleComplete: vi.fn() }) as unknown as OnboardingState

beforeEach(() => {
  local.agents = []
  invoke.mockReset()
  invoke.mockImplementation(async (channel: string, args: { kind?: string }) =>
    channel === 'spaces:addLocalAgent' ? { agent: { id: `agent-${args.kind}` } } : { success: true })
  Object.assign(window, { ipc: { invoke } })
})
afterEach(cleanup)

describe('onboarding local agents', () => {
  it('adds the chosen agents as yours, into every space, then finishes', async () => {
    const state = makeState()
    render(<LocalAgentsStep state={state} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Codex' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start using Rowboat' }))
    await waitFor(() => expect(state.handleComplete).toHaveBeenCalled())
    const added = invoke.mock.calls.filter(([channel]) => channel === 'spaces:addLocalAgent')
    expect(added).toEqual([['spaces:addLocalAgent', { orgId: 'org1', displayName: "Arjun's Claude Code", kind: 'claude-code', cwd: '/home/me', policy: 'yolo' }]])
    for (const spaceId of ['s1', 's2']) {
      expect(invoke).toHaveBeenCalledWith('spaces:addMembers', { orgId: 'org1', spaceId, memberIds: ['agent-claude-code'] })
    }
    expect(install).toHaveBeenCalled()
  })

  it('never adds an agent this computer already runs in the space', async () => {
    local.agents = [{ orgId: 'org1', kind: 'claude-code' }, { orgId: 'org1', kind: 'codex' }]
    const state = makeState()
    render(<LocalAgentsStep state={state} />)
    expect(screen.getAllByText('Already in your space')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Start using Rowboat' }))
    await waitFor(() => expect(state.handleComplete).toHaveBeenCalled())
    expect(invoke).not.toHaveBeenCalledWith('spaces:addLocalAgent', expect.anything())
  })
})
