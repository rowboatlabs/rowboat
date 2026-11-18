import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import { SessionPill } from './session-status'

// The session pill on a first message's name line (2026-11-06): grey idle,
// amber needs you, green working; "Ended" once archived.

let listing: Partial<spaces.ThreadListing> | undefined
vi.mock('@/lib/spaces-my-threads', async (orig) => ({
    ...(await orig<typeof import('@/lib/spaces-my-threads')>()),
    useThreadListing: () => listing,
}))
afterEach(() => { cleanup(); listing = undefined })

const root = (extra: Partial<spaces.Message> = {}) => ({ id: 'r', session: { title: 'fix thread nav' }, ...extra }) as spaces.Message
const dot = () => screen.getByRole('img').querySelector('span')!

describe('SessionPill', () => {
    it('shows where one of yours stands', () => {
        listing = { status: 'working' }
        render(<SessionPill orgId="org" message={root()} />)
        expect(screen.getByRole('img', { name: 'Session, working' })).toHaveTextContent('Session')
        expect(dot().className).toContain('bg-emerald-500')
        cleanup()
        listing = { status: 'needs_you' }
        render(<SessionPill orgId="org" message={root()} />)
        expect(screen.getByRole('img', { name: 'Session, needs you' })).toBeInTheDocument()
        expect(dot().className).toContain('bg-amber-500')
    })

    it('is grey for someone else\'s, and says Ended once archived', () => {
        render(<SessionPill orgId="org" message={root()} />)
        expect(screen.getByRole('img', { name: 'Session' })).toBeInTheDocument()
        cleanup()
        listing = { status: 'working' }
        render(<SessionPill orgId="org" message={root({ archived: true })} />)
        expect(screen.getByRole('img', { name: 'Session, ended' })).toHaveTextContent('Ended')
        expect(dot().className).toContain('bg-muted-foreground')
    })
})
