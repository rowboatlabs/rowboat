import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import type { ReactNode } from 'react'
import { composerExtensions, composerMarkdown } from './composer-editor'
import { useMentionAutocomplete, type MentionCandidate } from './mention-autocomplete'
import { SpaceRefsProvider } from './space-markdown'

// The @ picker's sources (2026-09-14): the whole org's people (this space's
// first, the rest hinted), the org's shared spaces, and — with a query — the
// files of every shared space. Everything comes off the pane's refs and the
// module stores, so the test mocks the org listing and the IPC the stores
// fetch through, then drives a real editor.

const HERE = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const DESIGN = '01ARZ3NDEKTSV4RRFFQ69G5FB0'
const DM = '01ARZ3NDEKTSV4RRFFQ69G5FC0'
const refs = { orgId: 'org', spaceId: HERE, orgAddress: 'spaces.example.com' }

const { listing } = vi.hoisted(() => ({
    listing: {
        id: 'org', name: 'Org', address: 'spaces.example.com', baseUrl: 'https://spaces.example.com', memberId: 'me', authKind: 'dev',
        spaces: [
            { id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', name: 'General', createdAt: '', kind: 'shared' },
            { id: '01ARZ3NDEKTSV4RRFFQ69G5FB0', name: 'Design', createdAt: '', kind: 'shared' },
        ],
        directs: [{ id: '01ARZ3NDEKTSV4RRFFQ69G5FC0', name: 'direct', createdAt: '', kind: 'direct' }],
        directLabels: { '01ARZ3NDEKTSV4RRFFQ69G5FC0': 'Harsh' },
    },
}))
vi.mock('@/hooks/use-spaces', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/hooks/use-spaces')>()),
    useSpacesOrgs: () => ({ orgs: [listing], loading: false, refresh: async () => {} }),
}))
vi.mock('@/lib/spaces-feed', () => ({ subscribeSpacesFeed: () => () => {} }))

const member = (id: string, displayName: string) => ({ id, displayName, role: 'member' })
const here = [member('me', 'Me Myself'), member('01HHARSH', 'Harsh')]
const org = [...here, member('01HADA', 'Ada Lovelace'), member('01HZED', 'Zed')]
const files: Record<string, unknown[]> = {
    [HERE]: [
        { id: 'A-plan', path: 'plan.md', version: 1, updatedAt: '' },
        { id: 'A-gone', path: 'plan-old.md', version: 1, updatedAt: '', state: 'deleted' },
    ],
    [DESIGN]: [{ id: 'A-brief', path: 'briefs/plan-brief.md', version: 1, updatedAt: '' }],
    [DM]: [{ id: 'A-dm', path: 'dm-plan.md', version: 1, updatedAt: '' }],
}
const invoke = vi.fn(async (channel: string, args: { spaceId?: string }) => {
    if (channel === 'spaces:listMembers') return { members: here }
    if (channel === 'spaces:listOrgMembers') return { members: org }
    if (channel === 'spaces:listAssets') return { entries: files[args.spaceId ?? ''] ?? [] }
    throw new Error(`unexpected ${channel}`)
})

let editor: Editor
beforeEach(() => {
    ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: () => () => {} }
    editor = new Editor({ element: document.createElement('div'), extensions: composerExtensions(() => '') })
})
afterEach(() => editor.destroy())

const wrapper = ({ children }: { children: ReactNode }) => <SpaceRefsProvider refs={refs}>{children}</SpaceRefsProvider>

/** Mount the hook on the editor and type `text` at the caret (the editor's update event drives the popup). */
async function mountAndType(text: string) {
    const hook = renderHook(() => useMentionAutocomplete(editor), { wrapper })
    // Every store has answered once both rosters and the shared listings are in.
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:listAssets', expect.objectContaining({ spaceId: DESIGN })))
    act(() => {
        editor.chain().focus('end').insertContent(text).run()
    })
    await waitFor(() => expect(hook.result.current.show).toBe(true))
    return hook
}

const ids = (c: readonly MentionCandidate[]) => c.map((x) => x.id)

