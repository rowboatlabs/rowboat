import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import { SpaceConnectionsPanel } from './space-connections'

// Space settings → Connections (spec §8 Space connections, 2026-11-28) against
// a stand-in for Harbor's eight routes: what the panel says in each state a
// space can be in, what it sends when an admin connects an app and chooses
// what it posts, and what it shows of what the filter skipped.

const LINEAR = { slug: 'linear', name: 'Linear', logo: 'https://logos.test/linear.svg' }
const space = { id: 'S1', name: 'eng', createdAt: '2026-11-28T00:00:00.000Z', kind: 'shared', visibility: 'private', isDefault: false, archived: false } as spaces.Space
const connection = (over: Partial<spaces.SpaceConnection> = {}): spaces.SpaceConnection => ({
    id: 'C1', spaceId: 'S1', memberId: 'conn-1', app: LINEAR, name: 'Linear – Eng', status: 'active', triggers: [], filter: true, paused: false,
    createdBy: 'arjun', createdAt: '2026-11-28T00:00:00.000Z', posted: 0, skipped: 0, ...over,
})
const ISSUE = 'LINEAR_ISSUE_CREATED_TRIGGER'
const TYPES: spaces.ConnectionTriggerType[] = [
    {
        slug: ISSUE, name: 'Issue created', description: 'Fires when a new issue is created in a team',
        config: { type: 'object', properties: { team_id: { type: 'string', title: 'Team' }, state: { type: 'string', title: 'State', enum: ['open', 'closed'] } }, required: ['team_id'] },
    },
    { slug: 'LINEAR_COMMENT_EVENT_TRIGGER', name: 'Comment added', description: 'Fires when someone comments on an issue', config: {} },
]

/** What the stand-in Harbor holds, and what it refuses next (by channel, in Harbor's words). */
let server: { connections: spaces.SpaceConnection[]; available: boolean; filterAvailable: boolean }
let refusals: Record<string, string>
let events: spaces.ConnectionEvent[]
let links = 0

type Args = Record<string, unknown> & { connectionId?: string }
const invoke = vi.fn(async (channel: string, args: Args) => {
    if (refusals[channel]) throw new Error(refusals[channel])
    const at = server.connections.findIndex((c) => c.id === args.connectionId)
    switch (channel) {
        case 'spaces:listSpaceConnections': return { ...server, connections: [...server.connections] }
        case 'spaces:listConnectionApps': {
            const all: spaces.ConnectionApp[] = [{ ...LINEAR, description: 'Issue tracking', triggersCount: 3 }, { slug: 'github', name: 'GitHub', triggersCount: 1 }]
            const needle = typeof args.search === 'string' ? args.search.toLowerCase() : ''
            return { apps: all.filter((a) => a.name.toLowerCase().includes(needle)), available: server.available }
        }
        case 'spaces:listConnectionTriggers': return { triggers: TYPES }
        case 'spaces:createSpaceConnection': {
            const made = connection({ id: 'C9', name: (args.name as string | undefined) ?? 'Linear', status: 'pending' })
            server.connections.push(made)
            return { connection: made, authorizeUrl: 'https://connect.test/link/first' }
        }
        case 'spaces:authorizeSpaceConnection': {
            const again: spaces.SpaceConnection = { ...server.connections[at]!, status: 'pending' }
            delete again.problem
            server.connections[at] = again
            return { connection: server.connections[at], authorizeUrl: `https://connect.test/link/again-${++links}` }
        }
        case 'spaces:updateSpaceConnection': {
            const current = server.connections[at]!
            const { triggers, name, filter, paused } = args as { triggers?: spaces.ConnectionTriggerInput[]; name?: string; filter?: boolean; paused?: boolean }
            server.connections[at] = {
                ...current,
                ...(name !== undefined ? { name } : {}),
                ...(filter !== undefined ? { filter } : {}),
                ...(paused !== undefined ? { paused } : {}),
                ...(triggers ? { triggers: triggers.map((t) => ({ slug: t.slug, name: TYPES.find((type) => type.slug === t.slug)!.name, config: t.config })) } : {}),
            }
            return { connection: server.connections[at] }
        }
        case 'spaces:deleteSpaceConnection':
            server.connections = server.connections.filter((c) => c.id !== args.connectionId)
            return {}
        case 'spaces:listConnectionEvents': return { events }
        case 'spaces:listMembers': return { members: [] }
        case 'spaces:listOrgMembers': return { members: [] }
    }
    throw new Error(`unexpected ${channel}`)
})

