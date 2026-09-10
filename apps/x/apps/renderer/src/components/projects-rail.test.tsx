import { Activity } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectsRail } from './projects-rail'
import { EmailRail } from './email-rail'
import { SidebarProvider, useSidebar } from './ui/sidebar'

const { projects } = vi.hoisted(() => ({ projects: [
    { id: 'alpha', name: 'Alpha', path: 'knowledge/Workspace/Alpha', chats: [{ id: 'chat-1', title: 'Review report', modifiedAt: '2026-09-10' }] },
    { id: 'beta', name: 'Beta', path: 'knowledge/Workspace/Beta', chats: [] },
    { id: 'default', name: 'General', path: 'knowledge/Workspace', isDefault: true, chats: [{ id: 'general', title: 'General chat', modifiedAt: '2026-09-10' }] },
] }))
vi.mock('@/hooks/use-projects', () => ({ useProjects: () => ({ projects, ready: true, refresh: vi.fn() }) }))
vi.mock('@/lib/session-title', () => ({ useSessionTitle: () => undefined }))
beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function props() {
    return {
        tree: [{ path: projects[0].path, name: 'Alpha', kind: 'dir' as const, children: [{ path: `${projects[0].path}/report.md`, name: 'report.md', kind: 'file' as const }] }],
        selectedPath: projects[0].path, selectedFile: null, selectedChat: 'chat-1', processingRunIds: new Set<string>(),
        actions: { remove: vi.fn(), copyPath: vi.fn(), revealInFileManager: vi.fn(), createNote: vi.fn(), createPresentation: vi.fn(), addGoogleDoc: vi.fn(), createFolder: vi.fn() },
        onSelect: vi.fn(), onOpenChat: vi.fn(), onNewChat: vi.fn(), onOpenFile: vi.fn(), onCreateProject: vi.fn(),
    }
}
describe('Projects rail', () => {
    it('keeps Files collapsed until a named project is selected', () => {
        const input = props()
        const view = render(<ProjectsRail {...input} selectedPath={null} />)
        expect(screen.getByTitle('Show files')).toBeDisabled()
        expect(screen.queryByText('Select a project to see its files.')).toBeNull()
        expect(screen.getByTitle('Show files').closest('section')).toHaveStyle({ flex: '0 0 auto' })
        view.rerender(<ProjectsRail {...input} selectedPath={projects[2].path} />)
        expect(screen.getByTitle('Show files')).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByLabelText('Add to project files')).toBeNull()
        view.rerender(<ProjectsRail {...input} />)
        expect(screen.getByTitle('Hide files')).toBeEnabled()
        expect(screen.getByRole('button', { name: 'report.md' })).toBeVisible()
        view.rerender(<ProjectsRail {...input} selectedPath={projects[2].path} />)
        expect(screen.getByTitle('Show files')).toHaveAttribute('aria-expanded', 'false')
    })
    it('shows General chats in a separate Chats section and keeps their project association', () => {
        const input = { ...props(), selectedPath: projects[2].path, selectedChat: 'general' }
        render(<ProjectsRail {...input} />)
        expect(screen.getAllByRole('button', { name: /^Collapse (Alpha|Beta|General)$/ }).map(button => button.getAttribute('aria-label'))).toEqual(['Collapse Alpha', 'Collapse Beta'])
        expect(screen.queryByRole('button', { name: 'General' })).toBeNull()
        expect(screen.getByRole('button', { name: 'Chats' })).toBeVisible()
        expect(screen.queryByRole('button', { name: 'Actions for General' })).toBeNull()
        const chat = screen.getByRole('button', { name: 'General chat' })
        expect(chat).toHaveAttribute('aria-current', 'page')
        fireEvent.click(chat)
        expect(input.onOpenChat).toHaveBeenCalledWith(projects[2], 'general')
        fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
        expect(input.onNewChat).toHaveBeenCalledWith(projects[2])
        fireEvent.click(screen.getByRole('button', { name: 'Projects' }))
        expect(screen.getByRole('button', { name: 'General chat' })).toBeVisible()
        expect(screen.queryByRole('button', { name: 'Alpha' })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Chats' }))
        expect(screen.queryByRole('button', { name: 'General chat' })).toBeNull()
        fireEvent.click(screen.getByTitle('Show chats'))
        expect(screen.getByRole('button', { name: 'General chat' })).toBeVisible()
    })
    it('starts open with all chat lists expanded and supports bulk collapse and expand', () => {
        localStorage.setItem('projects:railOpen', 'false')
        render(<ProjectsRail {...props()} />)
        expect(screen.getByRole('button', { name: 'Close sidebar' })).toBeVisible()
        expect(screen.getByRole('button', { name: 'Collapse Alpha' })).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByRole('button', { name: 'Collapse Beta' })).toHaveAttribute('aria-expanded', 'true')
        // A partially expanded list must still offer Collapse all, as one button.
        fireEvent.click(screen.getByRole('button', { name: 'Collapse Beta' }))
        expect(screen.getAllByRole('button', { name: /^(Expand|Collapse) all project chats$/ })).toHaveLength(1)
        expect(screen.queryByRole('button', { name: 'Expand all project chats' })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Collapse all project chats' }))
        expect(screen.getByRole('button', { name: 'Expand Alpha' })).toHaveAttribute('aria-expanded', 'false')
        expect(screen.getByRole('button', { name: 'Expand Beta' })).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByRole('button', { name: 'Review report' })).toBeNull()
        expect(screen.getByRole('button', { name: 'General chat' })).toBeVisible()
        expect(screen.getByRole('button', { name: 'report.md' })).toBeVisible()
        fireEvent.click(screen.getByRole('button', { name: 'Expand all project chats' }))
        expect(screen.getByRole('button', { name: 'Review report' })).toBeVisible()
        expect(screen.getByRole('button', { name: 'Collapse Beta' })).toHaveAttribute('aria-expanded', 'true')
    })
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
        fireEvent.click(screen.getByRole('button', { name: 'Collapse Beta' }))
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
    it('preserves expanded file folders when leaving Projects and returning', () => {
        const input = props()
        const reportPath = `${projects[0].path}/Reports`
        const tree = [{ path: projects[0].path, name: 'Alpha', kind: 'dir' as const, children: [{ path: reportPath, name: 'Reports', kind: 'dir' as const, children: [{ path: `${reportPath}/draft.md`, name: 'draft.md', kind: 'file' as const }] }] }]
        const view = render(<Activity mode="visible"><ProjectsRail {...input} tree={tree} /></Activity>)
        fireEvent.click(screen.getByRole('button', { name: 'Reports' }))
        expect(screen.getByRole('button', { name: 'draft.md' })).toBeVisible()
        view.rerender(<Activity mode="hidden"><ProjectsRail {...input} tree={tree} /></Activity>)
        expect(screen.queryByRole('button', { name: 'draft.md' })).toBeNull()
        view.rerender(<Activity mode="visible"><ProjectsRail {...input} tree={tree} /></Activity>)
        expect(screen.getByRole('button', { name: 'draft.md' })).toBeVisible()
        expect(screen.getByRole('button', { name: 'Review report' })).toHaveAttribute('aria-current', 'page')
    })
    it('shows running activity without loading chat transcripts for the rail', () => {
        render(<ProjectsRail {...props()} processingRunIds={new Set(['chat-1'])} />)
        expect(screen.getByLabelText('Working')).toBeVisible()
    })
})

