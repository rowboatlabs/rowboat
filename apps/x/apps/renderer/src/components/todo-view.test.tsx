import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TodoView } from './todo-view'
import type { TodoBlock, TodoList } from '@x/shared/dist/todo.js'

const item = (text: string): TodoBlock => ({ kind: 'item', item: { key: text.toLowerCase(), text, checked: false, delegated: false, receipts: [], children: [] } })
const list: TodoList = { blocks: [item('Inbox task'), { kind: 'raw', text: '## Work' }, item('Work task'), { kind: 'raw', text: '## Personal' }] }
const invoke = vi.fn()
const compose = vi.fn()
beforeEach(() => {
  localStorage.clear()
  document.elementFromPoint = vi.fn(() => null)
  invoke.mockReset()
  compose.mockReset()
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'todo:get') return { list, running: [], sessions: {}, suggestions: [] }
    if (channel === 'todo:listArchived') return { items: [] }
    if (channel === 'sessions:list') return { sessions: [] }
    if (channel === 'home:threads') return { threads: [] }
    if (channel === 'todo:getPlanner') return { slug: null, active: false, frequency: 'morning' }
    return { success: true, list }
  })
  Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke, on: vi.fn(() => () => {}) } })
  window.matchMedia = vi.fn().mockReturnValue({ matches: true })
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)
async function setup() {
  render(<TooltipProvider><TodoView onOpenNote={vi.fn()} onOpenInChat={vi.fn()} onComposeTodo={compose} composeTarget={{ kind: 'todo', section: { index: 1, heading: '## Work' } }} /></TooltipProvider>)
  await screen.findByText('Work task')
}

function pointer(target: Element | Document, type: string, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { button: 0, pointerId: 1, isPrimary: true, clientX: 20, clientY: y })
  fireEvent(target, event)
}
function pointerDrag(source: Element, destination: Element, y = 50) {
  document.elementFromPoint = vi.fn(() => destination)
  pointer(source, 'pointerdown', 0)
  pointer(document, 'pointermove', y)
  pointer(document, 'pointerup', y)
}

