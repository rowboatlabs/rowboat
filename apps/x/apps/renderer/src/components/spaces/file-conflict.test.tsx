import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { UploadFilesDialog } from './files-tab'
import { SpaceMarkdown, SpaceRefsProvider } from './space-markdown'
import { availableCopyPath } from './file-conflict'
import { blobWireUrl } from '@/lib/spaces-presentation'

vi.mock('@/components/markdown-editor', () => ({ MarkdownEditor: () => null }))
vi.mock('@/components/rich-markdown-viewer', () => ({ RichMarkdownViewer: () => null }))

const refs = { orgId: 'org', spaceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', orgAddress: 'spaces.example.com' }
const hash = 'a'.repeat(64)
const invoke = vi.fn()
let entries: { id: string; path: string; version: number }[]
/** Every write, in order: a birth (createAsset, by path) or a new version (proposeChange, by id). */
let writes: ({ op: 'create'; path: string } | { op: 'propose'; assetId: string; baseVersion: number })[]
/** Queued outcomes for the next writes: a propose conflict, a create refusal (the path got taken), or a failure. */
let responses: unknown[]
let nextId = 1
beforeEach(() => {
    entries = [{ id: 'A-report', path: 'report.pdf', version: 3 }, { id: 'A-report-1', path: 'report (1).pdf', version: 1 }]
    writes = []
    responses = []
    nextId = 1
    invoke.mockReset().mockImplementation(async (channel, args) => {
        if (channel === 'spaces:listAssets') return { entries }
        if (channel === 'spaces:uploadBlob') return { blob: { hash } }
        if (channel === 'spaces:proposeChange') {
            writes.push({ op: 'propose', assetId: args.input.assetId, baseVersion: args.input.baseVersion })
            if (responses.length) {
                const response = responses.shift()
                if (response instanceof Error) throw response
                return response
            }
            entries = entries.map((entry) => (entry.id === args.input.assetId ? { ...entry, version: args.input.baseVersion + 1 } : entry))
            return { outcome: 'applied', version: args.input.baseVersion + 1 }
        }
        if (channel === 'spaces:createAsset') {
            writes.push({ op: 'create', path: args.input.path })
            if (responses.length) {
                const response = responses.shift()
                if (response instanceof Error) throw response
                // The org refuses an occupied path: the occupant appears in the listing.
                if (response && typeof response === 'object' && 'occupiedBy' in response) {
                    entries = [...entries, { id: (response as { occupiedBy: string }).occupiedBy, path: args.input.path, version: 1 }]
                    throw new Error(`a file already exists at ${args.input.path}`)
                }
                return response
            }
            if (entries.some((entry) => entry.path === args.input.path)) throw new Error(`a file already exists at ${args.input.path}`)
            const asset = { id: `A-new-${nextId++}`, path: args.input.path, version: 1, updatedAt: '' }
            entries = [...entries, asset]
            return { asset, changeSet: { id: 'cs', assetId: asset.id, assetPath: asset.path } }
        }
        throw new Error(`Unexpected channel ${channel}`)
    })
    Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } })
})
afterEach(cleanup)

async function start(kind: 'upload' | 'attachment', files = [new File(['data'], 'report.pdf')]) {
    if (kind === 'upload') {
        render(<UploadFilesDialog org={{ id: 'org' } as OrgWithSpaces} space={{ id: refs.spaceId, name: 'Team' } as spaces.Space} files={files} entries={[]} onDone={vi.fn()} onClose={vi.fn()} />)
        fireEvent.click(screen.getByRole('button', { name: /^Upload(?: \d+ files)?$/ }))
    } else {
        render(<SpaceRefsProvider refs={refs}><SpaceMarkdown body={`[report.pdf](${blobWireUrl(refs, hash, 'report.pdf')})`} /></SpaceRefsProvider>)
        fireEvent.click(await screen.findByRole('button', { name: 'Save to space files' }))
        fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    }
}

