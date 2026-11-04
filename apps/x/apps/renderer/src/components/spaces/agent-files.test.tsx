import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FilesScreen } from './agent-files'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
const invoke = vi.fn()
const entries = [
    { name: 'file10.txt', path: '/data/file10.txt', kind: 'file', size: 2000, modifiedAt: '2026-11-02T00:00:00Z' },
    { name: 'file2.txt', path: '/data/file2.txt', kind: 'file', size: 1000, modifiedAt: '2026-11-04T00:00:00Z' },
    { name: 'unknown.txt', path: '/data/unknown.txt', kind: 'file' },
    { name: 'src', path: '/data/src', kind: 'dir' },
]
async function mount() {
    const view = render(<FilesScreen orgId="org" agentId="agent" home="/data" />)
    await screen.findByRole('button', { name: 'file2.txt' })
    return view
}
function fileOrder() {
    return within(screen.getByRole('list', { name: 'Files' })).getAllByRole('button').map(b => b.textContent).filter(t => t === 'src/' || /^(file|unknown).*\.txt$/.test(t ?? ''))
}
async function newFile() {
    fireEvent.pointerDown(screen.getByRole('button', { name: 'New' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New file' }))
}
beforeEach(() => {
    invoke.mockReset()
    Object.assign(window, { ipc: { invoke } })
    invoke.mockImplementation(async (channel, args) => {
        if (channel === 'spaces:listHostingFiles') return { path: args.path, entries: args.path === '/data' ? entries : [] }
        if (channel === 'spaces:readHostingFile') return { path: args.path, content: 'original', truncated: false }
        if (channel === 'spaces:createHostingFile') return { path: `${args.directory}/${args.name}` }
        return {}
    })
})
afterEach(cleanup)

it('filters names and extensions locally, distinguishes no matches, and clears search', async () => {
    await mount()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'FILE2.TXT' } })
    expect(fileOrder()).toEqual(['file2.txt'])
    expect(screen.getByText('1 of 4 items')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '.pdf' } })
    expect(screen.getByText('No matching files.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(fileOrder()).toHaveLength(4)
    expect(invoke).toHaveBeenCalledTimes(1)
})

it('sorts naturally, keeps folders first and unknown metadata last in either direction', async () => {
    await mount()
    expect(fileOrder()).toEqual(['src/', 'file2.txt', 'file10.txt', 'unknown.txt'])
    fireEvent.click(screen.getByRole('button', { name: 'Sort by size' }))
    expect(fileOrder()).toEqual(['src/', 'file2.txt', 'file10.txt', 'unknown.txt'])
    fireEvent.click(screen.getByRole('button', { name: 'Sort by size' }))
    expect(fileOrder()).toEqual(['src/', 'file10.txt', 'file2.txt', 'unknown.txt'])
    fireEvent.click(screen.getByRole('button', { name: 'Sort by modified' }))
    expect(fileOrder()).toEqual(['src/', 'file10.txt', 'file2.txt', 'unknown.txt'])
    expect(screen.getByText('2.0 KB')).toBeInTheDocument()
})

it('navigates breadcrumbs and Home, resets search and preserves sort', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Sort by size' }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'src' } })
    fireEvent.click(screen.getByRole('button', { name: 'src/' }))
    await screen.findByText('Empty folder.')
    expect(screen.getByRole('searchbox')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Sort by size' })).toHaveTextContent('↑')
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'data' }))
    await screen.findByRole('button', { name: 'file2.txt' })
    fireEvent.click(screen.getByRole('button', { name: 'Root directory' }))
    await screen.findByText('Empty folder.')
    expect(screen.queryByRole('button', { name: 'Up' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Home' }))
    await screen.findByRole('button', { name: 'file2.txt' })
})

it('retains the directory after a failed path request and cancels path editing with Escape', async () => {
    await mount()
    invoke.mockRejectedValueOnce(new Error('Directory unavailable'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit path' }))
    fireEvent.change(screen.getByLabelText('Directory'), { target: { value: '/missing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Directory unavailable')
    expect(screen.getByRole('button', { name: 'file2.txt' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByLabelText('Directory'), { key: 'Escape' })
    expect(screen.queryByLabelText('Directory')).not.toBeInTheDocument()
})

it('ignores a stale listing when the starting directory changes', async () => {
    let resolve!: (value: unknown) => void
    const normal = invoke.getMockImplementation()!
    invoke.mockImplementation((channel, args) => args.path === '/slow' ? new Promise(r => { resolve = r }) : normal(channel, args))
    const view = render(<FilesScreen orgId="org" agentId="agent" home="/slow" />)
    view.rerender(<FilesScreen orgId="org" agentId="agent" home="/data" />)
    await screen.findByRole('button', { name: 'file2.txt' })
    await act(async () => resolve({ path: '/slow', entries: [] }))
    expect(screen.getByRole('button', { name: 'file2.txt' })).toBeInTheDocument()
})

it('creates a new empty file in the displayed folder and opens its editor', async () => {
    await mount()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '.pdf' } })
    await newFile()
    fireEvent.change(screen.getByLabelText('File name'), { target: { value: '../bad' } })
    expect(screen.getByRole('button', { name: 'Create file' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('File name'), { target: { value: 'notes.txt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create file' }))
    expect(await screen.findByLabelText('File content')).toHaveValue('')
    expect(screen.getByRole('searchbox')).toHaveValue('')
    expect(invoke).toHaveBeenCalledWith('spaces:createHostingFile', { orgId: 'org', agentId: 'agent', directory: '/data', name: 'notes.txt' })
})

it('keeps the creation form and name on a server collision', async () => {
    await mount()
    const normal = invoke.getMockImplementation()!
    invoke.mockImplementation((channel, args) => channel === 'spaces:createHostingFile' ? Promise.reject(new Error('Already exists')) : normal(channel, args))
    await newFile()
    fireEvent.change(screen.getByLabelText('File name'), { target: { value: 'raced.txt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create file' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Already exists')
    expect(screen.getByLabelText('File name')).toHaveValue('raced.txt')
})

it('guards unsaved edits when changing files, navigating, or closing the editor', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'file2.txt' }))
    fireEvent.change(await screen.findByLabelText('File content'), { target: { value: 'unsaved' } })
    for (const name of ['file10.txt', 'Up', 'Close']) {
        fireEvent.click(screen.getByRole('button', { name }))
        expect(await screen.findByRole('alertdialog')).toHaveTextContent('Discard unsaved changes?')
        fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
        expect(screen.getByLabelText('File content')).toHaveValue('unsaved')
    }
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }))
    expect(screen.queryByLabelText('File content')).not.toBeInTheDocument()
})