describe('todo sections on the page', () => {
  it('shows empty sections and persists collapse state', async () => {
    await setup()
    expect(screen.getByRole('button', { name: 'Rename section Personal' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse section Work' }))
    expect(screen.queryByText('Work task')).toBeNull()
    expect(screen.getByText('Inbox task')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('todo.collapsedSections')!)).toEqual({ '## Work:0': true })
    fireEvent.click(screen.getByRole('button', { name: 'Expand section Work' }))
    expect(screen.getByText('Work task')).toBeInTheDocument()
  })
  it('renames Uncategorized through its menu and updates destination labels', async () => {
    await setup()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Manage Uncategorized' }), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Section name' }), { target: { value: 'Inbox' } })
    invoke.mockImplementationOnce(async () => ({ success: true, list: { blocks: [{ kind: 'raw', text: 'Default section: Inbox' }, ...list.blocks] } }))
    fireEvent.submit(screen.getByRole('textbox', { name: 'Section name' }).closest('form')!)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('todo:section', { type: 'rename', section: null, name: 'Inbox' }))
    await screen.findByRole('button', { name: 'Manage Inbox' })
    expect(screen.queryByText('Default section: Inbox')).toBeNull()
    expect(screen.getAllByRole('option', { name: 'Inbox' })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Add task to Inbox' }))
    expect(compose).toHaveBeenCalledWith({ kind: 'todo', section: null })
  })

  it('renames a section directly from its title', async () => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Rename section Work' }))
    const input = screen.getByRole('textbox', { name: 'Section name' })
    expect(input).toHaveValue('Work')
    fireEvent.change(input, { target: { value: 'Projects' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('todo:section', { type: 'rename', section: { index: 1, heading: '## Work' }, name: 'Projects' }))
  })
  it('remembers the add destination across additions, New to-do, and remounts', async () => {
    await setup()
    fireEvent.change(screen.getByRole('combobox', { name: 'New task section' }), { target: { value: '1' } })
    const input = screen.getByRole('textbox', { name: 'Add a to-do' })
    fireEvent.change(input, { target: { value: 'Another task' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('todo:addItem', { text: 'Another task', run: false, section: { index: 1, heading: '## Work' } }))
    fireEvent.click(screen.getByRole('button', { name: 'New to-do' }))
    expect(screen.getByRole('combobox', { name: 'New task section' })).toHaveValue('1')
    cleanup()
    await setup()
    expect(screen.getByRole('combobox', { name: 'New task section' })).toHaveValue('1')
  })
  it('resolves a remembered destination after earlier tasks shift its index', async () => {
    localStorage.setItem('todo.addSection', '## Work:0')
    const original = invoke.getMockImplementation()!
    invoke.mockImplementation(async (channel: string, args: unknown) => channel === 'todo:get'
      ? { list: { blocks: [item('Extra inbox task'), ...list.blocks] }, running: [], sessions: {}, suggestions: [] }
      : original(channel, args))
    await setup()
    expect(screen.getByRole('combobox', { name: 'New task section' })).toHaveValue('2')
  })
  it('keeps the remembered destination when renamed and falls back when removed', async () => {
    localStorage.setItem('todo.addSection', '## Work:0')
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Rename section Work' }))
    const input = screen.getByRole('textbox', { name: 'Section name' })
    fireEvent.change(input, { target: { value: 'Projects' } })
    invoke.mockImplementationOnce(async () => ({ success: true, list: { blocks: list.blocks.map(b => b.kind === 'raw' && b.text === '## Work' ? { kind: 'raw', text: '## Projects' } : b) } }))
    fireEvent.submit(input.closest('form')!)
    await screen.findByRole('button', { name: 'Rename section Projects' })
    expect(screen.getByRole('combobox', { name: 'New task section' })).toHaveValue('1')
    expect(localStorage.getItem('todo.addSection')).toBe('## Projects:0')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Manage Projects' }), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove section · keep tasks' }))
    await waitFor(() => expect(localStorage.getItem('todo.addSection')).toBe('uncategorized'))
    expect(screen.getByRole('combobox', { name: 'New task section' })).toHaveValue('-1')
  })
  it('drags a section before another and a task into the collapsed default section', async () => {
    await setup()
    const header = screen.getByRole('button', { name: 'Rename section Work' }).parentElement!
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({ top: 10, height: 40 } as DOMRect)
    pointerDrag(screen.getByRole('button', { name: 'Drag section Personal' }), header, 15)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('todo:section', { type: 'relocate', section: { index: 3, heading: '## Personal' }, before: { index: 1, heading: '## Work' } }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Manage Work' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Collapse section Uncategorized' }))
    pointerDrag(screen.getByRole('button', { name: 'Drag Work task' }), screen.getByRole('button', { name: 'Rename section Uncategorized' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('todo:section', { type: 'move', key: 'work task', section: null }))
  })
  it('drags sections to the bottom and tasks into empty sections', async () => {
    await setup()
    pointer(screen.getByRole('button', { name: 'Drag section Work' }), 'pointerdown', 0)
    pointer(document, 'pointermove', 20)
    const target = screen.getByLabelText('Move section to bottom')
    document.elementFromPoint = vi.fn(() => target)
    pointer(document, 'pointerup', 50)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('todo:section', { type: 'relocate', section: { index: 1, heading: '## Work' }, before: null }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Manage Work' })).not.toBeDisabled())
    pointerDrag(screen.getByRole('button', { name: 'Drag Work task' }), screen.getByRole('button', { name: 'Rename section Personal' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('todo:section', { type: 'move', key: 'work task', section: { index: 3, heading: '## Personal' } }))
  })
  it('cancels dragging with Escape and ignores clicks and drops outside the list', async () => {
    await setup()
    const handle = screen.getByRole('button', { name: 'Drag Work task' })
    document.elementFromPoint = vi.fn(() => screen.getByRole('button', { name: 'Rename section Personal' }))
    pointer(handle, 'pointerdown', 0)
    pointer(document, 'pointerup', 0)
    expect(invoke.mock.calls.some(([channel]) => channel === 'todo:section')).toBe(false)
    pointer(handle, 'pointerdown', 0)
    pointer(document, 'pointermove', 20)
    fireEvent.keyDown(document, { key: 'Escape' })
    pointer(document, 'pointerup', 20)
    expect(invoke.mock.calls.some(([channel]) => channel === 'todo:section')).toBe(false)
    pointer(handle, 'pointerdown', 0)
    pointer(document, 'pointermove', 20)
    document.elementFromPoint = vi.fn(() => null)
    pointer(document, 'pointerup', 20)
    expect(invoke.mock.calls.some(([channel]) => channel === 'todo:section')).toBe(false)
  })
  it('targets a section and allows changing composer destination', async () => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Add task to Work' }))
    expect(compose).toHaveBeenCalledWith({ kind: 'todo', section: { index: 1, heading: '## Work' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Task section' }), { target: { value: '3' } })
    expect(compose).toHaveBeenLastCalledWith({ kind: 'todo', prefill: undefined, section: { index: 3, heading: '## Personal' } })
  })
  it('keeps failed section drafts and supports Escape', async () => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: '+ New section' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Section name' }), { target: { value: 'Ideas' } })
    invoke.mockImplementationOnce(async () => ({ success: false, error: 'Section changed' }))
    fireEvent.submit(screen.getByRole('textbox', { name: 'Section name' }).closest('form')!)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('todo:section', { type: 'create', name: 'Ideas' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled())
    expect(screen.getByRole('textbox', { name: 'Section name' })).toHaveValue('Ideas')
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Section name' }), { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Section name' })).toBeNull()
  })
  it('opens menus by keyboard and sends guarded operations', async () => {
    await setup()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Manage Work' }), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move down' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('todo:section', { type: 'reorder', section: { index: 1, heading: '## Work' }, direction: 'down' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Manage Work' })).not.toBeDisabled())
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Work task to section' }), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Personal' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('todo:section', { type: 'move', key: 'work task', section: { index: 3, heading: '## Personal' } }))
  })
  it('does not apply a section change when pending row edits fail to save', async () => {
    await setup()
    const original = invoke.getMockImplementation()!
    invoke.mockImplementation(async (channel: string, args: unknown) => channel === 'todo:save'
      ? { success: false, error: 'Disk unavailable' }
      : original(channel, args))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: 'Edit to-do: Work task' }))
    const input = screen.getByDisplayValue('Work task')
    fireEvent.change(input, { target: { value: 'Edited work task' } })
    fireEvent.blur(input)
    fireEvent.click(screen.getByRole('button', { name: '+ New section' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Section name' }), { target: { value: 'Ideas' } })
    fireEvent.submit(screen.getByRole('textbox', { name: 'Section name' }).closest('form')!)
    await waitFor(() => expect(invoke.mock.calls.some(([channel]) => channel === 'todo:save')).toBe(true))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled())
    expect(invoke.mock.calls.some(([channel]) => channel === 'todo:section')).toBe(false)
    expect(screen.getByText('Edited work task')).toBeInTheDocument()
    cleanup()
    await Promise.resolve()
    log.mockRestore()
  })
  it('retains inline task drafts after a failed add', async () => {
    await setup()
    const input = screen.getByRole('textbox', { name: 'Add a to-do' })
    fireEvent.change(input, { target: { value: 'Keep this draft' } })
    invoke.mockImplementationOnce(async () => ({ success: false, error: 'Section changed' }))
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('todo:addItem', { text: 'Keep this draft', run: false, section: null }))
    await waitFor(() => expect(input).not.toBeDisabled())
    expect(input).toHaveValue('Keep this draft')
  })
})