describe.each(['upload', 'attachment'] as const)('%s duplicate resolution', (kind) => {
    it('offers choices before writing and keeps both as a new file at the next available name', async () => {
        await start(kind)
        fireEvent.click(await screen.findByRole('button', { name: 'Keep both' }))
        await waitFor(() => expect(writes).toHaveLength(1))
        // A copy is a birth: createAsset by path, never a propose at version 0.
        expect(writes[0]).toEqual({ op: 'create', path: 'report (2).pdf' })
        expect(invoke).not.toHaveBeenCalledWith('spaces:proposeChange', expect.anything())
    })
    it('replaces only the approved version, by the existing file\u2019s id, retaining its path and history', async () => {
        await start(kind)
        const replace = await screen.findByRole('button', { name: 'Replace' })
        expect(writes).toHaveLength(0)
        fireEvent.click(replace)
        await waitFor(() => expect(writes).toHaveLength(1))
        expect(writes[0]).toEqual({ op: 'propose', assetId: 'A-report', baseVersion: 3 })
        expect(invoke).not.toHaveBeenCalledWith('spaces:createAsset', expect.anything())
    })
    it('cancels without uploading or changing the existing file', async () => {
        await start(kind)
        await screen.findByRole('button', { name: 'Keep both' })
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Keep both' })).not.toBeInTheDocument())
        expect(writes).toHaveLength(0)
        expect(invoke).not.toHaveBeenCalledWith('spaces:uploadBlob', expect.anything())
    })
    it('asks again when another user changes the file after the replacement decision', async () => {
        responses = [{ outcome: 'conflict', currentVersion: 4 }]
        await start(kind)
        fireEvent.click(await screen.findByRole('button', { name: 'Replace' }))
        expect(await screen.findByText(/changed while saving/)).toBeVisible()
        expect(writes).toHaveLength(1)
        expect(writes[0]).toEqual({ op: 'propose', assetId: 'A-report', baseVersion: 3 })
        fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
        await waitFor(() => expect(writes).toHaveLength(2))
        // Same file, the version the conflict reported — never a refreshed head.
        expect(writes[1]).toEqual({ op: 'propose', assetId: 'A-report', baseVersion: 4 })
    })
    it('resolves a collision that appears after the initial name check', async () => {
        entries = []
        // The path got taken between the listing and the create: the org refuses it.
        responses = [{ occupiedBy: 'A-raced' }]
        await start(kind)
        expect(await screen.findByText(/changed while saving/)).toBeVisible()
        fireEvent.click(screen.getByRole('button', { name: 'Keep both' }))
        await waitFor(() => expect(writes).toHaveLength(2))
        expect(writes[0]).toEqual({ op: 'create', path: 'report.pdf' })
        expect(writes[1]).toEqual({ op: 'create', path: 'report (1).pdf' })
    })
    it('offers Replace against the file that raced in, by its id', async () => {
        entries = []
        responses = [{ occupiedBy: 'A-raced' }]
        await start(kind)
        fireEvent.click(await screen.findByRole('button', { name: 'Replace' }))
        await waitFor(() => expect(writes).toHaveLength(2))
        expect(writes[1]).toEqual({ op: 'propose', assetId: 'A-raced', baseVersion: 1 })
    })
    it('keeps save failures visible after choosing a resolution', async () => {
        responses = [new Error('Could not save file')]
        await start(kind)
        fireEvent.click(await screen.findByRole('button', { name: 'Keep both' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('Could not save file')
        expect(screen.getByRole('button', { name: kind === 'upload' ? /^Upload$/ : /^Save$/ })).toBeEnabled()
    })
    it('shows lookup failures inline and allows retry', async () => {
        invoke.mockRejectedValueOnce(new Error('Connection lost'))
        await start(kind)
        expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost')
        expect(screen.getByRole('button', { name: kind === 'upload' ? /^Upload$/ : /^Save$/ })).toBeEnabled()
    })
})

it('resolves duplicate names within the same upload batch', async () => {
    entries = []
    await start('upload', [new File(['one'], 'report.pdf'), new File(['two'], 'report.pdf')])
    fireEvent.click(await screen.findByRole('button', { name: 'Keep both' }))
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(writes).toEqual([{ op: 'create', path: 'report.pdf' }, { op: 'create', path: 'report (1).pdf' }])
})

it('numbers copies in their folder and preserves extensions', () => {
    expect(availableCopyPath('design/report.pdf', new Set(['design/report (1).pdf']))).toBe('design/report (2).pdf')
    expect(availableCopyPath('README', new Set())).toBe('README (1)')
    expect(availableCopyPath('folder/.env', new Set())).toBe('folder/.env (1)')
})
