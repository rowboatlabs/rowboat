import { describe, expect, it } from 'vitest'
import { BUILT_IN_CONNECTION, canManageAgent, manageAgentLabel } from './agent-kinds'

describe('canManageAgent', () => {
    const agent = { kind: 'agent', agentConnection: 'contract' }

    it('lets its owner open it', () => {
        expect(canManageAgent(agent, { mine: true, isAdmin: false })).toBe(true)
    })

    it('lets an admin open it, to revoke its keys', () => {
        expect(canManageAgent(agent, { mine: false, isAdmin: true })).toBe(true)
    })

    it('refuses everyone else: listAgents would answer with nothing', () => {
        expect(canManageAgent(agent, { mine: false, isAdmin: false })).toBe(false)
    })

    it('refuses an agent Harbor itself is: no keys, no page', () => {
        expect(canManageAgent({ kind: 'agent', agentConnection: BUILT_IN_CONNECTION }, { mine: true, isAdmin: true })).toBe(false)
    })

    it('refuses a person', () => {
        expect(canManageAgent({ kind: 'human' }, { mine: true, isAdmin: true })).toBe(false)
    })
})

describe('manageAgentLabel', () => {
    it('calls a bot a bot', () => {
        expect(manageAgentLabel('posthog')).toBe('Manage bot')
    })

    it('calls everything else an agent, known kind or not', () => {
        expect(manageAgentLabel('claude-code')).toBe('Manage agent')
        expect(manageAgentLabel(undefined)).toBe('Manage agent')
    })
})
