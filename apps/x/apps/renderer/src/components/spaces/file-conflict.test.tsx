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
let entries: { path: string; version: number }[]
let proposals: { assetPath: string; baseVersion: number }[]
let responses: unknown[]
beforeEach(() => {
    entries = [{ path: 'report.pdf', version: 3 }, { path: 'report (1).pdf', version: 1 }]
    proposals = []
    responses = []
    invoke.mockReset().mockImplementation(async (channel, args) => {
        if (channel === 'spaces:listAssets') return { entries }
        if (channel === 'spaces:uploadBlob') return { blob: { hash } }
        if (channel === 'spaces:proposeChange') {
            proposals.push(args.input)
            if (responses.length) {
                const response = responses.shift()
                if (response instanceof Error) throw response
                return response
            }
            entries = [...entries.filter((entry) => entry.path !== args.input.assetPath), { path: args.input.assetPath, version: args.input.baseVersion + 1 }]
            return { outcome: 'applied', version: args.input.baseVersion + 1 }
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
    it('offers choices before writing and keeps both using the next available name', async () => {
        await start(kind)
        fireEvent.click(await screen.findByRole('button', { name: 'Keep both' }))
        await waitFor(() => expect(proposals).toHaveLength(1))
        expect(proposals[0]).toMatchObject({ assetPath: 'report (2).pdf', baseVersion: 0 })
    })
    it('replaces only the approved version, retaining its path and history', async () => {
        await start(kind)
        const replace = await screen.findByRole('button', { name: 'Replace' })
        expect(proposals).toHaveLength(0)
        fireEvent.click(replace)
        await waitFor(() => expect(proposals).toHaveLength(1))
        expect(proposals[0]).toMatchObject({ assetPath: 'report.pdf', baseVersion: 3 })
    })
    it('cancels without uploading or changing the existing file', async () => {
        await start(kind)
        await screen.findByRole('button', { name: 'Keep both' })
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Keep both' })).not.toBeInTheDocument())
        expect(proposals).toHaveLength(0)
        expect(invoke).not.toHaveBeenCalledWith('spaces:uploadBlob', expect.anything())
    })
    it('asks again when another user changes the file after the replacement decision', async () => {
        responses = [{ outcome: 'conflict', currentVersion: 4 }]
        await start(kind)
        fireEvent.click(await screen.findByRole('button', { name: 'Replace' }))
        expect(await screen.findByText(/changed while saving/)).toBeVisible()
        expect(proposals).toHaveLength(1)
        expect(proposals[0].baseVersion).toBe(3)
        fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
        await waitFor(() => expect(proposals).toHaveLength(2))
        expect(proposals[1].baseVersion).toBe(4)
    })
    it('resolves a collision that appears after the initial name check', async () => {
        entries = []
        responses = [{ outcome: 'conflict', currentVersion: 1 }]
        await start(kind)
        expect(await screen.findByText(/changed while saving/)).toBeVisible()
        fireEvent.click(screen.getByRole('button', { name: 'Keep both' }))
        await waitFor(() => expect(proposals).toHaveLength(2))
        expect(proposals[0]).toMatchObject({ assetPath: 'report.pdf', baseVersion: 0 })
        expect(proposals[1]).toMatchObject({ assetPath: 'report (1).pdf', baseVersion: 0 })
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
    await waitFor(() => expect(proposals).toHaveLength(2))
    expect(proposals.map((p) => [p.assetPath, p.baseVersion])).toEqual([['report.pdf', 0], ['report (1).pdf', 0]])
})

it('numbers copies in their folder and preserves extensions', () => {
    expect(availableCopyPath('design/report.pdf', new Set(['design/report (1).pdf']))).toBe('design/report (2).pdf')
    expect(availableCopyPath('README', new Set())).toBe('README (1)')
    expect(availableCopyPath('folder/.env', new Set())).toBe('folder/.env (1)')
})
