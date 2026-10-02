import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Resync after a dark socket (2026-09-11). The `space_added` frame that
// announces a new DM or space is ephemeral, so the org listing is refetched
// at every moment the socket may have been down: a re-acknowledged
// subscription (a reconnect), the window regaining focus. Subscriptions
// resume from the head we hold, and a refresh asked for mid-refresh runs
// again rather than being swallowed.

type Listener = (event: unknown) => void
const feed = vi.hoisted(() => ({ listeners: new Set<Listener>() }))
vi.mock('@/lib/spaces-feed', () => ({
    subscribeSpacesFeed: (listener: Listener) => {
        feed.listeners.add(listener)
        return () => feed.listeners.delete(listener)
    },
}))
const readState = vi.hoisted(() => ({ head: 0 }))
vi.mock('@/lib/spaces-read-state', () => ({
    loadUnread: async () => {},
    getSpaceReadState: () => (readState.head ? { head: readState.head } : undefined),
}))

const emit = (event: unknown) => {
    for (const l of feed.listeners) l(event)
}
const invoke = vi.fn()
const ipcOn = new Map<string, (payload: unknown) => void>()
const subscribes = () => invoke.mock.calls.filter(([c]) => c === 'spaces:subscribeSpace').length
const listing = () => invoke.mock.calls.filter(([c]) => c === 'spaces:listSpaces').length
const orgs = [{ id: 'org', name: 'Org', memberId: 'me', baseUrl: 'http://x', address: 'x' }]

beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    feed.listeners.clear()
    readState.head = 0
    invoke.mockReset()
    invoke.mockImplementation(async (channel: string) => {
        if (channel === 'spaces:listOrgs') return { orgs }
        if (channel === 'spaces:listSpaces') return { spaces: [{ id: 's1', name: 'Main', kind: 'shared', createdAt: '2026-01-01T00:00:00.000Z' }] }
        if (channel === 'spaces:subscribeSpace' || channel === 'spaces:unsubscribeSpace') return null
        throw new Error(`unexpected ${channel}`)
    })
    ipcOn.clear()
    ;(window as unknown as { ipc: unknown }).ipc = {
        invoke,
        on: (channel: string, listener: (payload: unknown) => void) => {
            ipcOn.set(channel, listener)
            return () => ipcOn.delete(channel)
        },
    }
})
afterEach(() => {
    vi.useRealTimers()
})

async function boot() {
    const mod = await import('./use-spaces')
    await mod.refreshSpacesOrgs()
    await vi.advanceTimersByTimeAsync(0)
    return mod
}

describe('listing resync', () => {
    it('a reconnect refetches the listing once; the boot subscribe does not', async () => {
        await boot()
        expect(listing()).toBe(1)
        const subscribed = { orgId: 'org', frame: { kind: 'subscribed', spaceId: 's1', fromOffset: 7 } }
        emit(subscribed) // boot acknowledgement
        await vi.advanceTimersByTimeAsync(400)
        expect(listing()).toBe(1)
        await vi.advanceTimersByTimeAsync(6_000) // past the "fetched moments ago" window
        emit({ orgId: 'org', frame: { kind: 'subscribed', spaceId: 's1', fromOffset: 7 } }) // reconnect
        emit({ orgId: 'org', frame: { kind: 'subscribed', spaceId: 's1', fromOffset: 7 } }) // the burst
        await vi.advanceTimersByTimeAsync(400)
        expect(listing()).toBe(2)
    })

    it('the window regaining focus refetches when the listing is stale, not when fresh', async () => {
        await boot()
        window.dispatchEvent(new Event('focus'))
        await vi.advanceTimersByTimeAsync(400)
        expect(listing()).toBe(1)
        await vi.advanceTimersByTimeAsync(6_000)
        window.dispatchEvent(new Event('focus'))
        await vi.advanceTimersByTimeAsync(400)
        expect(listing()).toBe(2)
    })

    it('a refresh asked for mid-refresh runs once more instead of being swallowed', async () => {
        const mod = await import('./use-spaces')
        let release!: () => void
        const gate = new Promise<void>((r) => (release = r))
        invoke.mockImplementation(async (channel: string) => {
            if (channel === 'spaces:listOrgs') {
                await gate
                return { orgs }
            }
            if (channel === 'spaces:listSpaces') return { spaces: [] }
            return null
        })
        const first = mod.refreshSpacesOrgs()
        const second = mod.refreshSpacesOrgs() // lands while the first is in flight
        expect(second).toBe(first)
        release()
        await first
        await vi.advanceTimersByTimeAsync(0)
        expect(invoke.mock.calls.filter(([c]) => c === 'spaces:listOrgs').length).toBe(2)
    })

    it('subscribes from the head it holds, and live-only when it holds none', async () => {
        readState.head = 12
        await boot()
        expect(invoke).toHaveBeenCalledWith('spaces:subscribeSpace', { orgId: 'org', spaceId: 's1', afterOffset: 12 })
        readState.head = 0
        invoke.mockClear()
        vi.resetModules()
        feed.listeners.clear()
        invoke.mockImplementation(async (channel: string) => {
            if (channel === 'spaces:listOrgs') return { orgs }
            if (channel === 'spaces:listSpaces') return { spaces: [{ id: 's2', name: 'Two', kind: 'shared', createdAt: '2026-01-01T00:00:00.000Z' }] }
            return null
        })
        await boot()
        expect(invoke).toHaveBeenCalledWith('spaces:subscribeSpace', { orgId: 'org', spaceId: 's2' })
    })

    // A cloud instance (Baarali, 02/10/2026): its subscriptions live in its
    // memory, and while it wakes it answers 503.
    it('asks again for a subscribe refused while the server woke, at the next focus', async () => {
        let refuse = true
        const base = invoke.getMockImplementation()!
        invoke.mockImplementation(async (channel: string, args: unknown) => {
            if (channel === 'spaces:subscribeSpace' && refuse) throw new Error('rpc spaces:subscribeSpace failed with status 503')
            return base(channel, args)
        })
        await boot()
        expect(subscribes()).toBe(1)
        refuse = false
        window.dispatchEvent(new Event('focus'))
        await vi.advanceTimersByTimeAsync(0)
        expect(subscribes()).toBe(2)
        window.dispatchEvent(new Event('focus')) // held now: not asked again
        await vi.advanceTimersByTimeAsync(0)
        expect(subscribes()).toBe(2)
    })

    it('subscribes every watched space again, and refetches the listing, when the link to the server is back', async () => {
        await boot()
        expect(subscribes()).toBe(1)
        await vi.advanceTimersByTimeAsync(6_000)
        ipcOn.get('server:resync')!({})
        await vi.advanceTimersByTimeAsync(400)
        expect(subscribes()).toBe(2)
        expect(listing()).toBe(2)
    })
})
