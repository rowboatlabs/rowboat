import { SpaceAccessContext } from '@/lib/spaces-access'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
vi.mock('@/hooks/use-models', () => ({ useModels: () => ({ groups: [], reasoningByKey: {}, defaultModel: null, catalogByProvider: {}, refresh: vi.fn() }) }))

import { InvocationLines, SpaceInvocationsProvider } from './invocation-lines'
import { AgentOptionsStrip } from './agent-options-strip'
import { SpaceMembersProvider, SpaceProfilesProvider } from './member-text'
import { SpaceRefsProvider } from './space-nav'

afterEach(cleanup)

const NOW = '2026-09-30T10:00:00.000Z'
const invocation = (id: string, state: spaces.InvocationState, extra: Partial<spaces.Invocation> = {}): spaces.Invocation => ({
    id,
    agentId: 'echo',
    conversation: { spaceId: 'S', threadRootId: 'm1' },
    trigger: { messageId: 'm1', authorId: 'harsh', body: '@Echo go' },
    where: { spaceKind: 'shared', spaceName: 'Payments' },
    depth: 0,
    state,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
})

let stop = true
const invoke = vi.fn(async (channel: string, args: { invocationId?: string; agentId?: string }) => {
    if (channel === 'spaces:getAgentCapabilities' && args.agentId === 'coder') {
        return {
            capabilities: {
                stop: false,
                options: [
                    { type: 'select', key: 'environment', label: 'Env', choices: [{ id: 'web', label: 'web-app' }, { id: 'api', label: 'payments-api' }] },
                    { type: 'toggle', key: 'plan_first', label: 'Plan first' },
                ],
            },
            defaults: { environment: 'api', plan_first: true },
        }
    }
    if (channel === 'spaces:getAgentCapabilities' && args.agentId === 'claude') {
        return {
            capabilities: {
                stop: true,
                options: [
                    { type: 'select', key: 'model', label: 'Model', choices: [{ id: 'opus-5-5-1m', label: 'Opus 5.5 (1M)' }, { id: 'haiku-4-5', label: 'Haiku 4.5' }] },
                    { type: 'select', key: 'effort', label: 'Effort', choices: [{ id: 'low', label: 'Low' }, { id: 'max', label: 'Max' }] },
                    { type: 'toggle', key: 'fast_mode', label: 'Fast mode' },
                ],
            },
            defaults: {},
        }
    }
    if (channel === 'spaces:getAgentCapabilities') {
        return { capabilities: { stop, options: [{ type: 'select', key: 'environment', label: 'Env', choices: [{ id: 'api', label: 'payments-api' }] }] } }
    }
    if (channel === 'spaces:cancelInvocation') return { invocation: invocation(args.invocationId!, 'cancelled') }
    throw new Error(`unexpected ${channel}`)
})

beforeEach(() => {
    invoke.mockClear()
    ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: () => () => {} }
})

const names = new Map([['echo', 'Echo'], ['harsh', 'Harsh']])
function lines(list: spaces.Invocation[], viewer: { selfId: string; isAdmin?: boolean; member?: boolean }, orgId = `org-${Math.random()}`) {
    return render(
        <SpaceAccessContext.Provider value={{ member: viewer.member ?? true, join: () => {}, joining: false }}>
        <SpaceMembersProvider members={names}>
            <SpaceInvocationsProvider byMessage={new Map([['m1', list]])} orgId={orgId} selfId={viewer.selfId} isAdmin={viewer.isAdmin ?? false}>
                <InvocationLines messageId="m1" />
            </SpaceInvocationsProvider>
        </SpaceMembersProvider>
        </SpaceAccessContext.Provider>,
    )
}

// The line under a message that invoked an agent (Harbor spec §8, 2026-09-30).
describe('InvocationLines', () => {
    it('keeps invocation status visible without mutation controls in a preview', async () => {
        lines([invocation('q', 'queued'), invocation('w', 'working')], { selfId: 'harsh', isAdmin: true, member: false })
        expect(screen.getByText('Echo will get to this next')).toBeInTheDocument()
        await screen.findByText('Echo is typing…')
        expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    })

    it('says what the agent is doing, and nothing once it is done', () => {
        const { container } = lines(
            [
                invocation('a', 'working', { activity: 'Running tests' }),
                invocation('b', 'waiting', { activity: 'Approve the migration?' }),
                invocation('c', 'refused', { refusal: { reason: 'hop_limit', message: 'Too many agent hand-offs.' } }),
                invocation('d', 'queued'),
                invocation('e', 'done'),
            ],
            { selfId: 'gagan' },
        )
        expect(screen.getByText('Echo is working · Running tests')).toBeInTheDocument()
        expect(screen.getByText('Echo is waiting: Approve the migration?')).toBeInTheDocument()
        expect(screen.getByText('Echo didn’t take this: Too many agent hand-offs.')).toBeInTheDocument()
        expect(screen.getByText('Echo will get to this next')).toBeInTheDocument()
        expect(container.querySelector('[data-invocation="done"]')).toBeNull()
        // Not the invoker, not an admin: no Cancel, no Stop.
        expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    })

    it('lets the invoker cancel what is queued', async () => {
        lines([invocation('q', 'queued')], { selfId: 'harsh' })
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:cancelInvocation', expect.objectContaining({ invocationId: 'q' })))
    })

    it('offers Stop to an admin only when the agent can stop', async () => {
        stop = true
        lines([invocation('w', 'working')], { selfId: 'ramnique', isAdmin: true })
        fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:cancelInvocation', expect.objectContaining({ invocationId: 'w' })))
        cleanup()
        stop = false
        lines([invocation('w2', 'working')], { selfId: 'harsh' })
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:getAgentCapabilities', expect.anything()))
        expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    })
})

