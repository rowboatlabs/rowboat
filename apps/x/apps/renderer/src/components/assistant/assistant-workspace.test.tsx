import { useReducer, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssistantWorkspace } from './assistant-workspace'
import type { ChatServices } from './chat'
import { assistantLayoutReducer, fitWindow, initialAssistantLayout, type ChatLocation, type WindowSize } from '@/lib/assistant-layout'

vi.mock('@/components/chat-sidebar', () => ({ ChatSidebar: () => null }))
vi.mock('./workspace-chat-adapter', () => ({ WorkspaceChatAdapter: () => null }))
vi.mock('@/hooks/useSessionChat', () => ({ useSessionChat: () => ({ chatState: null }) }))
vi.mock('@/lib/session-title', () => ({ useSessionTitle: () => undefined }))
vi.mock('./chat', () => ({ Chat: ({ tab, location, onMove, controls }: { tab: { id: string }; location: ChatLocation; onMove: (location: ChatLocation) => void; controls?: React.ReactNode }) => {
  const [draft, setDraft] = useState('')
  return <section aria-label={`Chat ${tab.id}`}><header data-chat-header>
    <span>{tab.id}</span>
    {(['assistant', 'sidebar', 'floating'] as const).filter((entry) => entry !== location).map((entry) => <button key={entry} onClick={() => onMove(entry)}>Move to {entry}</button>)}
    {controls}
    </header><input aria-label="Draft" value={draft} onChange={(event) => setDraft(event.target.value)} /></section>
} }))

const tabs = ['a', 'b', 'c'].map((id) => ({ id, chatId: id, runId: null }))
const services: ChatServices = {
  chatTabs: tabs, activeChatTabId: 'a', getChatTabTitle: (tab) => tab.id,
  onSwitchChatTab: vi.fn(), onCloseChatTabs: vi.fn(), onNewChatTab: vi.fn(),
  conversation: [], currentAssistantMessage: '', isProcessing: false, onSubmit: vi.fn(),
  onSubmitForTab: vi.fn(), voiceOwner: null, callChatId: null, onStartRecordingForTab: vi.fn(), onStartCallForTab: vi.fn(),
}
const size = { width: 460, height: 500 }
function Harness({ onResize }: { onResize?: (size: WindowSize) => void } = {}) {
  const [layout, dispatch] = useReducer(assistantLayoutReducer, 'a', initialAssistantLayout)
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  return <>
    <div ref={setHost} aria-label="Assistant page" />
    {['b', 'c'].map((id) => <button key={id} onClick={() => dispatch({ type: 'place', id, location: 'floating', size })}>Float {id}</button>)}
    <button onClick={() => dispatch({ type: 'show-sidebar' })}>Show sidebar</button>
    <AssistantWorkspace {...services} layout={layout} dispatch={(action) => {
      if (action.type === 'resize') onResize?.(action.size)
      dispatch(action)
    }} pageHost={host} pageVisible legacyPane={false}
    onMoveChat={(id, location) => dispatch({ type: 'place', id, location, size })} onCloseChat={(id) => dispatch({ type: 'close', id })}
    onHideSidebar={() => dispatch({ type: 'hide-sidebar' })}
    onNewChatAt={vi.fn()} onSelectChatAt={vi.fn()} onFocusChat={vi.fn()} />
  </>
}
afterEach(cleanup)
/** The container's control, not the chat's: the window's hover bar minimizes it. */
const minimize = (id: string) => fireEvent.click(within(screen.getByLabelText(`Chat ${id}`).closest('[data-floating-chat]') as HTMLElement).getByLabelText('Minimize chat'))

