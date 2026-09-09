import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpaceMarkdown, SpaceRefsProvider } from './space-markdown'
import { blobWireUrl } from '@/lib/spaces-presentation'

const refs = { orgId: 'org', spaceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', orgAddress: 'spaces.example.com' }
const firstHash = 'a'.repeat(64)
const secondHash = 'b'.repeat(64)
const body = `Photos\n\n![First](${blobWireUrl(refs, firstHash, 'first.png')})\n\n![Second](${blobWireUrl(refs, secondHash, 'second.png')})\n\n![Third](https://example.com/third.png)`
const invoke = vi.fn().mockResolvedValue({ saved: true })

beforeEach(() => { Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } }); invoke.mockClear() })
afterEach(cleanup)

describe('Spaces message image carousel', () => {
    it('uses actual markdown tiles, opens the clicked image, and navigates only that message', async () => {
        render(<SpaceRefsProvider refs={refs}>
            <SpaceMarkdown body={body} />
            <SpaceMarkdown body="![Other](https://example.com/other.png)" />
        </SpaceRefsProvider>)
        fireEvent.click(await screen.findByRole('button', { name: 'Preview Second' }))
        const dialog = screen.getByRole('dialog')
        expect(within(dialog).getByRole('img', { name: 'Second' })).toBeInTheDocument()
        expect(within(dialog).getByRole('status')).toHaveTextContent('2 of 3')
        fireEvent.click(within(dialog).getByRole('button', { name: 'Download' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:saveBlob', {
            orgId: 'org', spaceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', hash: secondHash, suggestedName: 'second.png',
        }))
        fireEvent.click(within(dialog).getByRole('img'))
        fireEvent.click(within(dialog).getByRole('button', { name: 'Next image' }))
        expect(within(dialog).getByRole('img', { name: 'Third' }).style.transform).toContain('scale(1)')
        expect(within(dialog).getByRole('button', { name: 'Next image' })).toBeDisabled()
        expect(within(dialog).getByRole('link', { name: 'Open original' })).toHaveAttribute('href', 'https://example.com/third.png')
        fireEvent.click(within(dialog).getByRole('button', { name: 'Download' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:saveImageUrl', { url: 'https://example.com/third.png' }))
        fireEvent.keyDown(dialog, { key: 'ArrowLeft' })
        fireEvent.keyDown(dialog, { key: 'ArrowLeft' })
        expect(within(dialog).getByRole('img', { name: 'First' })).toBeInTheDocument()
        expect(within(dialog).getByRole('button', { name: 'Previous image' })).toBeDisabled()
        fireEvent.keyDown(dialog, { key: 'Escape' })
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        fireEvent.keyDown(screen.getByRole('button', { name: 'Preview Second' }), { key: 'Enter' })
        expect(screen.getByRole('status')).toHaveTextContent('2 of 3')
    })

    it('includes pasted image URLs, skips files and failed images, and handles one image', async () => {
        render(<SpaceMarkdown body={'![First](https://example.com/first.png)\n\nhttps://example.com/pasted.gif\n\n[Document](https://example.com/file.pdf)\n\n![Broken](https://example.com/broken.png)'} />)
        fireEvent.error(await screen.findByRole('button', { name: 'Preview Broken' }))
        fireEvent.click(screen.getByRole('button', { name: 'Preview First' }))
        expect(screen.getByRole('status')).toHaveTextContent('1 of 2')
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' })
        expect(within(screen.getByRole('dialog')).getByRole('img')).toHaveAttribute('src', 'https://example.com/pasted.gif')
        fireEvent.click(screen.getByRole('button', { name: 'Close image preview' }))
        cleanup()
        render(<SpaceMarkdown body="![Only](https://example.com/only.png)" />)
        fireEvent.click(await screen.findByRole('button', { name: 'Preview Only' }))
        expect(screen.queryByRole('button', { name: 'Next image' })).not.toBeInTheDocument()
    })
})
