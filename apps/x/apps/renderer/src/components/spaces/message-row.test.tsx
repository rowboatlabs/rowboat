import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'

vi.mock('@/components/spaces/atoms', () => ({
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

    it('opens the existing root from the reply summary without making body clicks navigate', () => {
        const onOpenThread = vi.fn()
        render(<MessageRow message={message} memberNames={memberNames} continuation={false} onOpenThread={onOpenThread}
            thread={{ rootMessageId: message.id, replyCount: 3, lastActivityAt: message.postedAt, archived: false, unreadCount: 0, workingAgents: [] }} />)
        fireEvent.click(screen.getByText(message.body))
        expect(onOpenThread).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: /3 replies.*Last reply/ }))
        expect(onOpenThread).toHaveBeenCalledWith(message.id)
    })

    it('keeps unconfirmed messages free of server actions', () => {
        const { container } = render(<MessageRow message={{ ...message, pending: true }} memberNames={memberNames} continuation={false} onReact={vi.fn()} onReplyInThread={vi.fn()} />)
        expect(screen.queryByTitle('Add reaction')).not.toBeInTheDocument()
        expect(container.querySelector('[data-mid]')).not.toHaveAttribute('tabindex')
    })
})