describe('assistant workspace containers', () => {
  it('preserves a mounted draft through Assistant, sidebar, floating, and back', () => {
    render(<Harness />)
    expect(screen.queryByLabelText('Chat sidebar')).not.toBeInTheDocument()
    const input = screen.getByLabelText('Draft')
    fireEvent.change(input, { target: { value: 'Keep my unsent draft' } })
    fireEvent.click(screen.getByText('Move to sidebar'))
    const sidebar = screen.getByLabelText('Chat sidebar')
    expect(within(sidebar).getByLabelText('Draft')).toBe(input)
    // The sidebar's divider runs its full height, title bar included. Its top
    // row continues the title bar (40px, same bottom rule) under the name
    // "Assistant"; the pane proper, with the resize handle, starts below it.
    // The sidebar's close button rides in the chat's own header row inside
    // that pane.
    const [titleBar, pane] = Array.from(sidebar.children) as HTMLElement[]
    expect(sidebar.children).toHaveLength(2)
    expect(sidebar.className).toContain('border-l')
    expect(titleBar.className).toContain('h-10')
    expect(titleBar.className).toContain('border-b')
    expect(titleBar).toHaveTextContent('Assistant')
    expect(within(pane).getByRole('separator', { name: 'Resize chat sidebar' })).toBeInTheDocument()
    const closeSidebar = within(pane).getByLabelText('Close sidebar')
    expect(closeSidebar).toBeVisible()
    expect(closeSidebar.closest('[data-chat-header]')).not.toBeNull()
    expect(screen.queryByLabelText('Close chat')).not.toBeInTheDocument()
    fireEvent.click(closeSidebar)
    expect(screen.queryByLabelText('Chat sidebar')).not.toBeInTheDocument()
    // Restoring the container retains the portal and its local draft state.
    fireEvent.click(screen.getByText('Show sidebar'))
    expect(screen.getByLabelText('Draft')).toBe(input)
    expect(screen.getByLabelText('Draft')).toHaveValue('Keep my unsent draft')
    fireEvent.click(screen.getByText('Move to floating'))
    expect(screen.queryByLabelText('Chat sidebar')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Draft')).toBe(input)
    fireEvent.click(screen.getByText('Move to assistant'))
    expect(screen.getByLabelText('Draft')).toHaveValue('Keep my unsent draft')
    expect(screen.getByLabelText('Draft')).toBe(input)
    expect(screen.queryByLabelText('Floating chats')).not.toBeInTheDocument()
  })

  it('shows a tab only while its window is minimized, and reopens all three in place', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Move to floating'))
    fireEvent.click(screen.getByText('Float b'))
    fireEvent.click(screen.getByText('Float c'))
    const strip = screen.getByLabelText('Floating chats')
    expect(strip.querySelectorAll('[data-assistant-tab]')).toHaveLength(0)
    for (const id of ['a', 'b', 'c']) minimize(id)
    expect(Array.from(strip.querySelectorAll('[data-assistant-tab]')).map((element) => element.getAttribute('data-assistant-tab'))).toEqual(['a', 'b', 'c'])
    expect(screen.queryAllByRole('region', { name: /^Floating chat$/ })).toHaveLength(0)
    for (const id of ['a', 'b', 'c']) fireEvent.click(within(strip).getByRole('button', { name: new RegExp(`^${id}$`) }))
    expect(screen.getAllByRole('region', { name: /^Floating chat$/ })).toHaveLength(3)
    expect(strip.querySelectorAll('[data-assistant-tab]')).toHaveLength(0)
  })

  it('keeps floating chats in one row in strip order, a tab standing in for a minimized window', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Move to floating'))
    fireEvent.click(screen.getByText('Float b'))
    const row = screen.getByLabelText('Floating chats')
    const visible = () => Array.from(row.querySelectorAll<HTMLElement>('[data-floating-chat], [data-floating-tab]'))
      .filter((element) => !element.hidden)
      .map((element) => element.dataset.floatingChat ?? `tab:${element.dataset.floatingTab}`)
    expect(visible()).toEqual(['a', 'b'])
    // The grip in b's hover bar steps it left; a minimized tab's grip works the same way.
    const grip = (element: Element | null) => within(element as HTMLElement).getByLabelText('Reorder chat')
    fireEvent.keyDown(grip(screen.getByLabelText('Chat b').closest('[data-row-item]')), { key: 'ArrowLeft' })
    expect(visible()).toEqual(['b', 'a'])
    minimize('b')
    expect(visible()).toEqual(['tab:b', 'a'])
    fireEvent.keyDown(grip(row.querySelector('[data-floating-tab="b"]')), { key: 'ArrowRight' })
    expect(visible()).toEqual(['a', 'tab:b'])
    // The row hugs the right edge while it fits: both windows fit a 1024px viewport, three do not.
    expect(row.className).toContain('pointer-events-none')
    fireEvent.click(screen.getByText('Float c'))
    fireEvent.click(within(row).getByRole('button', { name: /^b$/ }))
    expect(row.className).toContain('overflow-x-auto')
  })

  it('resizes one window independently and preserves its size across minimize', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Move to floating'))
    fireEvent.click(screen.getByText('Float b'))
    const windows = screen.getAllByRole('region', { name: /^Floating chat$/ })
    const handle = within(windows[0]).getByLabelText('Resize chat nw')
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(windows[0].style.width).toBe('480px')
    expect(windows[0].style.height).toBe('520px')
    expect(windows[1].style.width).toBe('460px')
    minimize('a')
    fireEvent.click(within(screen.getByLabelText('Floating chats')).getByRole('button', { name: /^a$/ }))
    expect(windows[0].style.width).toBe('480px')
    act(() => window.dispatchEvent(new Event('resize')))
    expect(windows[0].style.height).toBe('520px')
  })

  it('keeps windows reachable after the viewport shrinks', () => {
    expect(fitWindow({ width: 1000, height: 800 }, 800, 600)).toEqual({ width: 776, height: 500 })
  })

  it.each(['pointerup', 'pointercancel'])('grows the overflowing row during resize before committing on %s', (finishEvent) => {
    const onResize = vi.fn()
    render(<Harness onResize={onResize} />)
    fireEvent.click(screen.getByText('Move to floating'))
    fireEvent.click(screen.getByText('Float b'))
    fireEvent.click(screen.getByText('Float c'))
    const row = screen.getByLabelText('Floating chats')
    const windows = screen.getAllByRole('region', { name: /^Floating chat$/ })
    const handle = within(windows[0]).getByLabelText('Resize chat nw')
    handle.setPointerCapture = vi.fn()
    const pointer = (type: string, x: number, y: number) => fireEvent(handle, new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }))

    expect(row).toHaveClass('overflow-y-hidden')
    expect(row.style.height).toBe('524px')
    pointer('pointerdown', 500, 300)
    pointer('pointermove', 460, 180)
    expect(windows[0].style.height).toBe('620px')
    expect(windows[0].style.width).toBe('500px')
    expect(windows[1].style.height).toBe('500px')
    expect(row.style.height).toBe('644px')
    expect(onResize).not.toHaveBeenCalled()

    pointer(finishEvent, 460, 180)
    expect(onResize).toHaveBeenCalledExactlyOnceWith({ width: 500, height: 620 })
    expect(row.style.height).toBe('644px')
    minimize('a')
    expect(row.style.height).toBe('524px')
    fireEvent.click(within(row).getByRole('button', { name: /^a$/ }))
    expect(row.style.height).toBe('644px')

    // A subsequent committed resize must not retain the old drag preview.
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(row.style.height).toBe('624px')
  })

  it('updates horizontal overflow as a drag crosses the viewport width', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Move to floating'))
    fireEvent.click(screen.getByText('Float b'))
    const row = screen.getByLabelText('Floating chats')
    const handle = within(screen.getAllByRole('region', { name: /^Floating chat$/ })[0]).getByLabelText('Resize chat w')
    handle.setPointerCapture = vi.fn()
    const pointer = (type: string, x: number) => fireEvent(handle, new MouseEvent(type, { bubbles: true, button: 0, clientX: x }))

    expect(row).toHaveClass('overflow-visible')
    pointer('pointerdown', 500)
    pointer('pointermove', 300)
    expect(row).toHaveClass('overflow-x-auto')
    pointer('pointermove', 500)
    expect(row).toHaveClass('overflow-visible')
    pointer('pointerup', 500)
    expect(row).toHaveClass('overflow-visible')
  })
})
