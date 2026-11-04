import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandsScreen, FilesScreen } from './agent-hosting'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
const invoke = vi.fn()

function localFile(name: string, bytes = new Uint8Array([0, 255, 128, 65])) {
    const file = new File([bytes], name)
    Object.defineProperty(file, 'arrayBuffer', { value: vi.fn(async () => bytes.buffer) })
    return file
}

async function mount() {
    render(<FilesScreen orgId="org" agentId="agent" home="/data" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upload files' })).toBeEnabled())
}

beforeEach(() => {
    invoke.mockReset()
    Object.assign(window, { ipc: { invoke } })
    invoke.mockImplementation(async (channel, args) => {
        if (channel === 'spaces:listHostingFiles') return { path: args.path, entries: [] }
        if (channel === 'spaces:uploadHostingFile') return { path: `${args.directory}/${args.name}`, size: 4 }
        return {}
    })
})
afterEach(cleanup)

describe('managed agent file uploads', () => {
    it('uploads binary bytes into the displayed folder and refreshes the listing', async () => {
        await mount()
        fireEvent.click(screen.getByRole('button', { name: 'Edit path' }))
        fireEvent.change(screen.getByLabelText('Directory'), { target: { value: '/data/not-opened' } })
        fireEvent.change(screen.getByLabelText('Choose files to upload'), { target: { files: [localFile('image.png')] } })
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:uploadHostingFile', {
            orgId: 'org', agentId: 'agent', directory: '/data', name: 'image.png', bytes: 'AP+AQQ==',
        }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Upload files' })).toBeEnabled())
        expect(invoke.mock.calls.filter(([channel]) => channel === 'spaces:listHostingFiles')).toHaveLength(2)
    })

    it('uses a navigated directory and reports individual failures while continuing the batch', async () => {
        const normal = invoke.getMockImplementation()!
        invoke.mockImplementation(async (channel, args) => {
            if (channel === 'spaces:uploadHostingFile' && args.name === 'exists.pdf') throw new Error('A file with this name already exists')
            return normal(channel, args)
        })
        await mount()
        fireEvent.click(screen.getByRole('button', { name: 'Edit path' }))
        fireEvent.change(screen.getByLabelText('Directory'), { target: { value: '/data/inbox' } })
        fireEvent.click(screen.getByRole('button', { name: 'Go' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Upload files' })).toBeEnabled())
        fireEvent.change(screen.getByLabelText('Choose files to upload'), { target: { files: [localFile('exists.pdf'), localFile('ok.zip')] } })
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('exists.pdf: A file with this name already exists'))
        expect(invoke).toHaveBeenCalledWith('spaces:uploadHostingFile', expect.objectContaining({ directory: '/data/inbox', name: 'ok.zip' }))
    })

    it('rejects oversized files before reading their contents', async () => {
        await mount()
        const file = localFile('large.zip')
        Object.defineProperty(file, 'size', { value: 100_000_001 })
        fireEvent.change(screen.getByLabelText('Choose files to upload'), { target: { files: [file] } })
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('100 MB'))
        expect(file.arrayBuffer).not.toHaveBeenCalled()
        expect(invoke.mock.calls.some(([channel]) => channel === 'spaces:uploadHostingFile')).toBe(false)
    })

    it('disables navigation during upload and allows selecting the same file again after failure', async () => {
        let reject!: (error: Error) => void
        const normal = invoke.getMockImplementation()!
        invoke.mockImplementation((channel, args) => channel === 'spaces:uploadHostingFile'
            ? new Promise((_resolve, fail) => { reject = fail }) : normal(channel, args))
        await mount()
        const picker = screen.getByLabelText('Choose files to upload')
        const file = localFile('retry.pdf')
        fireEvent.change(picker, { target: { files: [file] } })
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:uploadHostingFile', expect.anything()))
        expect(screen.getByRole('button', { name: 'Edit path' })).toBeDisabled()
        expect(screen.getByRole('status')).toHaveTextContent('Uploading 1 of 1: retry.pdf')
        reject(new Error('Network unavailable'))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Upload files' })).toBeEnabled())
        invoke.mockImplementation(normal)
        fireEvent.change(picker, { target: { files: [file] } })
        await waitFor(() => expect(invoke.mock.calls.filter(([channel]) => channel === 'spaces:uploadHostingFile')).toHaveLength(2))
    })
})


describe('managed file downloads and previews', () => {
    beforeEach(() => {
        Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() })
        invoke.mockImplementation(async (channel, args) => {
            if (channel === 'spaces:listHostingFiles') return { path: args.path, entries: [
                { path: '/data/image.png', name: 'image.png', kind: 'file' },
                { path: '/data/report.pdf', name: 'report.pdf', kind: 'file' },
                { path: '/data/binary.dat', name: 'binary.dat', kind: 'file' },
            ] }
            if (channel === 'spaces:downloadHostingFile') return { path: args.path, bytes: 'AP+AQQ==', mime: args.path.endsWith('.pdf') ? 'application/pdf' : 'image/png' }
            if (channel === 'spaces:readHostingFile') throw new Error('This is a binary file. Download it instead of editing it as text.')
            return {}
        })
    })

    it('previews images and PDFs, releases URLs, and never opens a binary text editor', async () => {
        await mount()
        fireEvent.click(screen.getByRole('button', { name: 'image.png' }))
        expect(await screen.findByRole('img', { name: 'image.png' })).toHaveAttribute('src', 'blob:preview')
        fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
        fireEvent.click(screen.getByRole('button', { name: 'report.pdf' }))
        expect(await screen.findByTitle('PDF preview')).toHaveAttribute('src', 'blob:preview')
        fireEvent.click(screen.getByRole('button', { name: 'binary.dat' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('binary file')
        expect(screen.queryByLabelText('File content')).not.toBeInTheDocument()
        expect(screen.queryByTitle('PDF preview')).not.toBeInTheDocument()
    })

    it('downloads original bytes using the filename', async () => {
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            expect(this.download).toBe('binary.dat')
            expect(this.href).toBe('blob:preview')
        })
        try {
            await mount()
            fireEvent.click(screen.getByRole('button', { name: 'Download binary.dat' }))
            await waitFor(() => expect(click).toHaveBeenCalledOnce())
            const blob = vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob
            expect(blob.size).toBe(4)
            expect(invoke).toHaveBeenCalledWith('spaces:downloadHostingFile', { orgId: 'org', agentId: 'agent', path: '/data/binary.dat' })
        } finally { click.mockRestore() }
    })

    it('drops into the displayed directory and rejects folders', async () => {
        await mount()
        fireEvent.click(screen.getByRole('button', { name: 'Edit path' }))
        fireEvent.change(screen.getByLabelText('Directory'), { target: { value: '/not-opened' } })
        fireEvent.drop(screen.getByLabelText('Agent files'), { dataTransfer: { files: [localFile('dropped.txt')], items: [] } })
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:uploadHostingFile', expect.objectContaining({ directory: '/data', name: 'dropped.txt' })))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Upload files' })).toBeEnabled())
        fireEvent.drop(screen.getByLabelText('Agent files'), { dataTransfer: { files: [], items: [{ webkitGetAsEntry: () => ({ isDirectory: true }) }] } })
        expect(await screen.findByRole('alert')).toHaveTextContent('Folders cannot be uploaded')
    })
})


it.each([
    [{ status: 'timed_out', exitCode: -1 }, 'time limit'],
    [{ status: 'lost', reason: 'vm_replaced' }, 'VM was replaced'],
    [{ status: 'completed', exitCode: 137, signal: 'SIGKILL' }, 'may have run out of memory'],
])('explains terminal execution failure %j and retains output', async (details, message) => {
    invoke.mockResolvedValue({ execution: { id: 'exec', stdout: 'Partial output', ...details } })
    render(<CommandsScreen orgId="org" agentId="agent" />)
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'run-task' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(await screen.findByRole('status')).toHaveTextContent(message)
    expect(screen.getByLabelText('Command output')).toHaveTextContent('Partial output')
})
