import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlobPreview } from './blob-preview'

vi.mock('@eigenpal/docx-editor-react', () => ({ DocxEditor: ({ mode }: { mode: string }) => <div data-testid="word-mode">{mode}</div> }))

const src = `app://space-blob/org/space/${'a'.repeat(64)}`
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Attachment preview', () => {
    it('uses the shared PDF viewer with the original attachment URL', async () => {
        render(<BlobPreview src={src} name="report.pdf" />)
        const frame = await screen.findByTitle('PDF preview')
        expect(frame).toHaveAttribute('src', src)
        fireEvent.load(frame)
        expect(screen.queryByText('Loading PDF…')).not.toBeInTheDocument()
    })

    it('uses the existing Word editor in viewing mode for attachments', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer }))
        render(<BlobPreview src={src} name="report.docx" />)
        expect(await screen.findByTestId('word-mode')).toHaveTextContent('viewing')
    })

    it('reports failed text loads instead of leaving a loading indicator', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
        render(<BlobPreview src={src} name="report.txt" />)
        await waitFor(() => expect(screen.getByText(/Could not load this preview/)).toBeInTheDocument())
        expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
})
