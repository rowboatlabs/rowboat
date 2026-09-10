import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectsRail } from './projects-rail'

const { projects } = vi.hoisted(() => ({ projects: [
    { id: 'alpha', name: 'Alpha', path: 'knowledge/Workspace/Alpha', chats: [{ id: 'chat-1', title: 'Review report', modifiedAt: '2026-09-10' }] },
    { id: 'beta', name: 'Beta', path: 'knowledge/Workspace/Beta', chats: [] },
] }))
vi.mock('@/hooks/use-projects', () => ({ useProjects: () => ({ projects, ready: true, refresh: vi.fn() }) }))
vi.mock('@/lib/session-title', () => ({ useSessionTitle: () => undefined }))
beforeEach(() => { localStorage.clear() })
afterEach(cleanup)
function props() {
    return {
        tree: [{ path: projects[0].path, name: 'Alpha', kind: 'dir' as const, children: [{ path: `${projects[0].path}/report.md`, name: 'report.md', kind: 'file' as const }] }],
        selectedPath: projects[0].path, selectedFile: null, selectedChat: 'chat-1', processingRunIds: new Set<string>(),
        actions: { remove: vi.fn(), copyPath: vi.fn(), revealInFileManager: vi.fn(), createNote: vi.fn(), createPresentation: vi.fn(), addGoogleDoc: vi.fn(), createFolder: vi.fn() },
        onSelect: vi.fn(), onOpenChat: vi.fn(), onNewChat: vi.fn(), onOpenFile: vi.fn(), onCreateProject: vi.fn(),
    }
}
describe('Projects rail', () => {
    it('opens chats through the assistant callback and files through the document callback', () => {
        const input = props()
        render(<ProjectsRail {...input} />)
        const chat = screen.getByRole('button', { name: 'Review report' })
        expect(chat).toHaveAttribute('aria-current', 'page')
        fireEvent.click(chat)
        expect(input.onOpenChat).toHaveBeenCalledWith(projects[0], 'chat-1')
        fireEvent.click(screen.getByRole('button', { name: 'report.md' }))
        expect(input.onOpenFile).toHaveBeenCalledWith(`${projects[0].path}/report.md`)
        expect(input.onSelect).not.toHaveBeenCalled()
    })
    it('selects projects separately from expanding discussions and scopes new chats to their project', () => {
        const input = props()
        render(<ProjectsRail {...input} />)
        fireEvent.click(screen.getByRole('button', { name: 'Beta' }))
        expect(input.onSelect).toHaveBeenCalledWith(projects[1])
        fireEvent.click(screen.getByRole('button', { name: 'Expand Beta' }))
        expect(input.onSelect).toHaveBeenCalledTimes(1)
        fireEvent.click(screen.getByRole('button', { name: 'New chat in Beta' }))
        expect(input.onNewChat).toHaveBeenCalledWith(projects[1])
    })
    it('collapses project chats independently of the file tree', () => {
        render(<ProjectsRail {...props()} />)
        fireEvent.click(screen.getByRole('button', { name: 'Collapse Alpha' }))
        expect(screen.queryByRole('button', { name: 'Review report' })).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'report.md' })).toBeVisible()
    })
    it('shows running activity without loading chat transcripts for the rail', () => {
        render(<ProjectsRail {...props()} processingRunIds={new Set(['chat-1'])} />)
        expect(screen.getByLabelText('Working')).toBeVisible()
    })
})
