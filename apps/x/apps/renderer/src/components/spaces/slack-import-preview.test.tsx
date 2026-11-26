import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SlackImportPreviewPanel } from './slack-import-preview'
vi.mock('@/hooks/use-spaces', () => ({ refreshSpacesOrgs: vi.fn() }))
const invoke = vi.fn()
const preview = {
    channels: [{ id: 'C1', name: 'general', private: false, archived: false, messages: 3, replies: 1, authors: 2 }, { id: 'C2', name: 'private', private: true, archived: true, messages: 2, replies: 0, authors: 1 }],
    warnings: [{ code: 'unsupported_file', path: 'dms.json', detail: 'Unsupported file' }],
    records: { read: 6, accepted: 5, skipped: 1, superseded: 0 },
}
beforeEach(() => { invoke.mockReset().mockImplementation(async (channel: string) => channel === 'spaces:listSlackImports' ? { jobs: [] } : preview); Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } }) })
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
    expect(invoke.mock.calls.filter(([channel]) => channel === 'spaces:startSlackImport')).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('Search Slack channels'), { target: { value: 'private' } })
    expect(screen.queryByLabelText('Select general')).toBeNull()
})
it('clears stale selection and supports retry after a server refusal', async () => {
    let refused = false
    invoke.mockImplementation(async (channel: string) => { if (channel === 'spaces:listSlackImports') return { jobs: [] }; if (!refused) { refused = true; throw new Error('ZIP is corrupt') }; return preview })
    render(<SlackImportPreviewPanel orgId="server" />); upload()
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'ZIP is corrupt')
    upload(); await screen.findByLabelText('Select general')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('0 channels selected · 0 messages · 0 replies')).toBeTruthy()
})
it('rejects oversized archives before sending data', async () => {
    render(<SlackImportPreviewPanel orgId="server" />)
    const file = new File(['zip'], 'large.zip'); Object.defineProperty(file, 'size', { value: 101 * 1024 * 1024 })
    fireEvent.change(screen.getByLabelText(/Slack export ZIP/), { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('100 MiB'))
    expect(invoke).not.toHaveBeenCalledWith('spaces:previewSlackImport', expect.anything())
})

it('starts only selected channels after explicit confirmation and shows durable progress', async () => {
    invoke.mockImplementation(async (channel: string) => {
        if (channel === 'spaces:listSlackImports') return { jobs: [] }
        if (channel === 'spaces:startSlackImport') return { id: 'job', workspace: 'team.slack.com', status: 'queued', channels: [{ id: 'C1', name: 'general', status: 'pending' }] }
        return preview
    })
    render(<SlackImportPreviewPanel orgId="server" />); upload()
    fireEvent.click(await screen.findByLabelText('Select general'))
    fireEvent.change(screen.getByLabelText('Slack workspace domain'), { target: { value: 'team.slack.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 channels as new spaces' }))
    await screen.findByText('Import queued')
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('0 of 1 channel processed')
    expect(invoke).toHaveBeenCalledWith('spaces:startSlackImport', { orgId: 'server', bytes: 'emlw', workspace: 'team.slack.com', channelIds: ['C1'], existingChannels: 'skip' })
    expect(screen.queryByLabelText('Select general')).toBeNull()
})

it('shows live progress within a single channel before it commits', async () => {
    invoke.mockResolvedValueOnce({ jobs: [{ id: 'job', workspace: 'team.slack.com', status: 'running',
        currentChannel: { id: 'C1', processed: 12 }, channels: [{ id: 'C1', name: 'general', messages: 30, status: 'pending' }] }] })
    invoke.mockResolvedValue({ jobs: [{ id: 'job', workspace: 'team.slack.com', status: 'completed',
        channels: [{ id: 'C1', name: 'general', messages: 30, status: 'imported' }] }] })
    render(<SlackImportPreviewPanel orgId="server" />)
    const bar = await screen.findByRole('progressbar', { name: 'Import progress for team.slack.com' })
    expect(bar.getAttribute('aria-valuenow')).toBe('40')
    expect(bar.getAttribute('aria-valuetext')).toContain('#general · 12 of 30 messages checked')
    await screen.findByText('Import complete', {}, { timeout: 4000 })
    expect(bar.getAttribute('aria-valuenow')).toBe('100')
    expect(bar.getAttribute('aria-valuetext')).toBe('1 of 1 channel processed')
})
