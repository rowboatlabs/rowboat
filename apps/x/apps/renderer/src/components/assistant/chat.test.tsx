import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Chat, type ChatServices } from './chat'
import { TooltipProvider } from '@/components/ui/tooltip'
import { createEmptyChatTabViewState } from '@/lib/chat-conversation'

const actions = vi.hoisted(() => new Map<string, { stop: ReturnType<typeof vi.fn>; permission: ReturnType<typeof vi.fn>; answer: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }>())
vi.mock('@/hooks/useSessionChat', () => ({ useSessionChat: (id: string) => {
  const calls = actions.get(id)!
  return { chatState: null, queued: [], stop: calls.stop, respondToPermission: calls.permission, answerAskHuman: calls.answer, removeQueued: calls.remove }
} }))
vi.mock('@/lib/session-title', () => ({ useSessionTitle: () => undefined }))
vi.mock('@/components/chat-session', () => ({
  queuedMessageText: () => 'queued text',
  ChatSessionPane: ({ onPermissionResponse, onAskHumanResponse }: { onPermissionResponse: (id: string, subflow: string[], decision: string) => void; onAskHumanResponse: (id: string, subflow: string[], answer: string) => void }) => <><button onClick={() => onPermissionResponse('tool', [], 'approve')}>Approve</button><button onClick={() => onAskHumanResponse('question', [], 'answer')}>Answer</button></>,
  ChatSessionComposer: ({ onSubmit, onStop, focused, initialDraft }: { onSubmit: (message: { text: string; files: [] }) => void; onStop: () => void; focused: boolean; initialDraft?: string }) => <><input aria-label="Composer" autoFocus={focused} defaultValue={initialDraft} /><button onClick={() => onSubmit({ text: 'hello', files: [] })}>Send</button><button onClick={onStop}>Stop</button></>,
}))
afterEach(() => { cleanup(); actions.clear() })

it('routes actions to their originating conversation even when another chat is active', async () => {
  const tabs = ['a', 'b'].map((id) => ({ id, chatId: id, runId: id }))
  for (const tab of tabs) actions.set(tab.id, { stop: vi.fn().mockResolvedValue([]), permission: vi.fn().mockResolvedValue(undefined), answer: vi.fn().mockResolvedValue(undefined), remove: vi.fn() })
  const submit = vi.fn()
  const services: ChatServices = {
    chatTabs: tabs, activeChatTabId: 'a', getChatTabTitle: (tab) => tab.id,
    onSwitchChatTab: vi.fn(), onCloseChatTabs: vi.fn(), onNewChatTab: vi.fn(),
    conversation: [], currentAssistantMessage: '', isProcessing: false, onSubmit: vi.fn(),
    onSubmitForTab: submit, voiceOwner: null, callChatId: null, onStartRecordingForTab: vi.fn(), onStartCallForTab: vi.fn(),
    chatTabStates: { a: createEmptyChatTabViewState(), b: createEmptyChatTabViewState() },
  }
  render(<TooltipProvider>{tabs.map((tab) => <section key={tab.id} aria-label={tab.id}><Chat tab={tab} location="floating" visible focused={tab.id === 'a'} services={services} onMove={vi.fn()} onNew={vi.fn()} onSelect={vi.fn()} /></section>)}</TooltipProvider>)
  const second = within(screen.getByLabelText('b'))
  fireEvent.click(second.getByText('Send'))
  expect(submit).toHaveBeenCalledWith('b', { text: 'hello', files: [] })
  fireEvent.click(second.getByText('Stop'))
  fireEvent.click(second.getByText('Approve'))
  fireEvent.click(second.getByText('Answer'))
  await waitFor(() => expect(actions.get('b')!.stop).toHaveBeenCalledOnce())
  expect(actions.get('a')!.stop).not.toHaveBeenCalled()
  expect(actions.get('b')!.permission).toHaveBeenCalledWith('tool', 'allow')
  expect(actions.get('b')!.answer).toHaveBeenCalledWith('question', 'answer')
  expect(second.getByLabelText('Move to sidebar')).toBeVisible()
  expect(second.getByLabelText('Move to Assistant')).toBeVisible()
  expect(second.queryByLabelText('Move to floating window')).not.toBeInTheDocument()
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
})

it('seats the container controls at the end of its header row', () => {
  const tab = { id: 'a', chatId: 'a', runId: 'a' }
  actions.set('a', { stop: vi.fn().mockResolvedValue([]), permission: vi.fn(), answer: vi.fn(), remove: vi.fn() })
  const services: ChatServices = {
    chatTabs: [tab], activeChatTabId: 'a', getChatTabTitle: (entry) => entry.id,
    onSwitchChatTab: vi.fn(), onCloseChatTabs: vi.fn(), onNewChatTab: vi.fn(),
    conversation: [], currentAssistantMessage: '', isProcessing: false, onSubmit: vi.fn(),
    onSubmitForTab: vi.fn(), voiceOwner: null, callChatId: null, onStartRecordingForTab: vi.fn(), onStartCallForTab: vi.fn(),
    chatTabStates: { a: createEmptyChatTabViewState() },
  }
  render(<TooltipProvider><Chat tab={tab} location="sidebar" visible focused services={services} onMove={vi.fn()} onNew={vi.fn()} onSelect={vi.fn()}
    controls={<button aria-label="Close sidebar" />} /></TooltipProvider>)
  const header = document.querySelector('[data-chat-header]') as HTMLElement
  const close = within(header).getByLabelText('Close sidebar')
  expect(header.lastElementChild).toBe(close)
  expect(within(header).getByLabelText('Move to floating window').compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})
