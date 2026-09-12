import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { FileColumn, RestoreVersionDialog } from './files-tab'
import { isRestorableChangeSet } from '@/lib/spaces-presentation'

vi.mock('@/components/markdown-editor', () => ({ MarkdownEditor: () => null }))
vi.mock('@/components/rich-markdown-viewer', () => ({ RichMarkdownViewer: () => null }))
const toasts: { message: string; kind: string }[] = []
vi.mock('@/lib/toast', () => ({ toast: (message: string, kind: string) => { toasts.push({ message, kind }) } }))

const org = { id: 'org', address: 'spaces.example.com' } as OrgWithSpaces
const space = { id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', name: 'Team' } as spaces.Space
const hash = 'a'.repeat(64)

function changeSet(over: Partial<spaces.ChangeSet> & { resultVersion: number }): spaces.ChangeSet {
    return {
        id: `cs-${over.resultVersion}-${over.op ?? 'edit'}`,
        spaceId: space.id,
        assetPath: 'notes.md',
        baseVersion: over.resultVersion - 1,
        attribution: { memberId: 'm1', actingMode: 'direct' },
        committedAt: '2026-09-10T10:00:00.000Z',
        offset: over.resultVersion,
        ...over,
    } as spaces.ChangeSet
}

const invoke = vi.fn()
/** Every version that exists server-side, newest last. */
let versions: Record<number, { content: string; blob?: { hash: string; size: number; mime: string } }>
let history: spaces.ChangeSet[]
let head: number
let proposals: spaces.SpacesProposeInput[]
/** Queued propose outcomes (a conflict, say) used before the default apply. */
let responses: unknown[]

beforeEach(() => {
    toasts.length = 0
    versions = { 1: { content: 'first' }, 2: { content: 'second' }, 3: { content: 'third' } }
    history = [changeSet({ resultVersion: 3 }), changeSet({ resultVersion: 2 }), changeSet({ resultVersion: 1, baseVersion: 0 })]
    head = 3
    proposals = []
    responses = []
    invoke.mockReset().mockImplementation(async (channel: string, args: Record<string, unknown>) => {
        if (channel === 'spaces:readAsset') {
            const version = (args.version as number | undefined) ?? head
            const data = versions[version]
            if (!data) throw new Error(`no version ${version}`)
            return { path: args.path, content: data.content, ...(data.blob ? { blob: data.blob } : {}), version, recentHistory: history }
        }
        if (channel === 'spaces:assetHistory') return { changeSets: history }
        if (channel === 'spaces:diff') return { unified: '--- a\n+++ b\n' }
        if (channel === 'spaces:proposeChange') {
            proposals.push(args.input as spaces.SpacesProposeInput)
            if (responses.length) {
                const response = responses.shift()
                if (response instanceof Error) throw response
                return response
            }
            head += 1
            return { outcome: 'applied', version: head }
        }
        throw new Error(`Unexpected channel ${channel}`)
    })
    Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } })
})
afterEach(cleanup)

describe('isRestorableChangeSet', () => {
    it('offers older content versions', () => {
        expect(isRestorableChangeSet(changeSet({ resultVersion: 2 }), 3)).toBe(true)
    })
    it('skips the head — it is already what the file says', () => {
        expect(isRestorableChangeSet(changeSet({ resultVersion: 3 }), 3)).toBe(false)
    })
    it.each(['move', 'delete', 'restore'] as const)('skips %s ops, which carry no content of their own', (op) => {
        expect(isRestorableChangeSet(changeSet({ resultVersion: 2, op }), 3)).toBe(false)
    })
})