// A fresh org per test: the connections store is kept per org and space for the session.
let n = 0
let orgId: string
let open: ReturnType<typeof vi.spyOn>
const names = new Map([['arjun', 'Arjun']])
const show = (writable = true) => render(<SpaceConnectionsPanel org={{ id: orgId }} space={space} names={names} writable={writable} />)
const sent = (channel: string) => invoke.mock.calls.filter(([c]) => c === channel).map(([, args]) => args)
const row = (name: string) => screen.findByRole('listitem', { name })

beforeEach(() => {
    orgId = `org-${++n}`
    server = { connections: [], available: true, filterAvailable: true }
    refusals = {}
    events = []
    invoke.mockClear()
    ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: () => () => {} }
    open = vi.spyOn(window, 'open').mockReturnValue(null)
    // The filter's switch measures itself, which jsdom cannot.
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
})
afterEach(() => {
    cleanup()
    open.mockRestore()
    vi.unstubAllGlobals()
})

describe('the Connections panel', () => {
    it('says plainly when this server connects no apps, and offers nothing to press', async () => {
        server.available = false
        show()
        expect(await screen.findByText('This server connects no apps to spaces.')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Connect an app' })).not.toBeInTheDocument()
        expect(invoke).toHaveBeenCalledWith('spaces:listSpaceConnections', { orgId, spaceId: 'S1' })
    })

    it('empty: says so and offers Connect an app, which an archived space cannot use', async () => {
        show()
        expect(await screen.findByText('No apps are connected to this space.')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Connect an app' })).toBeEnabled()
        cleanup()

        show(false)
        expect(await screen.findByRole('button', { name: 'Connect an app' })).toBeDisabled()
    })

    it('says when the list could not be read, and reads it again on request', async () => {
        refusals['spaces:listSpaceConnections'] = 'not a member of this space'
        show()
        expect(await screen.findByText('Could not load connections')).toBeInTheDocument()
        expect(screen.getByText('not a member of this space')).toBeInTheDocument()

        refusals = {}
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
        expect(await screen.findByText('No apps are connected to this space.')).toBeInTheDocument()
    })

    it('connects an app: search, pick, name it, then authorise in the browser, and choose what it posts once that lands', async () => {
        show()
        fireEvent.click(await screen.findByRole('button', { name: 'Connect an app' }))
        const dialog = await screen.findByRole('dialog', { name: 'Connect an app' })
        expect(await within(dialog).findByText('Linear')).toBeInTheDocument()
        expect(within(dialog).getByText('3 kinds of event · Issue tracking')).toBeInTheDocument()
        expect(within(dialog).getByText('1 kind of event')).toBeInTheDocument()

        // The search is the server's.
        fireEvent.change(within(dialog).getByRole('textbox', { name: 'Search apps' }), { target: { value: 'lin' } })
        await waitFor(() => expect(sent('spaces:listConnectionApps')).toContainEqual({ orgId, search: 'lin' }))
        await waitFor(() => expect(within(dialog).queryByText('GitHub')).not.toBeInTheDocument())

        fireEvent.click(within(dialog).getByRole('button', { name: /Linear/ }))
        const name = await screen.findByRole('textbox', { name: 'Name' })
        expect(name).toHaveValue('Linear')
        fireEvent.change(name, { target: { value: 'Linear – Eng' } })
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

        await waitFor(() => expect(open).toHaveBeenCalledWith('https://connect.test/link/first', '_blank', 'noopener,noreferrer'))
        expect(sent('spaces:createSpaceConnection')).toEqual([{ orgId, spaceId: 'S1', app: 'linear', name: 'Linear – Eng' }])
        const made = await row('Linear – Eng')
        expect(within(made).getByText('Waiting for you to authorise Linear…')).toBeInTheDocument()
        expect(within(made).getByText('Waiting for authorisation')).toBeInTheDocument()
        // Nothing to choose until the app is authorised.
        expect(screen.queryByRole('form', { name: 'Edit Linear – Eng' })).not.toBeInTheDocument()

        // The person authorises in the browser; the next read finds it active and the editor opens on what it posts.
        server.connections[0] = { ...server.connections[0]!, status: 'active' }
        const editor = await screen.findByRole('form', { name: 'Edit Linear – Eng' }, { timeout: 5000 })
        expect(await within(editor).findByRole('checkbox', { name: 'Issue created' })).not.toBeChecked()
        expect(within(made).queryByText('Waiting for you to authorise Linear…')).not.toBeInTheDocument()
    }, 10_000)

    it('shows Harbor’s refusal to connect in the dialog, as worded', async () => {
        refusals['spaces:createSpaceConnection'] = 'A connection bills to the Rowboat account of whoever connects it, and you have none here'
        show()
        fireEvent.click(await screen.findByRole('button', { name: 'Connect an app' }))
        fireEvent.click(await screen.findByRole('button', { name: /GitHub/ }))
        fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('A connection bills to the Rowboat account of whoever connects it, and you have none here')
        expect(open).not.toHaveBeenCalled()
    })

    it('pending: waits on the person, keeps asking, and opens the authorisation page again on a fresh address', async () => {
        server.connections = [connection({ status: 'pending' })]
        show()
        const pending = await row('Linear – Eng')
        expect(within(pending).getByText('Waiting for you to authorise Linear…')).toBeInTheDocument()
        // Pause is for a connection that posts.
        expect(within(pending).queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()

        fireEvent.click(within(pending).getByRole('button', { name: 'Open the authorisation page again' }))
        await waitFor(() => expect(open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/connect\.test\/link\/again-/), '_blank', 'noopener,noreferrer'))
        expect(sent('spaces:authorizeSpaceConnection')).toEqual([{ orgId, spaceId: 'S1', connectionId: 'C1' }])
        // A browser may block a page opened after a request: the same address is there as a link.
        expect(await within(pending).findByRole('link', { name: /The page did not open/ })).toHaveAttribute('href', open.mock.calls[0]![0])

        // Harbor sends no event when the person finishes: the panel reads the list again until it is no longer pending.
        const reads = sent('spaces:listSpaceConnections').length
        server.connections[0] = { ...server.connections[0]!, status: 'active' }
        expect(await within(pending).findByText('Active', {}, { timeout: 5000 })).toBeInTheDocument()
        expect(sent('spaces:listSpaceConnections').length).toBeGreaterThan(reads)
        // Authorised elsewhere, with nothing chosen yet: the row says what is next.
        expect(within(pending).getByRole('button', { name: 'Choose what it posts' })).toBeInTheDocument()
    }, 10_000)

    it('active: says who connected it, what it posts and how much, and pauses and resumes', async () => {
        server.connections = [connection({
            triggers: [{ slug: ISSUE, name: 'Issue created', config: { team_id: 'ENG' } }, { slug: ISSUE, name: 'Issue created', config: { team_id: 'OPS' } }],
            posted: 3, skipped: 1, lastEventAt: '2026-11-20T10:00:00.000Z',
        })]
        show()
        const active = await row('Linear – Eng')
        expect(within(active).getByText('Active')).toBeInTheDocument()
        expect(within(active).getByText('Linear · Connected by Arjun')).toBeInTheDocument()
        // The same event for two teams is two triggers, named once.
        expect(within(active).getByText('Posts: Issue created')).toBeInTheDocument()
        expect(within(active).getByText(/3 posted, 1 skipped this week/)).toHaveTextContent(/Last event /)
        expect(active.querySelector('img')).toHaveAttribute('src', LINEAR.logo)

        fireEvent.click(within(active).getByRole('button', { name: 'Pause' }))
        expect(await within(active).findByRole('button', { name: 'Resume' })).toBeInTheDocument()
        expect(within(active).getByText('Paused')).toBeInTheDocument()
        expect(sent('spaces:updateSpaceConnection')).toEqual([{ orgId, spaceId: 'S1', connectionId: 'C1', paused: true }])

        fireEvent.click(within(active).getByRole('button', { name: 'Resume' }))
        expect(await within(active).findByText('Active')).toBeInTheDocument()
    })

    it('failed: shows what went wrong and reconnects through a fresh authorisation', async () => {
        server.connections = [connection({ status: 'failed', problem: 'Linear’s authorisation expired. Authorise it again to keep posting.', createdBy: 'gone' })]
        show()
        const failed = await row('Linear – Eng')
        expect(within(failed).getByText('Needs reconnecting')).toBeInTheDocument()
        expect(within(failed).getByRole('alert')).toHaveTextContent('Linear’s authorisation expired. Authorise it again to keep posting.')
        expect(within(failed).getByText('Linear · Connected by a former member')).toBeInTheDocument()

        fireEvent.click(within(failed).getByRole('button', { name: 'Reconnect' }))
        await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
        expect(sent('spaces:authorizeSpaceConnection')).toEqual([{ orgId, spaceId: 'S1', connectionId: 'C1' }])
        expect(await within(failed).findByText('Waiting for you to authorise Linear…')).toBeInTheDocument()
    })

    it('disconnects only after a confirmation', async () => {
        server.connections = [connection()]
        show()
        fireEvent.click(within(await row('Linear – Eng')).getByRole('button', { name: 'Disconnect' }))
        const confirm = await screen.findByRole('alertdialog', { name: 'Disconnect Linear – Eng?' })
        expect(confirm).toHaveTextContent('Linear stops posting in eng and its authorisation is removed. What it already posted stays.')
        expect(sent('spaces:deleteSpaceConnection')).toEqual([])

        fireEvent.click(within(confirm).getByRole('button', { name: 'Disconnect' }))
        expect(await screen.findByText('No apps are connected to this space.')).toBeInTheDocument()
        expect(sent('spaces:deleteSpaceConnection')).toEqual([{ orgId, spaceId: 'S1', connectionId: 'C1' }])
    })
})

describe('choosing what a connection posts', () => {
    const edit = async () => {
        show()
        fireEvent.click(within(await row('Linear – Eng')).getByRole('button', { name: 'Edit' }))
        const editor = await screen.findByRole('form', { name: 'Edit Linear – Eng' })
        await within(editor).findByRole('checkbox', { name: 'Issue created' })
        return editor
    }

    it('lists the app’s triggers with their descriptions and draws each one’s settings from its schema', async () => {
        server.connections = [connection()]
        const editor = await edit()
        expect(sent('spaces:listConnectionTriggers')).toEqual([{ orgId, app: 'linear' }])
        expect(within(editor).getByText('Fires when a new issue is created in a team')).toBeInTheDocument()
        expect(within(editor).getByRole('checkbox', { name: 'Comment added' })).not.toBeChecked()
        // Nothing to fill until a trigger is chosen.
        expect(within(editor).queryByRole('textbox', { name: /Team/ })).not.toBeInTheDocument()

        fireEvent.click(within(editor).getByRole('checkbox', { name: 'Issue created' }))
        expect(within(editor).getByRole('group', { name: 'Issue created settings' })).toBeInTheDocument()
        expect(within(editor).getByRole('textbox', { name: 'Team' })).toHaveValue('')
        expect(within(editor).getByRole('textbox', { name: 'Team' })).toBeRequired()
        // An enum is a choice, and an optional one may be left unset.
        const state = within(editor).getByRole('combobox', { name: 'State' })
        expect(within(state).getAllByRole('option').map((o) => o.textContent)).toEqual(['Not set', 'open', 'closed'])

        // A trigger with no config has no form.
        fireEvent.click(within(editor).getByRole('checkbox', { name: 'Comment added' }))
        expect(within(editor).queryByRole('group', { name: 'Comment added settings' })).not.toBeInTheDocument()
    })

    it('a required setting left empty blocks Save with a message beside it; filled, Save sends the whole set', async () => {
        server.connections = [connection()]
        const editor = await edit()
        fireEvent.click(within(editor).getByRole('checkbox', { name: 'Issue created' }))
        fireEvent.click(within(editor).getByRole('checkbox', { name: 'Comment added' }))
        fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
        expect(await within(editor).findByText('Team is required')).toBeInTheDocument()
        expect(within(editor).getByRole('textbox', { name: 'Team' })).toHaveAttribute('aria-invalid', 'true')
        expect(sent('spaces:updateSpaceConnection')).toEqual([])

        fireEvent.change(within(editor).getByRole('textbox', { name: 'Team' }), { target: { value: 'ENG' } })
        expect(within(editor).queryByText('Team is required')).not.toBeInTheDocument()
        fireEvent.change(within(editor).getByRole('combobox', { name: 'State' }), { target: { value: '1' } })
        fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))

        await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit Linear – Eng' })).not.toBeInTheDocument())
        expect(sent('spaces:updateSpaceConnection')).toEqual([{
            orgId, spaceId: 'S1', connectionId: 'C1',
            triggers: [{ slug: ISSUE, config: { team_id: 'ENG', state: 'closed' } }, { slug: 'LINEAR_COMMENT_EVENT_TRIGGER', config: {} }],
        }])
        expect(within(await row('Linear – Eng')).getByText('Posts: Issue created, Comment added')).toBeInTheDocument()
    })

    it('opens on what the connection already posts, renames it, and unticking a trigger drops it from the set', async () => {
        server.connections = [connection({ triggers: [
            { slug: ISSUE, name: 'Issue created', config: { team_id: 'ENG' } },
            { slug: 'LINEAR_COMMENT_EVENT_TRIGGER', name: 'Comment added', config: {} },
        ] })]
        const editor = await edit()
        expect(within(editor).getByRole('checkbox', { name: 'Issue created' })).toBeChecked()
        expect(within(editor).getByRole('textbox', { name: 'Team' })).toHaveValue('ENG')

        fireEvent.click(within(editor).getByRole('checkbox', { name: 'Comment added' }))
        fireEvent.change(within(editor).getByRole('textbox', { name: 'Name' }), { target: { value: 'Linear issues' } })
        fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))

        expect(await row('Linear issues')).toBeInTheDocument()
        // The untouched trigger goes back exactly as it was, so Harbor keeps it rather than making it again.
        expect(sent('spaces:updateSpaceConnection')).toEqual([{ orgId, spaceId: 'S1', connectionId: 'C1', name: 'Linear issues', triggers: [{ slug: ISSUE, config: { team_id: 'ENG' } }] }])
    })

    it('shows what Harbor refused beside Save, as it worded it, and keeps what was typed', async () => {
        server.connections = [connection()]
        const editor = await edit()
        fireEvent.click(within(editor).getByRole('checkbox', { name: 'Issue created' }))
        fireEvent.change(within(editor).getByRole('textbox', { name: 'Team' }), { target: { value: 'NOPE' } })
        // As the desktop delivers a handler's error: wrapped by its IPC.
        refusals['spaces:updateSpaceConnection'] = "Error invoking remote method 'spaces:updateSpaceConnection': SpacesRequestError: Issue created needs team_id"
        fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))

        expect(await within(editor).findByText('Issue created needs team_id')).toBeInTheDocument()
        expect(within(editor).getByRole('textbox', { name: 'Team' })).toHaveValue('NOPE')
        expect(within(editor).getByRole('checkbox', { name: 'Issue created' })).toBeChecked()
    })

    it('before the app is authorised there is a name to change and nothing to choose', async () => {
        server.connections = [connection({ status: 'pending' })]
        show()
        fireEvent.click(within(await row('Linear – Eng')).getByRole('button', { name: 'Edit' }))
        const editor = await screen.findByRole('form', { name: 'Edit Linear – Eng' })
        expect(within(editor).getByText('Authorise Linear first, then choose what it posts.')).toBeInTheDocument()
        expect(sent('spaces:listConnectionTriggers')).toEqual([])

        fireEvent.change(within(editor).getByRole('textbox', { name: 'Name' }), { target: { value: 'Linear – Ops' } })
        fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
        expect(await row('Linear – Ops')).toBeInTheDocument()
        // No triggers are sent, which Harbor would refuse before the app is authorised.
        expect(sent('spaces:updateSpaceConnection')).toEqual([{ orgId, spaceId: 'S1', connectionId: 'C1', name: 'Linear – Ops' }])
    })

    it('“Only post what matters” is a switch that acts at once and says what turning it on sends', async () => {
        server.connections = [connection()]
        const editor = await edit()
        const filter = within(editor).getByRole('switch', { name: 'Only post what matters to this space' })
        expect(filter).toBeChecked()
        expect(within(editor).getByText(/each event from Linear is sent to Jev.*The events it skips are listed under Skipped events below/)).toBeInTheDocument()

        fireEvent.click(filter)
        await waitFor(() => expect(sent('spaces:updateSpaceConnection')).toEqual([{ orgId, spaceId: 'S1', connectionId: 'C1', filter: false }]))
        await waitFor(() => expect(within(editor).getByRole('switch', { name: 'Only post what matters to this space' })).not.toBeChecked())
    })

    it('has no filter switch on a server without Jev', async () => {
        server.filterAvailable = false
        server.connections = [connection()]
        const editor = await edit()
        expect(within(editor).queryByRole('switch')).not.toBeInTheDocument()
        expect(within(editor).queryByText(/Jev/)).not.toBeInTheDocument()
    })
})

