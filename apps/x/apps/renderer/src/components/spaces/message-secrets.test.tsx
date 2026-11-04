import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import { AddSecretDialog, DraftSecretChips, MessageSecretsCard } from './message-secrets'

// Secrets in a thread (Harbor spec §8, 2026-11-04): the card shows names and
// readers, a reader reveals the value on demand, and the composer says who will
// read it before it is sent.

const names = new Map([['scout', 'Scout'], ['harsh', 'Harsh'], ['gagan', 'Gagan']])
const message = { id: 'm1', spaceId: 's1', secrets: { names: ['STRIPE_KEY'], readers: ['scout', 'harsh'] } }

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
})

describe('MessageSecretsCard', () => {
    it('shows the names and readers, and no Reveal to someone who is not a reader', () => {
        render(<MessageSecretsCard orgId="o1" message={{ ...message, secrets: { names: ['STRIPE_KEY'], readers: ['scout', 'harsh', 'gagan'] } }} memberNames={names} selfMemberId="prakhar" />)
        expect(screen.getByText('STRIPE_KEY')).toBeTruthy()
        expect(screen.getByText('Readable by Scout, Harsh and Gagan only')).toBeTruthy()
        expect(screen.queryByRole('button', { name: 'Reveal STRIPE_KEY' })).toBeNull()
    })

    it('reveals the value to a reader, on demand, and hides it again', async () => {
        const invoke = vi.fn(async () => ({ value: 'sk_test_1' }))
        vi.stubGlobal('ipc', { invoke })
        render(<MessageSecretsCard orgId="o1" message={message} memberNames={names} selfMemberId="harsh" />)
        expect(screen.getByText('Readable by Scout and you only')).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Reveal STRIPE_KEY' }))
        await waitFor(() => expect(screen.getByText('sk_test_1')).toBeTruthy())
        expect(invoke).toHaveBeenCalledWith('spaces:readMessageSecret', { orgId: 'o1', spaceId: 's1', messageId: 'm1', name: 'STRIPE_KEY' })
        fireEvent.click(screen.getByRole('button', { name: 'Hide STRIPE_KEY' }))
        expect(screen.queryByText('sk_test_1')).toBeNull()
    })

    it('renders nothing on a message without secrets', () => {
        const { container } = render(<MessageSecretsCard message={{ id: 'm2', spaceId: 's1' }} memberNames={names} />)
        expect(container.innerHTML).toBe('')
    })
})

describe('AddSecretDialog', () => {
    it('asks for a mention first when the draft mentions no one', () => {
        render(<AddSecretDialog open onOpenChange={() => {}} readers={[]} names={names} onAdd={() => {}} />)
        expect(screen.getByText(/Mention who should read it first/)).toBeTruthy()
        expect(screen.queryByLabelText('Value')).toBeNull()
    })

    it('says who will read it, and adds a well-named secret, the value masked', () => {
        const onAdd = vi.fn()
        render(<AddSecretDialog open onOpenChange={() => {}} readers={['scout', 'harsh']} names={names} onAdd={onAdd} />)
        expect(screen.getByText(/Readable by Scout and Harsh\./)).toBeTruthy()
        const add = screen.getByRole('button', { name: 'Add secret' })
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'my key' } })
        fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'sk-1' } })
        expect((add as HTMLButtonElement).disabled).toBe(true)
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'OPENAI_API_KEY' } })
        expect(screen.getByLabelText('Value').getAttribute('type')).toBe('password')
        fireEvent.click(add)
        expect(onAdd).toHaveBeenCalledWith({ name: 'OPENAI_API_KEY', value: 'sk-1' })
    })
})

describe('DraftSecretChips', () => {
    it('names the readers the draft will have, or asks for a mention', () => {
        const { rerender } = render(<DraftSecretChips secrets={[{ name: 'KEY', value: 'v' }]} readers={['harsh']} names={names} onRemove={() => {}} />)
        expect(screen.getByText('Readable by Harsh')).toBeTruthy()
        expect(screen.queryByText('v')).toBeNull()
        rerender(<DraftSecretChips secrets={[{ name: 'KEY', value: 'v' }]} readers={[]} names={names} onRemove={() => {}} />)
        expect(screen.getByText('Mention who should read it')).toBeTruthy()
    })
})