describe('restoring from the history panel', () => {
    const openHistory = async () => {
        render(
            <FileColumn
                org={org}
                space={space}
                path="notes.md"
                memberNames={new Map([['m1', 'Ada']])}
                refreshTick={0}
                onChanged={vi.fn()}
            />,
        )
        fireEvent.click(await screen.findByRole('button', { name: /History/ }))
        return screen.findByRole('button', { name: 'Restore to v2' })
    }

    it('restores an older version through a confirmation', async () => {
        fireEvent.click(await openHistory())
        expect(await screen.findByText(/Restore “notes.md” to v2\?/)).toBeVisible()
        expect(proposals).toHaveLength(0)
        fireEvent.click(screen.getByRole('button', { name: 'Restore v2' }))
        await waitFor(() => expect(proposals).toHaveLength(1))
        // v2's content, proposed against the head — a new version, not a rewind.
        expect(proposals[0]).toMatchObject({ assetPath: 'notes.md', baseVersion: 3, newContent: 'second', reason: 'restore to v2' })
        await waitFor(() => expect(toasts.at(-1)).toEqual({ message: 'Restored v2 - now v4', kind: 'success' }))
    })

    it('leaves the head alone when the confirmation is cancelled', async () => {
        fireEvent.click(await openHistory())
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
        await waitFor(() => expect(screen.queryByText(/Restore “notes.md” to v2\?/)).not.toBeInTheDocument())
        expect(proposals).toHaveLength(0)
    })

    it('does not offer restore for the version the file is already on', async () => {
        await openHistory()
        expect(screen.queryByRole('button', { name: 'Restore to v3' })).not.toBeInTheDocument()
    })

    it('offers the same restore from the diff it was inspected in', async () => {
        render(
            <FileColumn org={org} space={space} path="notes.md" memberNames={new Map()} refreshTick={0} onChanged={vi.fn()} />,
        )
        fireEvent.click(await screen.findByRole('button', { name: /History/ }))
        // The row body opens the diff; the diff offers the same going-back action.
        fireEvent.click(await screen.findByText('v2', { exact: false, selector: 'div' }))
        const diff = await screen.findByRole('dialog')
        expect(within(diff).getByText('notes.md · v1 → v2')).toBeVisible()
        fireEvent.click(within(diff).getByRole('button', { name: 'Restore to v2' }))
        expect(await screen.findByRole('button', { name: 'Restore v2' })).toBeVisible()
    })

    it('keeps an op change-set out of the diff’s restore action too', async () => {
        history = [changeSet({ resultVersion: 3 }), changeSet({ resultVersion: 2, baseVersion: 2, op: 'move', movedFrom: 'old.md' }), changeSet({ resultVersion: 1, baseVersion: 0 })]
        render(
            <FileColumn org={org} space={space} path="notes.md" memberNames={new Map()} refreshTick={0} onChanged={vi.fn()} />,
        )
        fireEvent.click(await screen.findByRole('button', { name: /History/ }))
        fireEvent.click(await screen.findByText('moved from old.md'))
        const diff = await screen.findByRole('dialog')
        expect(within(diff).queryByRole('button', { name: /^Restore to v/ })).not.toBeInTheDocument()
    })
})

describe('RestoreVersionDialog', () => {
    const open = (version = 2, currentVersion = 3, path = 'notes.md') => {
        const onRestored = vi.fn()
        const onClose = vi.fn()
        render(
            <RestoreVersionDialog
                orgId={org.id}
                spaceId={space.id}
                path={path}
                version={version}
                currentVersion={currentVersion}
                onRestored={onRestored}
                onClose={onClose}
            />,
        )
        return { onRestored, onClose, confirm: () => fireEvent.click(screen.getByRole('button', { name: `Restore v${version}` })) }
    }

    it('re-references a binary version’s blob instead of re-uploading bytes', async () => {
        versions[2] = { content: '', blob: { hash, size: 10, mime: 'application/pdf' } }
        const { confirm } = open()
        confirm()
        await waitFor(() => expect(proposals).toHaveLength(1))
        expect(proposals[0]).toMatchObject({ assetPath: 'notes.md', baseVersion: 3, blob: hash })
        expect(proposals[0].newContent).toBeUndefined()
    })

    it('proposes against the freshly read head, not the one the panel was showing', async () => {
        head = 5
        versions[4] = { content: 'fourth' }
        versions[5] = { content: 'fifth' }
        const { confirm } = open(2, 3)
        confirm()
        await waitFor(() => expect(proposals).toHaveLength(1))
        expect(proposals[0].baseVersion).toBe(5)
    })

    it('keeps the dialog open on a conflict so confirming again retries on the new head', async () => {
        responses = [{ outcome: 'conflict', currentVersion: 7, currentContent: 'theirs', regions: [], recentHistory: [] }]
        const { confirm, onClose, onRestored } = open()
        confirm()
        await waitFor(() => expect(toasts.at(-1)?.kind).toBe('error'))
        expect(toasts.at(-1)?.message).toContain("it's now v7")
        expect(onClose).not.toHaveBeenCalled()
        // The pane underneath still refreshes — the file really did move on.
        expect(onRestored).toHaveBeenCalled()
        expect(await screen.findByText(/stays in history/)).toHaveTextContent('as v8')
        head = 7
        versions[7] = { content: 'theirs' }
        confirm()
        await waitFor(() => expect(proposals).toHaveLength(2))
        expect(proposals[1].baseVersion).toBe(7)
    })

    it('reports a clean merge honestly rather than claiming a verbatim restore', async () => {
        responses = [{ outcome: 'merged', version: 8, mergedContent: 'folded' }]
        const { confirm, onClose } = open()
        confirm()
        await waitFor(() => expect(onClose).toHaveBeenCalled())
        expect(toasts.at(-1)).toEqual({ message: 'Restored v2 with concurrent changes folded in - now v8', kind: 'success' })
    })

    it('surfaces a failure and stays open for a retry', async () => {
        responses = [new Error('Connection lost')]
        const { confirm, onClose } = open()
        confirm()
        await waitFor(() => expect(toasts.at(-1)).toEqual({ message: 'Connection lost', kind: 'error' }))
        expect(onClose).not.toHaveBeenCalled()
        expect(screen.getByRole('button', { name: 'Restore v2' })).toBeEnabled()
    })
})
