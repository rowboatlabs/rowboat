import { describe, expect, it, vi } from 'vitest'
import { tabTitle } from './tab-badge'

vi.mock('@/hooks/use-space-chat', () => ({ useSpacesUnreadCounts: () => new Map() }))

// The tab's title follows the desktop dock badge's rule (2026-10-15).

describe('the tab title', () => {
    it('counts what is for you, else marks anything unread', () => {
        expect(tabTitle({ unread: 0, forYou: 0 })).toBe('Rowboat Spaces')
        expect(tabTitle({ unread: 4, forYou: 0 })).toBe('• Rowboat Spaces')
        expect(tabTitle({ unread: 4, forYou: 2 })).toBe('(2) Rowboat Spaces')
    })
})
