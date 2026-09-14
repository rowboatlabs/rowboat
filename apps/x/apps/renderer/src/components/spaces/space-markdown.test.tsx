import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AttachmentColumn, BlobImage, SpaceAssetsProvider, SpaceMarkdown, SpaceNavProvider, SpaceRefsProvider } from './space-markdown'
import { assetWireUrl, blobWireUrl } from '@/lib/spaces-presentation'

const refs = { orgId: 'org', spaceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', orgAddress: 'spaces.example.com' }
const firstHash = 'a'.repeat(64)
const secondHash = 'b'.repeat(64)
const body = `Photos\n\n![First](${blobWireUrl(refs, firstHash, 'first.png')})\n\n![Second](${blobWireUrl(refs, secondHash, 'second.png')})\n\n![Third](https://example.com/third.png)`
const invoke = vi.fn().mockResolvedValue({ saved: true })

beforeEach(() => { Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } }); invoke.mockReset().mockResolvedValue({ saved: true }) })
afterEach(cleanup)

describe('Spaces message image carousel', () => {
    it('uses actual markdown tiles, opens the clicked image, and navigates only that message', async () => {
        const openAttachment = vi.fn()
        render(<SpaceRefsProvider refs={refs}><SpaceNavProvider onOpenFile={vi.fn()} onOpenAttachment={openAttachment}>
            <SpaceMarkdown body={body} />
            <SpaceMarkdown body="![Other](https://example.com/other.png)" />
        </SpaceNavProvider></SpaceRefsProvider>)
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
        expect(openAttachment).not.toHaveBeenCalled()
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

describe('Message body line breaks', () => {
    it('renders a newline inside a paragraph as a break, the way both composers write one', async () => {
        const { container } = render(<SpaceMarkdown body={'line one\nline two'} />)
        await waitFor(() => expect(container.querySelector('p')).toBeInTheDocument())
        expect(container.querySelector('p br')).toBeInTheDocument()
    })

    it('still separates paragraphs on a blank line', async () => {
        const { container } = render(<SpaceMarkdown body={'first\n\nsecond'} />)
        await waitFor(() => expect(container.querySelectorAll('p')).toHaveLength(2))
        expect(container.querySelector('br')).not.toBeInTheDocument()
    })
})

describe('External link gate', () => {
    // Tunnel and preview hosts are long enough to blow a button's width out
    // past the dialog card, which is what this shape guards.
    const tunnel = '3f8a-2401-4900-1c1a-b5e8-6d31-9f04-a71c.ngrok-free.app'
    const open = vi.fn()

    beforeEach(() => { localStorage.clear(); open.mockReset(); vi.stubGlobal('open', open) })
    afterEach(() => vi.unstubAllGlobals())

    it('elides a long hostname down to its registrable tail, keeping the full one addressable', async () => {
        render(<SpaceMarkdown body={`See [the preview](https://${tunnel}/session/abcdef)`} />)
        fireEvent.click(await screen.findByRole('link', { name: 'the preview' }))
        const dialog = screen.getByRole('dialog')
        expect(within(dialog).getByText(`https://${tunnel}/session/abcdef`)).toBeVisible()
        const trust = within(dialog).getByRole('button', { name: `Trust ${tunnel}` })
        expect(trust).toHaveAttribute('title', tunnel)
        expect(trust.textContent).not.toContain(tunnel)
        expect(trust.textContent).toMatch(/^Trust ….*\.ngrok-free\.app$/)
        // Enter on a warning must not mean "trust this domain forever".
        await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus())
    })

    it('names a short hostname in full and remembers it once trusted', async () => {
        render(<SpaceMarkdown body="See [the docs](https://example.com/docs)" />)
        fireEvent.click(await screen.findByRole('link', { name: 'the docs' }))
        const trust = screen.getByRole('button', { name: 'Trust example.com' })
        expect(trust.textContent).toBe('Trust example.com')
        fireEvent.click(trust)
        expect(open).toHaveBeenCalledWith('https://example.com/docs')
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        // A trusted domain opens straight through on the next click.
        fireEvent.click(screen.getByRole('link', { name: 'the docs' }))
        expect(open).toHaveBeenCalledTimes(2)
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
})

describe('fenced code', () => {
    it('renders a multi-line fence as one code block, every line in it, the prose around it as paragraphs', async () => {
        const { container } = render(<SpaceMarkdown body={'before\n```ts\nconst a = 1\n\nconst b = 2\n```\nafter'} />)
        // The code block is a lazy chunk — it lands a tick after the prose.
        await waitFor(() => expect(container.querySelector('[data-streamdown="code-block-body"]')).toBeTruthy())
        const body = container.querySelector('[data-streamdown="code-block-body"]')!
        expect(body.tagName).toBe('PRE')
        expect(container.querySelector('[data-streamdown="code-block"]')).toHaveAttribute('data-language', 'ts')
        const lines = Array.from(body.querySelectorAll('code > span')).map((line) => line.textContent)
        expect(lines.slice(0, 3)).toEqual(['const a = 1', '', 'const b = 2'])
        expect(container.textContent).not.toContain('```')
        expect(Array.from(container.querySelectorAll('p')).map((p) => p.textContent)).toEqual(['before', 'after'])
    })
})

describe('Space file attachments', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['hello'], { type: 'text/plain' }) }))
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:attachment')
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    })
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

    it('routes attachment clicks to the document panel without opening a modal', async () => {
        const openAttachment = vi.fn()
        render(<SpaceRefsProvider refs={refs}><SpaceNavProvider onOpenFile={vi.fn()} onOpenAttachment={openAttachment}>
            <SpaceMarkdown body={`Conversation stays visible\n\n[notes.txt](${blobWireUrl(refs, firstHash, 'notes.txt')})`} />
        </SpaceNavProvider></SpaceRefsProvider>)
        fireEvent.click(await screen.findByRole('button', { name: 'notes.txt' }))
        expect(openAttachment).toHaveBeenCalledWith(expect.stringContaining(firstHash), 'notes.txt')
        expect(screen.getByText('Conversation stays visible')).toBeVisible()
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(invoke).not.toHaveBeenCalled()
    })

    it('keeps a single uploaded image in the lightbox with save and download actions', async () => {
        const openAttachment = vi.fn()
        render(<SpaceRefsProvider refs={refs}><SpaceNavProvider onOpenFile={vi.fn()} onOpenAttachment={openAttachment}>
            <SpaceMarkdown body={`![Photo](${blobWireUrl(refs, firstHash, 'photo.png')})`} />
        </SpaceNavProvider></SpaceRefsProvider>)
        fireEvent.click(await screen.findByRole('button', { name: 'Preview Photo' }))
        const dialog = screen.getByRole('dialog')
        expect(within(dialog).getByRole('img', { name: 'Photo' })).toBeVisible()
        expect(within(dialog).getByRole('button', { name: 'Download' })).toBeEnabled()
        expect(within(dialog).getByRole('button', { name: 'Save to space files' })).toBeEnabled()
        expect(screen.queryByRole('button', { name: 'Next image' })).not.toBeInTheDocument()
        expect(openAttachment).not.toHaveBeenCalled()
    })

    it('previews in the panel, closes it, and hands saved files to the existing file view', async () => {
        invoke.mockImplementation(async (channel, args) => channel === 'spaces:listAssets'
            ? { entries: [] }
            : { asset: { id: 'A-notes', path: args.input.path, version: 1, updatedAt: '' }, changeSet: {} })
        const onSaved = vi.fn()
        const onDismiss = vi.fn()
        render(<AttachmentColumn src={`app://space-blob/org/${refs.spaceId}/${firstHash}?name=notes.txt`} onSaved={onSaved} onDismiss={onDismiss} />)
        expect(await screen.findByText('hello')).toBeInTheDocument()
        expect(screen.getByRole('region', { name: 'Attachment preview' })).toBeInTheDocument()
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Close attachment preview' }))
        expect(onDismiss).toHaveBeenCalledOnce()
        fireEvent.click(screen.getByRole('button', { name: 'Save to space files' }))
        fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
        // A new file is born by path; the file view then opens the id the org assigned.
        await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ assetId: 'A-notes', path: 'notes.txt' }))
        expect(invoke).toHaveBeenCalledWith('spaces:createAsset', {
            orgId: refs.orgId, spaceId: refs.spaceId,
            input: { path: 'notes.txt', blob: firstHash, reason: 'saved from chat' },
        })
        expect(invoke).not.toHaveBeenCalledWith('spaces:proposeChange', expect.anything())
        expect(invoke).not.toHaveBeenCalledWith('spaces:saveBlob', expect.anything())
    })

    it('keeps the save dialog open when the filename conflicts', async () => {
        invoke.mockImplementation(async (channel) => channel === 'spaces:listAssets' ? { entries: [{ id: 'A-notes', path: 'notes.txt', version: 1 }] } : { outcome: 'conflict', currentVersion: 1 })
        render(<SpaceRefsProvider refs={refs}><SpaceMarkdown body={`[notes.txt](${blobWireUrl(refs, firstHash, 'notes.txt')})`} /></SpaceRefsProvider>)
        fireEvent.click(await screen.findByRole('button', { name: 'Save to space files' }))
        fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
        expect(await screen.findByRole('button', { name: 'Keep both' })).toBeEnabled()
        expect(screen.getByRole('textbox', { name: 'File name' })).toHaveValue('notes.txt')
    })
})


