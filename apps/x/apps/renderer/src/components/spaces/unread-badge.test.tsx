import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UnreadBadge } from './unread-badge'

// The dot says what the number means: grey + unread count when nothing is
// for you, red + for-you count when something is. Hover carries both.

describe('UnreadBadge', () => {
    it('grey dot and the unread figure when nothing is for you', () => {
        const { container } = render(<UnreadBadge badge={{ unread: 140, forYou: 0 }} />)
        expect(screen.getByTitle('140 unread · none for you').textContent).toBe('140')
        expect(container.querySelector('.bg-muted-foreground')).not.toBeNull()
        expect(container.querySelector('[class*="stream-alert"]')).toBeNull()
    })

    it('red dot and the for-you figure when something is', () => {
        const { container } = render(<UnreadBadge badge={{ unread: 14, forYou: 2 }} />)
        expect(screen.getByTitle('14 unread · 2 for you').textContent).toBe('2')
        expect(container.querySelector('[class*="stream-alert"]')).not.toBeNull()
    })

    it('a DM is all for you', () => {
        render(<UnreadBadge badge={{ unread: 12, forYou: 12 }} direct />)
        expect(screen.getByTitle('12 unread · all for you').textContent).toBe('12')
    })

    it('nothing unread renders nothing; big counts cap', () => {
        const { container } = render(<UnreadBadge badge={{ unread: 0, forYou: 0 }} />)
        expect(container.firstChild).toBeNull()
        render(<UnreadBadge badge={{ unread: 2400, forYou: 0 }} />)
        expect(screen.getByTitle('2400 unread · none for you').textContent).toBe('999+')
    })
})