function MainSidebarToggle() {
    const { open, toggleSidebar } = useSidebar()
    return <button onClick={toggleSidebar}>Main sidebar {open ? 'open' : 'closed'}</button>
}
function IndependentSidebars({ active }: { active: boolean }) {
    return <SidebarProvider>
        <MainSidebarToggle />
        <Activity mode={active ? 'visible' : 'hidden'}><ProjectsRail {...props()} /></Activity>
    </SidebarProvider>
}

describe('Projects rail collapse and navigation', () => {
    afterEach(() => vi.useRealTimers())
    it('keeps the main sidebar independent through hover, pin and return visits', () => {
        vi.useFakeTimers()
        const view = render(<IndependentSidebars active={false} />)
        expect(screen.getByRole('button', { name: 'Main sidebar open' })).toBeVisible()
        view.rerender(<IndependentSidebars active />)
        for (let visit = 0; visit < 3; visit++) {
            expect(screen.getByRole('button', { name: 'Main sidebar open' })).toBeVisible()
            fireEvent.click(screen.getByRole('button', { name: 'Close sidebar' }))
            expect(screen.getByText('Review report').closest('aside')).toHaveStyle({ width: '10px' })
            expect(screen.getByRole('button', { name: 'Main sidebar open' })).toBeVisible()
            const rail = screen.getByText('Review report').closest('aside')!
            expect(screen.getByText('Review report').closest('[inert]')).not.toBeNull()
            fireEvent.mouseEnter(rail)
            act(() => vi.advanceTimersByTime(150))
            expect(screen.getByText('Review report').closest('[inert]')).toBeNull()
            expect(screen.getByRole('button', { name: 'report.md' })).toBeVisible()
            fireEvent.click(screen.getByRole('button', { name: 'Lock sidebar open' }))
            expect(screen.getByText('Review report').closest('[inert]')).toBeNull()
            expect(screen.getByRole('button', { name: 'Close sidebar' })).toBeVisible()
            expect(screen.getByRole('button', { name: 'Review report' })).toHaveAttribute('aria-current', 'page')
            view.rerender(<IndependentSidebars active={false} />)
            view.rerender(<IndependentSidebars active />)
        }
        fireEvent.click(screen.getByRole('button', { name: 'Main sidebar open' }))
        expect(screen.getByRole('button', { name: 'Close sidebar' })).toBeVisible()
        view.rerender(<IndependentSidebars active={false} />)
        view.rerender(<IndependentSidebars active />)
        expect(screen.getByRole('button', { name: 'Main sidebar closed' })).toBeVisible()
    })
})

