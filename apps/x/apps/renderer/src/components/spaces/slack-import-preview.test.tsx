import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SlackImportPreviewPanel } from './slack-import-preview'
const invoke = vi.fn()
const preview = {
    channels: [{ id: 'C1', name: 'general', private: false, archived: false, messages: 3, replies: 1, authors: 2 }, { id: 'C2', name: 'private', private: true, archived: true, messages: 2, replies: 0, authors: 1 }],
    warnings: [{ code: 'unsupported_file', path: 'dms.json', detail: 'Unsupported file' }],
    records: { read: 6, accepted: 5, skipped: 1, superseded: 0 },
}
beforeEach(() => { invoke.mockReset().mockResolvedValue(preview); Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } }) })
afterEach(cleanup)
const upload = () => fireEvent.change(screen.getByLabelText(/Slack export ZIP/), { target: { files: [new File(['zip'], 'export.zip')] } })
it('previews without writing, supports channel selection and warns about unsupported data', async () => {
    render(<SlackImportPreviewPanel orgId="server" />); upload()
    await screen.findByLabelText('Select general')
    fireEvent.click(screen.getByLabelText('Select general'))
    expect(screen.getByText('1 channels selected · 3 messages · 1 replies')).toBeTruthy()
    expect(screen.getByText('Private · Archived')).toBeTruthy()
    expect(screen.getByText(/1 warnings/)).toBeTruthy()
    expect(invoke).toHaveBeenCalledWith('spaces:previewSlackImport', { orgId: 'server', bytes: 'emlw' })
    expect(invoke).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('Search Slack channels'), { target: { value: 'private' } })
    expect(screen.queryByLabelText('Select general')).toBeNull()
})
it('clears stale selection and supports retry after a server refusal', async () => {
    invoke.mockRejectedValueOnce(new Error('ZIP is corrupt'))
    render(<SlackImportPreviewPanel orgId="server" />); upload()
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'ZIP is corrupt')
    upload(); await screen.findByLabelText('Select general')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('0 channels selected · 0 messages · 0 replies')).toBeTruthy()
})
it('rejects oversized archives before sending data', async () => {
    render(<SlackImportPreviewPanel orgId="server" />)
    const file = new File(['zip'], 'large.zip'); Object.defineProperty(file, 'size', { value: 26 * 1024 * 1024 })
    fireEvent.change(screen.getByLabelText(/Slack export ZIP/), { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('25 MiB'))
    expect(invoke).not.toHaveBeenCalled()
})