describe('skipped events', () => {
    beforeEach(() => {
        server.connections = [connection({ triggers: [{ slug: ISSUE, name: 'Issue created', config: { team_id: 'ENG' } }], skipped: 2 })]
        events = [
            { id: 'e1', trigger: ISSUE, title: 'ENG-12 label changed', url: 'https://linear.app/rowboat/issue/ENG-12', outcome: 'skipped', score: 0.08, receivedAt: '2026-03-14T09:00:00.000Z' },
            // What an app sends as an address is not trusted to be one.
            { id: 'e2', trigger: 'LINEAR_UNKNOWN_TRIGGER', url: 'javascript:alert(1)', outcome: 'skipped', receivedAt: '2026-03-13T09:00:00.000Z' },
        ]
    })

    it('are read when the disclosure opens, each with its trigger, when it came, its score and a link to it', async () => {
        show()
        const skipped = within(await row('Linear – Eng')).getByRole('button', { name: 'Skipped events' })
        expect(skipped).toHaveAttribute('aria-expanded', 'false')
        expect(sent('spaces:listConnectionEvents')).toEqual([])

        fireEvent.click(skipped)
        expect(await screen.findByText('ENG-12 label changed')).toBeInTheDocument()
        expect(sent('spaces:listConnectionEvents')).toEqual([{ orgId, spaceId: 'S1', connectionId: 'C1', outcome: 'skipped' }])
        const [first, second] = within(document.getElementById(skipped.getAttribute('aria-controls')!)!).getAllByRole('listitem')
        expect(first).toHaveTextContent('Issue created')
        expect(first).toHaveTextContent('8% likely to matter')
        expect(first).toHaveTextContent('Mar 14')
        expect(within(first!).getByRole('link', { name: 'Open in Linear' })).toHaveAttribute('href', 'https://linear.app/rowboat/issue/ENG-12')
        // No title: the trigger stands in for it. No score: none is shown. No web address: no link.
        expect(second).toHaveTextContent('LINEAR_UNKNOWN_TRIGGER')
        expect(second).not.toHaveTextContent('likely to matter')
        expect(within(second!).queryByRole('link')).not.toBeInTheDocument()
    })

    it('carry no score on a server without Jev, and say when there are none', async () => {
        server.filterAvailable = false
        show()
        fireEvent.click(within(await row('Linear – Eng')).getByRole('button', { name: 'Skipped events' }))
        expect(await screen.findByText('ENG-12 label changed')).toBeInTheDocument()
        expect(screen.queryByText(/likely to matter/)).not.toBeInTheDocument()
        cleanup()

        events = []
        orgId = `org-${++n}`
        show()
        fireEvent.click(within(await row('Linear – Eng')).getByRole('button', { name: 'Skipped events' }))
        expect(await screen.findByText('Nothing was skipped.')).toBeInTheDocument()
    })
})