describe('AgentOptionsStrip', () => {
    it('offers a mentioned agent’s declared options and reports the pick', async () => {
        const onChange = vi.fn()
        const echo = { id: 'echo', displayName: 'Echo', role: 'member', kind: 'agent' } as spaces.Member
        render(
            <SpaceRefsProvider refs={{ orgId: 'org-strip', orgAddress: 'x', spaceId: 'S' }}>
                <SpaceMembersProvider members={names}>
                    <SpaceProfilesProvider members={[echo]} here={new Set()} selfId="harsh">
                        <AgentOptionsStrip draft="[@Echo](#member:echo) fix it" values={{}} onChange={onChange} />
                    </SpaceProfilesProvider>
                </SpaceMembersProvider>
            </SpaceRefsProvider>,
        )
        // The chat's model picker over the declared choices: open it, pick one.
        vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
        Element.prototype.scrollIntoView ??= () => {}
        fireEvent.click(await screen.findByTitle('Echo Env'))
        fireEvent.click(await screen.findByRole('option', { name: /payments-api/ }))
        expect(onChange).toHaveBeenCalledWith({ echo: { environment: 'api' } })
    })

    it('shows the owner’s defaults preselected, and sends an explicit off for a toggle that defaults on', async () => {
        const onChange = vi.fn()
        const coder = { id: 'coder', displayName: 'Coder', role: 'member', kind: 'agent' } as spaces.Member
        render(
            <SpaceRefsProvider refs={{ orgId: 'org-defaults', orgAddress: 'x', spaceId: 'S' }}>
                <SpaceMembersProvider members={new Map([['coder', 'Coder']])}>
                    <SpaceProfilesProvider members={[coder]} here={new Set()} selfId="harsh">
                        <AgentOptionsStrip draft="[@Coder](#member:coder) fix it" values={{}} onChange={onChange} />
                    </SpaceProfilesProvider>
                </SpaceMembersProvider>
            </SpaceRefsProvider>,
        )
        expect(await screen.findByTitle('Coder Env')).toHaveTextContent('Env: payments-api')
        const plan = screen.getByRole('button', { name: 'Plan first' })
        expect(plan).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(plan)
        expect(onChange).toHaveBeenCalledWith({ coder: { plan_first: false } })
    })

    it('shows Model and Effort as one picker: the model on the pill, its effort on hover', async () => {
        vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
        Element.prototype.scrollIntoView ??= () => {}
        const onChange = vi.fn()
        const claude = { id: 'claude', displayName: 'Claude', role: 'member', kind: 'agent' } as spaces.Member
        render(
            <SpaceRefsProvider refs={{ orgId: 'org-model', orgAddress: 'x', spaceId: 'S' }}>
                <SpaceMembersProvider members={new Map([['claude', 'Claude']])}>
                    <SpaceProfilesProvider members={[claude]} here={new Set()} selfId="harsh">
                        <AgentOptionsStrip draft="[@Claude](#member:claude) fix it" values={{}} onChange={onChange} />
                    </SpaceProfilesProvider>
                </SpaceMembersProvider>
            </SpaceRefsProvider>,
        )
        const pill = await screen.findByTitle('Claude Model')
        expect(pill).toHaveTextContent('Model: default')
        expect(screen.queryByTitle('Claude Effort')).toBeNull() // no separate effort pill
        expect(screen.getByRole('button', { name: 'Fast mode' })).toBeInTheDocument()
        fireEvent.click(pill)
        fireEvent.mouseEnter(await screen.findByRole('option', { name: /Haiku 4.5/ }))
        fireEvent.click(await screen.findByRole('button', { name: 'Max' }))
        expect(onChange).toHaveBeenCalledWith({ claude: { model: 'haiku-4-5', effort: 'max' } })
    })
})
