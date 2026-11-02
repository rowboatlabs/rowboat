import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CodexCreateAccess } from './codex-create-access'

afterEach(cleanup)

it('retries access setup on the same VM without completing or creating another agent after a failure', async () => {
    const complete = vi.fn(async () => {})
    let fail = true
    const invoke = vi.fn(async (channel: string) => {
        if (channel === 'spaces:listAgents') return { agents: [{ agent: { id: 'agent' }, hosting: { status: 'ready' } }] }
        if (fail) throw new Error('Key rejected')
        return {}
    })
    Object.assign(window, { ipc: { invoke } })
    render(<CodexCreateAccess orgId="org" agentId="agent" mode="key" apiKey="sk-test" onComplete={complete} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Key rejected')
    expect(complete).not.toHaveBeenCalled()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry setup' }))
    await waitFor(() => expect(complete).toHaveBeenCalledOnce())
    expect(invoke.mock.calls.every(([channel]) => channel === 'spaces:listAgents' || channel === 'spaces:setHostingLlm')).toBe(true)
})
