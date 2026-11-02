import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodexSignIn } from './codex-sign-in'

const invoke = vi.fn()
const changed = vi.fn().mockResolvedValue(undefined)
const pending = { id: 'login-1', status: 'running', stdout: 'Open https://auth.openai.com/codex/device and enter ABCD-EFGHI' }
const props = { orgId: 'org', agentId: 'codex', connected: false, disabled: false, onChanged: changed }

beforeEach(() => {
    vi.useFakeTimers()
    invoke.mockReset()
    changed.mockClear()
    Object.assign(window, { ipc: { invoke } })
    invoke.mockImplementation(async (channel) => {
        if (channel === 'spaces:startHostingSignIn') return { execution: pending, outputPath: '/data/rowboat/sign-in-test.txt' }
        if (channel === 'spaces:checkHostingSignIn') return { hosting: {}, signedIn: true }
        if (channel === 'spaces:readHostingFile') return { content: pending.stdout }
        if (channel === 'spaces:getHostingCommand') return { execution: pending }
        return {}
    })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

async function click(name: string) {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name })) })
}

describe('hosted Codex sign-in', () => {
    it('shows device instructions and waits for a verified login before refreshing access', async () => {
        render(<CodexSignIn {...props} />)
        await click('Sign in with ChatGPT')
        await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
        expect(screen.getByText(/enter ABCD-EFGHI/)).toBeTruthy()
        expect(changed).not.toHaveBeenCalled()
        const open = vi.spyOn(window, 'open').mockReturnValue(null)
        await click('Continue in browser')
        expect(open).toHaveBeenCalledWith('https://auth.openai.com/codex/device', '_blank', 'noopener,noreferrer')
        invoke.mockImplementation(async (channel) => channel === 'spaces:getHostingCommand'
            ? { execution: { ...pending, status: 'completed', exitCode: 0 } }
            : channel === 'spaces:readHostingFile' ? { content: pending.stdout } : { hosting: {}, signedIn: true })
        await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
        expect(invoke).toHaveBeenCalledWith('spaces:checkHostingSignIn', { orgId: 'org', agentId: 'codex' })
        expect(changed).toHaveBeenCalledOnce()
    })

    it('cancels without switching model access', async () => {
        render(<CodexSignIn {...props} />)
        await click('Sign in with ChatGPT')
        await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
        await click('Cancel sign-in')
        await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
        expect(invoke).toHaveBeenCalledWith('spaces:cancelHostingCommand', { orgId: 'org', agentId: 'codex', executionId: 'login-1' })
        expect(invoke.mock.calls.some(([channel]) => channel === 'spaces:checkHostingSignIn')).toBe(false)
        expect(changed).not.toHaveBeenCalled()
    })

    it('keeps failures visible and permits recovery after reopening', async () => {
        invoke.mockRejectedValueOnce(new Error('Complete ChatGPT sign-in before connecting.'))
        render(<CodexSignIn {...props} />)
        await click('Finish connecting')
        expect(screen.getByRole('alert').textContent).toContain('Complete ChatGPT sign-in')
        expect(changed).not.toHaveBeenCalled()
        await click('Finish connecting')
        expect(changed).toHaveBeenCalledOnce()
    })

    it('disconnects a connected account and disables sign-in until the machine is ready', async () => {
        const view = render(<CodexSignIn {...props} connected />)
        await click('Disconnect ChatGPT')
        expect(invoke).toHaveBeenCalledWith('spaces:revokeHostingSignIn', { orgId: 'org', agentId: 'codex' })
        view.rerender(<CodexSignIn {...props} disabled />)
        expect((screen.getByRole('button', { name: 'Sign in with ChatGPT' }) as HTMLButtonElement).disabled).toBe(true)
    })
    it('does not treat a completed execution as a verified ChatGPT account', async () => {
        invoke.mockImplementation(async (channel) => {
            if (channel === 'spaces:startHostingSignIn') return { execution: pending, outputPath: '/data/rowboat/login.txt' }
            if (channel === 'spaces:getHostingCommand') return { execution: { ...pending, status: 'completed', exitCode: 0 } }
            if (channel === 'spaces:readHostingFile') return { content: pending.stdout }
            if (channel === 'spaces:checkHostingSignIn') return { signedIn: false }
        })
        render(<CodexSignIn {...props} />)
        await click('Sign in with ChatGPT')
        await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
        expect(screen.getByRole('alert').textContent).toContain('Complete ChatGPT sign-in')
        expect(changed).not.toHaveBeenCalled()
    })

    it('can resume polling after a transient failure', async () => {
        const normal = invoke.getMockImplementation()!
        let failed = false
        invoke.mockImplementation(async (channel, args) => {
            if (channel === 'spaces:getHostingCommand' && !failed) {
                failed = true
                throw new Error('Network unavailable')
            }
            return normal(channel, args)
        })
        render(<CodexSignIn {...props} />)
        await click('Sign in with ChatGPT')
        await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
        expect(screen.getByRole('alert').textContent).toContain('Network unavailable')
        await click('Check again')
        await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
        expect(screen.getByText(/enter ABCD-EFGHI/)).toBeTruthy()
    })

    it('ignores an in-flight successful poll after cancellation', async () => {
        let finish!: (value: unknown) => void
        const normal = invoke.getMockImplementation()!
        invoke.mockImplementation((channel, args) => channel === 'spaces:getHostingCommand'
            ? new Promise(resolve => { finish = resolve }) : normal(channel, args))
        render(<CodexSignIn {...props} />)
        await click('Sign in with ChatGPT')
        await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
        await click('Cancel sign-in')
        await act(async () => { finish({ execution: { ...pending, status: 'completed', exitCode: 0 } }) })
        expect(invoke.mock.calls.some(([channel]) => channel === 'spaces:checkHostingSignIn')).toBe(false)
        expect(changed).not.toHaveBeenCalled()
    })

})