// Exercise real surface components, not a mock of the shared rail's timers.
describe.each(['projects', 'email'] as const)('%s shared hover behavior', (surface) => {
    afterEach(() => vi.useRealTimers())
    it('uses the same opening, closing, cancellation and re-entry timing', () => {
        vi.useFakeTimers()
        const view = render(surface === 'projects' ? <ProjectsRail {...props()} /> : <EmailRail
            view="inbox" inboxFilter="all" otherCategory={null} categoryCounts={{ newsletter: 0, correspondence: 0, unclassified: 0 }}
            labels={[]} draftCount={0} replyReadyCount={0} open={false} onTogglePin={vi.fn()} onSelect={vi.fn()} />)
        if (surface === 'projects') fireEvent.click(screen.getByRole('button', { name: 'Close sidebar' }))
        const rail = view.container.querySelector('aside')!
        const hidden = () => rail.querySelector('[inert]') !== null
        expect(hidden()).toBe(true)
        fireEvent.mouseEnter(rail)
        act(() => vi.advanceTimersByTime(119))
        expect(hidden()).toBe(true)
        act(() => vi.advanceTimersByTime(1))
        expect(hidden()).toBe(false)
        fireEvent.mouseLeave(rail)
        act(() => vi.advanceTimersByTime(219))
        expect(hidden()).toBe(false)
        // Returning before the close delay expires keeps the drawer open.
        fireEvent.mouseEnter(rail)
        act(() => vi.advanceTimersByTime(250))
        expect(hidden()).toBe(false)
        fireEvent.mouseLeave(rail)
        act(() => vi.advanceTimersByTime(220))
        expect(hidden()).toBe(true)
        // A brief pass over the edge must not leave an opening timer behind.
        fireEvent.mouseEnter(rail)
        act(() => vi.advanceTimersByTime(60))
        fireEvent.mouseLeave(rail)
        act(() => vi.advanceTimersByTime(300))
        expect(hidden()).toBe(true)
    })
})
