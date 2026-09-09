import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyChatTabViewState } from '@/lib/chat-conversation'
import { AssistantPanels } from './assistant-panels'
import { ChatSidebar, type ChatSidebarProps } from './chat-sidebar'

const actions = vi.hoisted(() => ({
  stop: vi.fn<(session: string) => Promise<never[]>>().mockResolvedValue([]),
  remove: vi.fn<(session: string, id: string) => Promise<null>>().mockResolvedValue(null),
  permission: vi.fn<(session: string, id: string, response: string) => Promise<void>>().mockResolvedValue(undefined),
  answer: vi.fn<(session: string, id: string, response: string) => Promise<void>>().mockResolvedValue(undefined),
}))
vi.mock('@/hooks/useSessionChat', () => ({ useSessionChat: (sessionId: string) => ({ chatState: { ...createEmptyChatTabViewState(), currentAssistantMessage: sessionId }, queued: [], stop: () => actions.stop(sessionId), removeQueued: (id: string) => actions.remove(sessionId, id), respondToPermission: (id: string, response: string) => actions.permission(sessionId, id, response), answerAskHuman: (id: string, response: string) => actions.answer(sessionId, id, response) }) }))
vi.mock('./chat-session', () => ({ queuedMessageText: () => '' }))
vi.mock('./chat-sidebar', () => ({ ChatSidebar: (props: ChatSidebarProps) => {
  const [draft, setDraft] = useState('')
  return <section aria-label={props.activeChatTabId} hidden={!props.isOpen}>
    <input aria-label={`Draft ${props.activeChatTabId}`} value={draft} onChange={(event) => setDraft(event.target.value)} />
    <span>{props.currentAssistantMessage}</span>
    <button onClick={() => props.onSubmit({ text: draft, files: [] })}>Send</button>
    <button onClick={props.onStop}>Stop</button>
    <button onClick={() => props.onPermissionResponse?.('permission', [], 'approve')}>Approve</button>
    <button onClick={props.onToggleDock}>{props.floating ? 'Dock' : 'Undock'}</button>
    <button onClick={() => props.onSelectRun?.('selected-session')}>Select chat</button>
    <button onClick={props.onNewChatTab}>New chat</button>
  </section>
} }))

afterEach(() => { cleanup(); vi.clearAllMocks() })

const tabs = [{ id: 'first', chatId: 'first', runId: 'session-first' }, { id: 'second', chatId: 'second', runId: 'session-second' }]
const base = { chatTabs: tabs, activeChatTabId: 'first', getChatTabTitle: () => 'Chat', onNewChatTab: vi.fn(), conversation: [], currentAssistantMessage: '', isProcessing: false, onSubmit: vi.fn(), isOpen: true }
const workspace = { floatingEnabled: true, dockedTabId: null, onDockedWidthChange: vi.fn(), bounds: { first: { width: 420, height: 600, right: 444 }, second: { width: 420, height: 600, right: 12 } }, onResize: vi.fn(), onFocus: vi.fn(), onMinimize: vi.fn(), onClose: vi.fn(), onToggleDock: vi.fn(), onSubmit: vi.fn(), onChangeChat: vi.fn() }

describe('independent assistant panels', () => {
  it('routes selector and new chat to the originating panel, not global new-tab actions', () => {
    const onSelectRun = vi.fn()
    render(<AssistantPanels {...workspace}><ChatSidebar {...base} onSelectRun={onSelectRun} /></AssistantPanels>)
    fireEvent.click(screen.getAllByRole('button', { name: 'Select chat' })[1])
    expect(workspace.onChangeChat).toHaveBeenCalledWith('second', 'selected-session')
    fireEvent.click(screen.getAllByRole('button', { name: 'New chat' })[1])
    expect(workspace.onChangeChat).toHaveBeenCalledWith('second', null)
    expect(base.onNewChatTab).not.toHaveBeenCalled()
    expect(onSelectRun).not.toHaveBeenCalled()
  })
  it('retains both composers through minimize, docking and focus changes', () => {
    const { rerender } = render(<AssistantPanels {...workspace}><ChatSidebar {...base} /></AssistantPanels>)
    const first = screen.getByLabelText('Draft first')
    const second = screen.getByLabelText('Draft second')
    fireEvent.change(first, { target: { value: 'First draft' } })
    fireEvent.change(second, { target: { value: 'Second draft' } })
    rerender(<AssistantPanels {...workspace} bounds={{}}><ChatSidebar {...base} /></AssistantPanels>)
    expect(first).not.toBeVisible()
    rerender(<AssistantPanels {...workspace} dockedTabId="first"><ChatSidebar {...base} activeChatTabId="second" /></AssistantPanels>)
    expect(screen.getByLabelText('Draft first')).toBe(first)
    expect(screen.getByLabelText('Draft second')).toBe(second)
    expect(first).toHaveValue('First draft')
    expect(second).toHaveValue('Second draft')
    expect(screen.getByRole('button', { name: 'Undock' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Dock' })).toBeVisible()
  })

  it('routes send, stop and permissions by panel identity, not focused chat', async () => {
    render(<AssistantPanels {...workspace}><ChatSidebar {...base} /></AssistantPanels>)
    fireEvent.change(screen.getByLabelText('Draft second'), { target: { value: 'Second question' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Send' })[1])
    expect(workspace.onSubmit).toHaveBeenCalledWith('second', { text: 'Second question', files: [] })
    fireEvent.click(screen.getAllByRole('button', { name: 'Stop' })[1])
    fireEvent.click(screen.getAllByRole('button', { name: 'Approve' })[1])
    await waitFor(() => expect(actions.stop).toHaveBeenCalledWith('session-second'))
    expect(actions.permission).toHaveBeenCalledWith('session-second', 'permission', 'allow')
  })
})
