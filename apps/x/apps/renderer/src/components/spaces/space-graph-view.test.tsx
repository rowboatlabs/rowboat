import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import { SpaceContentTabs } from './space-content-tabs'
import { SpaceGraphView } from './space-graph-view'

// The canvas is force-graph's and needs a real 2D context; these tests cover
// what the view says before there is a graph to draw, and where the tab is offered.
vi.mock('force-graph', () => ({ default: class { } }))
vi.mock('@/lib/spaces-read-state', () => ({ streamBadge: () => ({ unread: 0, forYou: 0 }), threadsBadge: () => ({ unread: 0, forYou: 0 }), useReadStateVersion: () => 0 }))

const space = (graph: boolean): spaces.Space => ({ id: 'S1', name: 'Engineering', createdAt: '2026-11-12T00:00:00.000Z', kind: 'shared', archived: false, graph })
const answer = (status: spaces.SpaceGraph['status'], pending = 0): spaces.SpaceGraph => ({ status, now: '2026-11-12T00:00:00.000Z', pending, threads: [], entities: [], edges: [] })
const invoke = vi.fn()
const view = (admin: boolean, onOpenSettings = vi.fn()) => render(<SpaceGraphView orgId="O1" space={space(true)} members={[]} admin={admin} refreshTick={0} onOpenThread={vi.fn()} onOpenSettings={onOpenSettings} />)

beforeEach(() => { Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('the space graph view', () => {
    it('asks for this space\'s graph', async () => {
        invoke.mockResolvedValue(answer('off'))
        view(false)
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:getSpaceGraph', { orgId: 'O1', spaceId: 'S1' }))
    })

    it('off: tells a member who can turn it on, and gives an admin the way there', async () => {
        invoke.mockResolvedValue(answer('off'))
        view(false)
        expect(await screen.findByText('The graph is off for this space')).toBeInTheDocument()
        expect(screen.getByText('An admin of this space can turn it on in Space settings.')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Open Space settings' })).not.toBeInTheDocument()
        cleanup()

        const onOpenSettings = vi.fn()
        view(true, onOpenSettings)
        // An admin is told what turning it on sends before they are sent to the switch.
        expect(await screen.findByText(/sends this space’s messages to Jev/)).toBeInTheDocument()
        screen.getByRole('button', { name: 'Open Space settings' }).click()
        expect(onOpenSettings).toHaveBeenCalled()
    })

    it('says when the server has no Jev, when it is still building, and when the read failed', async () => {
        invoke.mockResolvedValue(answer('unavailable'))
        view(true)
        expect(await screen.findByText('The graph is not available on this server')).toBeInTheDocument()
        cleanup()

        invoke.mockResolvedValue(answer('building', 12))
        view(true)
        expect(await screen.findByText('Building the graph')).toBeInTheDocument()
        expect(screen.getByText(/12 threads to read/)).toBeInTheDocument()
        cleanup()

        invoke.mockRejectedValue(new Error('not a member of this space'))
        view(true)
        expect(await screen.findByText('Could not load the graph')).toBeInTheDocument()
        expect(screen.getByText('not a member of this space')).toBeInTheDocument()
    })
})

describe('the Graph tab', () => {
    const tabs = (graph: boolean) => render(<SpaceContentTabs orgId="O1" spaceId="S1" direct={false} graph={graph} entries={[]} unreadAssetIds={new Set()} selection={{ kind: 'general' }} onSelect={vi.fn()} />)

    it('is offered only while the space\'s graph is on', () => {
        tabs(false)
        expect(screen.queryByRole('button', { name: /Graph/ })).not.toBeInTheDocument()
        cleanup()
        tabs(true)
        expect(screen.getByRole('button', { name: /Graph/ })).toBeInTheDocument()
    })
})
