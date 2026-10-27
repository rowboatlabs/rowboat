import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'

vi.mock('@/components/spaces/atoms', () => ({
    AgentMark: () => null,
    MemberAvatar: () => <span />,
    MemberProfilePopover: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/spaces/space-markdown', () => ({
    SpaceMarkdown: ({ body }: { body: string }) => <p>{body}</p>,
    useSpaceRefs: () => null,
}))
vi.mock('@/components/spaces/link-preview-card', () => ({ MessageLinkPreview: () => null }))
vi.mock('@/components/spaces/poll-card', () => ({ PollCard: () => null }))
vi.mock('@/components/spaces/composer-toolbar', () => ({ FormattingToolbar: () => null }))
vi.mock('@/components/spaces/emoji-picker', () => ({
    EmojiPickerPopover: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

import { MessageRow } from './message-row'

afterEach(cleanup)

const message = {
    id: 'message-1',
    spaceId: 'space-1',
    body: 'The proposal is ready for review.',
    author: { memberId: 'alex', actingMode: 'direct' },
    postedAt: '2026-09-09T09:00:00Z',
    reactions: [{ emoji: '👍', memberIds: ['alex', 'sam'] }],
} as spaces.Message
const memberNames = new Map([['alex', 'Alex'], ['sam', 'Sam']])

describe('conversation message interactions', () => {
    it('exposes reaction membership and toggles the original message reaction', () => {
        const onReact = vi.fn()
        render(<MessageRow message={message} memberNames={memberNames} continuation={false} selfMemberId="sam" onReact={onReact} />)
        const reaction = screen.getByRole('button', { name: '👍, 2 reactions, Alex and You, including you' })
        expect(reaction).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(reaction)
        expect(onReact).toHaveBeenCalledWith(message, '👍')
    })

    it('makes message actions reachable from a focusable row', () => {
        const { container } = render(<MessageRow message={message} memberNames={memberNames} continuation={true} onReact={vi.fn()} />)
        const row = container.querySelector('[data-mid="message-1"]') as HTMLElement
        expect(row).toHaveAttribute('tabindex', '0')
        row.focus()
        expect(row).toHaveFocus()
        expect(screen.getAllByTitle('Add reaction').length).toBeGreaterThan(0)
    })

    it('shows a long message\'s summary first, then the full body under it on Show more (2026-10-25)', () => {
        const long = { ...message, body: Array.from({ length: 12 }, (_, i) => `Step ${i + 1}`).join('\n'), summary: 'Fixed token refresh; PR #12' } as spaces.Message
        const { container } = render(<MessageRow message={long} memberNames={memberNames} continuation={false} />)
        expect(screen.getByText('Fixed token refresh; PR #12')).toBeInTheDocument()
        expect(screen.queryByText(/Step 12/)).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
        expect(screen.getByText('Fixed token refresh; PR #12')).toBeInTheDocument()
        expect(screen.getByText(/Step 12/)).toBeInTheDocument()
        expect(container.querySelector('[data-summary]')?.compareDocumentPosition(screen.getByText(/Step 12/))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
        fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
        expect(screen.queryByText(/Step 12/)).not.toBeInTheDocument()
    })

    it('clamps a long message without a summary, and leaves a short one alone', () => {
        const long = { ...message, body: Array.from({ length: 12 }, (_, i) => `Step ${i + 1}`).join('\n') } as spaces.Message
        const { container, rerender } = render(<MessageRow message={long} memberNames={memberNames} continuation={false} />)
        expect(container.querySelector('[data-clamped]')).not.toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
        expect(container.querySelector('[data-clamped]')).toBeNull()
        rerender(<MessageRow message={{ ...message, summary: 'ignored' } as spaces.Message} memberNames={memberNames} continuation={false} />)
        expect(screen.queryByText('ignored')).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
        expect(screen.getByText(message.body)).toBeInTheDocument()
    })

    it('quotes what an inline reply answers, and the quote goes where the caller says (2026-10-25)', () => {
        const onClick = vi.fn()
        const reply = { ...message, id: 'reply-1', threadRoot: 'root-1' } as spaces.Message
        render(<MessageRow message={reply} memberNames={memberNames} continuation={false} inline inThread={{ author: 'Sam', label: 'Fix the login bug', onClick }} onReplyInThread={vi.fn()} />)
        fireEvent.click(screen.getByRole('button', { name: 'Sam Fix the login bug' }))
        expect(onClick).toHaveBeenCalledOnce()
        // Inline there is no thread: the action reads Reply, never Open thread.
        expect(screen.getByTitle('Reply')).toBeInTheDocument()
    })

    it('opens the existing root from the reply summary without making body clicks navigate', () => {
        const onOpenThread = vi.fn()
        render(<MessageRow message={message} memberNames={memberNames} continuation={false} onOpenThread={onOpenThread}
            thread={{ rootMessageId: message.id, replyCount: 3, lastActivityAt: message.postedAt, archived: false, unreadCount: 0, workingAgents: [] }} />)
        fireEvent.click(screen.getByText(message.body))
        expect(onOpenThread).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: /3 replies.*Last reply/ }))
        expect(onOpenThread).toHaveBeenCalledWith(message.id)
    })

    it('tints the reply line while its thread is open (spaces redesign 2026-10-21)', () => {
        const thread = { rootMessageId: message.id, replyCount: 3, lastActivityAt: message.postedAt, archived: false, unreadCount: 0, workingAgents: [] }
        const { rerender } = render(<MessageRow message={message} memberNames={memberNames} continuation={false} onOpenThread={vi.fn()} thread={thread} />)
        const line = () => screen.getByRole('button', { name: /3 replies/ })
        expect(line()).not.toHaveAttribute('data-open')
        rerender(<MessageRow message={message} memberNames={memberNames} continuation={false} onOpenThread={vi.fn()} thread={thread} threadOpen />)
        expect(line()).toHaveAttribute('data-open')
    })

    it('plays the arrival entrance once, then drops it', () => {
        const { container } = render(<MessageRow message={message} memberNames={memberNames} continuation={false} arriving />)
        const row = container.querySelector('[data-mid="message-1"]') as HTMLElement
        expect(row).toHaveClass('spaces-message--arriving')
        // jsdom has no AnimationEvent, so React listens on the prefixed name.
        fireEvent(row, new Event('webkitAnimationEnd', { bubbles: true }))
        expect(row).not.toHaveClass('spaces-message--arriving')
    })

    it('keeps unconfirmed messages free of server actions', () => {
        const { container } = render(<MessageRow message={{ ...message, pending: true }} memberNames={memberNames} continuation={false} onReact={vi.fn()} onReplyInThread={vi.fn()} />)
        expect(screen.queryByTitle('Add reaction')).not.toBeInTheDocument()
        expect(container.querySelector('[data-mid]')).not.toHaveAttribute('tabindex')
    })
})
