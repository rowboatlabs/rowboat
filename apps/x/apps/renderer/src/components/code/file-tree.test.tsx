import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodeFileTree } from './file-tree'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
const originalIpc = Object.getOwnPropertyDescriptor(window, 'ipc')
afterEach(() => {
  cleanup()
  if (originalIpc) Object.defineProperty(window, 'ipc', originalIpc)
  else Reflect.deleteProperty(window, 'ipc')
})

async function setup() {
  const invoke = vi.fn(async (_channel: string, args: { relPath: string }) => ({ entries:
    args.relPath === '.' ? [{ name: 'src', kind: 'dir' }] : [{ name: 'app.ts', kind: 'file' }],
  }))
  Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } })
  const onSelectFile = vi.fn()
  render(<CodeFileTree sessionId="session" selectedPath={null} onSelectFile={onSelectFile} />)
  await screen.findByRole('button', { name: 'src' })
  return { invoke, onSelectFile }
}

describe('code file-tree menus', () => {
  it('expands a folder and opens a nested file without opening on right-click', async () => {
    const { onSelectFile } = await setup()
    fireEvent.contextMenu(screen.getByRole('button', { name: 'src' }), { button: 2 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Expand folder' }))
    const file = await screen.findByRole('button', { name: 'app.ts' })
    fireEvent.contextMenu(file, { button: 2 })
    expect(onSelectFile).not.toHaveBeenCalled()
    expect(screen.queryByRole('menuitem', { name: 'Refresh files' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open file' }))
    expect(onSelectFile).toHaveBeenCalledExactlyOnceWith('src/app.ts')
  })
  it('refreshes a folder using the current session and relative path', async () => {
    const { invoke } = await setup()
    fireEvent.contextMenu(screen.getByRole('button', { name: 'src' }), { button: 2 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Refresh folder' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('codeSession:readdir', { sessionId: 'session', relPath: 'src' }))
  })
})