describe('useMentionAutocomplete', () => {
    it('a bare @ lists this space’s people, then the rest of the org (hinted), then the shared spaces — DMs never', async () => {
        const { result } = await mountAndType('hey @')
        await waitFor(() => expect(result.current.candidates.length).toBe(8))
        expect(ids(result.current.candidates)).toEqual(['rowboat', 'here', 'me', '01HHARSH', '01HADA', '01HZED', `space:${HERE}`, `space:${DESIGN}`])
        const byId = new Map(result.current.candidates.map((c) => [c.id, c]))
        expect(byId.get('me')?.hint).toBe('you')
        expect(byId.get('01HHARSH')?.hint).toBeUndefined()
        expect(byId.get('01HADA')?.hint).toBe('not in this space')
        expect(byId.get(`space:${DESIGN}`)?.space).toEqual({ id: DESIGN, name: 'Design' })
        expect(result.current.candidates.some((c) => c.file)).toBe(false)
    })

    it('a query matches spaces and files across shared spaces — this space’s first, others hinted, trash and DM files left out', async () => {
        const { result } = await mountAndType('see @plan')
        await waitFor(() => expect(result.current.candidates.length).toBe(2))
        expect(ids(result.current.candidates)).toEqual([`file:${HERE}/A-plan`, `file:${DESIGN}/A-brief`])
        expect(result.current.candidates[0]?.hint).toBeUndefined()
        expect(result.current.candidates[1]).toMatchObject({ label: 'plan-brief.md', hint: 'briefs/plan-brief.md · in Design', file: { spaceId: DESIGN, spaceName: 'Design' } })
        act(() => {
            editor.chain().focus('end').deleteRange({ from: editor.state.selection.from - 4, to: editor.state.selection.from }).insertContent('des').run()
        })
        await waitFor(() => expect(ids(result.current.candidates)).toEqual([`space:${DESIGN}`]))
    })

    it('a short query never drowns the files: ids match only as a prefix, and files keep a few rows of their own', async () => {
        // "01h" is a substring of every seeded ULID; as a prefix it names nobody
        // by display name, so only the id-prefixed members and the files show.
        const { result } = await mountAndType('see @01h')
        await waitFor(() => expect(result.current.candidates.length).toBeGreaterThan(0))
        expect(result.current.candidates.every((c) => c.file || c.id.toLowerCase().startsWith('01h'))).toBe(true)
        expect(result.current.candidates.some((c) => c.file)).toBe(false) // no file has "01h" in its path
        act(() => {
            editor.chain().focus('end').deleteRange({ from: editor.state.selection.from - 3, to: editor.state.selection.from }).insertContent('a').run()
        })
        // "a" matches Ada, Harsh, and the plan files: people first, but the files are there.
        await waitFor(() => expect(result.current.candidates.some((c) => c.file)).toBe(true))
    })

    it('picking a space inserts a space mention node — the wire token on serialization', async () => {
        const { result } = await mountAndType('moved to @des')
        await waitFor(() => expect(result.current.candidates[0]?.space).toBeDefined())
        act(() => result.current.pick(result.current.candidates[0]!))
        // A pick lands with the space that lets typing carry on.
        expect(composerMarkdown(editor)).toBe(`moved to [#Design](#space:${DESIGN}) `)
        expect(result.current.show).toBe(false)
    })

    it('picking a file from another space inserts the canonical link on THAT space', async () => {
        const { result } = await mountAndType('read @brief')
        await waitFor(() => expect(result.current.candidates[0]?.file?.spaceId).toBe(DESIGN))
        act(() => result.current.pick(result.current.candidates[0]!))
        expect(composerMarkdown(editor)).toBe(`read [plan-brief.md](https://spaces.example.com/s/${DESIGN}/a/A-brief) `)
    })

    it('picking a person outside this space still inserts a member node', async () => {
        const { result } = await mountAndType('cc @ada')
        await waitFor(() => expect(result.current.candidates[0]?.id).toBe('01HADA'))
        act(() => result.current.pick(result.current.candidates[0]!))
        expect(composerMarkdown(editor)).toBe('cc [@Ada Lovelace](#member:01HADA) ')
    })
})