describe.each(['carousel', 'standalone'] as const)('%s image preview actions', (kind) => {
    const src = `app://space-blob/org/${refs.spaceId}/${secondHash}?name=second.png`
    async function openPreview() {
        if (kind === 'carousel') {
            render(<SpaceRefsProvider refs={refs}><SpaceNavProvider onOpenFile={vi.fn()} onOpenAttachment={vi.fn()}><SpaceMarkdown body={body} /></SpaceNavProvider></SpaceRefsProvider>)
        } else render(<BlobImage src={src} alt="Second" />)
        fireEvent.click(await screen.findByRole('button', { name: 'Preview Second' }))
        return screen.getByRole('dialog')
    }

    it('opens the save form and saves the selected image without dismissing the preview', async () => {
        invoke.mockImplementation(async (channel, args) => channel === 'spaces:listAssets'
            ? { entries: [] }
            : { asset: { id: 'A-photo', path: args.input.path, version: 1, updatedAt: '' }, changeSet: {} })
        const lightbox = await openPreview()
        expect(lightbox).toHaveClass('titlebar-no-drag')
        const action = within(lightbox).getByRole('button', { name: 'Save to space files' })
        expect(action.parentElement?.parentElement).toHaveClass('titlebar-no-drag', 'top-14')
        fireEvent.click(action)
        const form = screen.getByRole('dialog', { name: 'Save to space files' })
        const input = within(form).getByRole('textbox', { name: 'File name' })
        expect(input).toHaveValue('second.png')
        fireEvent.keyDown(input, { key: 'ArrowLeft' })
        fireEvent.change(input, { target: { value: 'saved-photo.png' } })
        fireEvent.click(within(form).getByRole('button', { name: /^Save$/ }))
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Save to space files' })).not.toBeInTheDocument())
        expect(invoke).toHaveBeenCalledWith('spaces:createAsset', {
            orgId: refs.orgId, spaceId: refs.spaceId,
            input: { path: 'saved-photo.png', blob: secondHash, reason: 'saved from chat' },
        })
        expect(within(screen.getByRole('dialog')).getByRole('img', { name: 'Second' })).toBeVisible()
    })

    it('shows download failures and retries the selected image', async () => {
        invoke.mockRejectedValueOnce(new Error('Could not fetch image')).mockResolvedValue({ saved: true })
        const lightbox = await openPreview()
        fireEvent.click(within(lightbox).getByRole('button', { name: 'Download' }))
        expect(await within(lightbox).findByRole('alert')).toHaveTextContent('Could not fetch image')
        fireEvent.click(within(lightbox).getByRole('button', { name: 'Download' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
        expect(invoke).toHaveBeenLastCalledWith('spaces:saveBlob', { orgId: refs.orgId, spaceId: refs.spaceId, hash: secondHash, suggestedName: 'second.png' })
        expect(within(lightbox).queryByRole('alert')).not.toBeInTheDocument()
        expect(lightbox).toBeInTheDocument()
    })
})


// File links (2026-09-14): a file is named by its asset id. The canonical
// https link carries the id for any space; a relative link in a message
// resolves through the space's listing at render time.
describe('Space file links', () => {
    const ASSET = '01HXAMPLEASSET0000000000A1'
    const OTHER_SPACE = '01ARZ3NDEKTSV4RRFFQ69G5FB0'
    const entries = [
        { id: ASSET, path: 'decisions/sso.md', version: 2, updatedAt: '' },
        { id: 'A-gone', path: 'old.md', version: 1, updatedAt: '', state: 'deleted' as const },
    ]
    function mount(body: string, nav: Partial<Parameters<typeof SpaceNavProvider>[0]> = {}) {
        const onOpenFile = vi.fn()
        const onOpenSpaceFile = vi.fn()
        render(
            <SpaceRefsProvider refs={refs}>
                <SpaceAssetsProvider entries={entries}>
                    <SpaceNavProvider onOpenFile={onOpenFile} onOpenSpaceFile={onOpenSpaceFile} {...nav}>
                        <SpaceMarkdown body={body} />
                    </SpaceNavProvider>
                </SpaceAssetsProvider>
            </SpaceRefsProvider>,
        )
        return { onOpenFile, onOpenSpaceFile }
    }

    it('opens a canonical /a/<assetId> link to this space by id, titled with the file\u2019s current path', async () => {
        const { onOpenFile } = mount(`see [the decision](${assetWireUrl(refs, ASSET)})`)
        const link = await screen.findByRole('button', { name: 'the decision' })
        expect(link).toHaveAttribute('title', 'decisions/sso.md')
        fireEvent.click(link)
        expect(onOpenFile).toHaveBeenCalledWith(ASSET)
    })

    it('resolves a relative link through the listing (path \u2192 id)', async () => {
        const { onOpenFile } = mount('see [sso](decisions/sso.md)')
        fireEvent.click(await screen.findByRole('button', { name: 'sso' }))
        expect(onOpenFile).toHaveBeenCalledWith(ASSET)
    })

    it('renders a relative link that names no live file as muted text, not an external link', async () => {
        const { onOpenFile } = mount('see [old](old.md) and [nope](missing/thing.md)')
        await screen.findByText('old')
        expect(screen.queryByRole('button', { name: 'old' })).not.toBeInTheDocument()
        expect(screen.queryByRole('link', { name: 'old' })).not.toBeInTheDocument()
        expect(screen.getByText('nope').closest('span[title]')).toHaveAttribute('title', 'No file at missing/thing.md')
        expect(onOpenFile).not.toHaveBeenCalled()
    })

    it('navigates to another space the reader is in for its canonical link', async () => {
        const url = assetWireUrl({ orgAddress: refs.orgAddress, spaceId: OTHER_SPACE }, 'A-there')
        const { onOpenFile, onOpenSpaceFile } = mount(`see [there](${url})`, { resolveSpace: (address, spaceId) => (address === refs.orgAddress && spaceId === OTHER_SPACE ? 'org' : null) })
        fireEvent.click(await screen.findByRole('button', { name: 'there' }))
        expect(onOpenSpaceFile).toHaveBeenCalledWith('org', OTHER_SPACE, 'A-there')
        expect(onOpenFile).not.toHaveBeenCalled()
    })

    it('mutes a canonical link into a space the reader is not in', async () => {
        const url = assetWireUrl({ orgAddress: 'elsewhere.example.com', spaceId: OTHER_SPACE }, 'A-secret')
        const { onOpenFile, onOpenSpaceFile } = mount(`see [secret](${url})`, { resolveSpace: () => null })
        await screen.findByText('secret')
        expect(screen.queryByRole('button', { name: 'secret' })).not.toBeInTheDocument()
        expect(screen.queryByRole('link', { name: 'secret' })).not.toBeInTheDocument()
        expect(screen.getByText('secret').closest('span[title]')).toHaveAttribute('title', 'Not available to you')
        expect(onOpenFile).not.toHaveBeenCalled()
        expect(onOpenSpaceFile).not.toHaveBeenCalled()
    })
})
