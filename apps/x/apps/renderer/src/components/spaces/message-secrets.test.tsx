import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddSecretDialog, MessageSecretsCard } from './message-secrets'

// Secrets for an agent in a thread (Harbor spec §8, 2026-11-04): the card shows
// names and recipients only, and the dialog hands over only to an addressed agent.

const names = new Map([['scout', 'Scout'], ['hermes', 'Hermes']])

afterEach(cleanup)

describe('MessageSecretsCard', () => {
    it('names each secret and the one agent that can read it', () => {
        render(<MessageSecretsCard secrets={[{ name: 'STRIPE_KEY', for: 'scout' }]} memberNames={names} />)
        expect(screen.getByText('STRIPE_KEY')).toBeTruthy()
        expect(screen.getByText('for Scout only')).toBeTruthy()
    })

    it('renders nothing on a message without secrets', () => {
        const { container } = render(<MessageSecretsCard secrets={undefined} memberNames={names} />)
        expect(container.innerHTML).toBe('')
    })
})

describe('AddSecretDialog', () => {
    it('asks for a mention first when the draft addresses no agent', () => {
        render(<AddSecretDialog open onOpenChange={() => {}} agents={[]} names={names} onAdd={() => {}} />)
        expect(screen.getByText('Mention the agent you want to give it to first.')).toBeTruthy()
        expect(screen.queryByLabelText('Value')).toBeNull()
    })

    it('adds a well-named secret for the addressed agent, the value masked', () => {
        const onAdd = vi.fn()
        render(<AddSecretDialog open onOpenChange={() => {}} agents={['scout']} names={names} onAdd={onAdd} />)
        const add = screen.getByRole('button', { name: 'Add for Scout' })
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'my key' } })
        fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'sk-1' } })
        expect((add as HTMLButtonElement).disabled).toBe(true)
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'OPENAI_API_KEY' } })
        expect(screen.getByLabelText('Value').getAttribute('type')).toBe('password')
        fireEvent.click(add)
        expect(onAdd).toHaveBeenCalledWith({ name: 'OPENAI_API_KEY', for: 'scout', value: 'sk-1' })
    })
})
