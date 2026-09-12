import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { FileColumn } from './files-tab'

vi.mock('@/components/markdown-editor', () => ({ MarkdownEditor: () => null }))
vi.mock('@/components/rich-markdown-viewer', () => ({ RichMarkdownViewer: () => null }))
vi.mock('./document-viewer', () => ({ SpaceDocumentViewer: () => null }))

const org = { id: 'org', address: 'spaces.example.com' } as OrgWithSpaces
const space = { id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', name: 'Team' } as spaces.Space
const hash = 'a'.repeat(64)
const SOURCE = '---\ntitle: Plan\n---\n\n# Plan\n\n- [ ] ship it\n'

const invoke = vi.fn()
const writeText = vi.fn()
let assets: Record<string, unknown>

beforeEach(() => {
    assets = {
        'notes/plan.md': { path: 'notes/plan.md', version: 4, content: SOURCE, blob: null, recentHistory: [] },
        'notes/data.csv': { path: 'notes/data.csv', version: 2, content: 'a,b\n', blob: null, recentHistory: [] },
        'notes/deck.key': {
            path: 'notes/deck.key', version: 1, content: '', recentHistory: [],
            blob: { hash, mime: 'application/octet-stream', size: 12 },
        },
    }
    invoke.mockReset().mockImplementation(async (channel: string, args: { path?: string }) => {
        if (channel === 'spaces:readAsset') return assets[args.path!]
        if (channel === 'spaces:saveText' || channel === 'spaces:saveBlob') return { saved: true, path: '/tmp/out' }
        throw new Error(`Unexpected channel ${channel}`)
    })
    writeText.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
})
afterEach(cleanup)

function open(path: string) {
    render(
        <FileColumn
            org={org}
            space={space}
            path={path}
            memberNames={new Map()}
            refreshTick={0}
            onChanged={vi.fn()}
        />,
    )
    return screen.findByRole('button', { name: 'Download' })
}

describe('file viewer toolbar', () => {
    it('copies the stored source verbatim without entering edit mode', async () => {
        await open('notes/plan.md')
        fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(SOURCE))
        // Still reading: Edit is the offer, not a mode we were pushed through.
        expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    })

    it('downloads a text file under its own name, extension included', async () => {
        await open('notes/data.csv')
        fireEvent.click(screen.getByRole('button', { name: 'Download' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith(
            'spaces:saveText',
            { content: 'a,b\n', suggestedName: 'data.csv' },
        ))
    })

    it('keeps pulling binaries through the blob cache, and offers no source copy', async () => {
        await open('notes/deck.key')
        expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Download' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith(
            'spaces:saveBlob',
            { orgId: 'org', spaceId: space.id, hash, suggestedName: 'deck.key' },
        ))
    })
})
