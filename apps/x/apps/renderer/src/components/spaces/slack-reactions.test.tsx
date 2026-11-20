import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import { SlackReactions } from './slack-reactions'
afterEach(cleanup)
it('keeps source counts separate and exposes listed legacy reactors', async () => {
    const message = { author: { slack: { reactions: [{ name: 'wave', count: 5, users: [{ id: 'U1', name: 'Alex' }] }] } } } as spaces.Message
    const onReact = vi.fn()
    render(<SlackReactions message={message} onReact={onReact} />)
    fireEvent.click(screen.getByRole('button', { name: 'Slack reaction wave, 5' }))
    expect(await screen.findByText('Alex')).toBeTruthy()
    expect(screen.getByText(/did not include every reacting profile/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Toggle my/ }))
    expect(onReact).toHaveBeenCalledWith(message, '👋')
})
