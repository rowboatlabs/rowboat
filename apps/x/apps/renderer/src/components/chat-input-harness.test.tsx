import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChatInputWithMentions } from './chat-input-with-mentions'
import { TooltipProvider } from './ui/tooltip'

vi.mock('@/hooks/use-models', () => ({ useModels: () => ({ isRowboatConnected: false, defaultModel: null, defaultEffort: null, refresh: vi.fn() }) }))
vi.mock('@/components/model-selector', () => ({ ModelSelector: () => null }))
vi.mock('@/hooks/use-spaces-mention-targets', () => ({ useSpacesMentionTargets: () => ({ spaces: [], members: [], boards: [] }) }))
vi.mock('@/hooks/use-quick-ask-shortcut', () => ({ useQuickAskShortcut: () => ({ accelerator: 'Alt+Space', registered: true, isDefault: true }) }))
const invoke = vi.fn(async (channel: string) => {
  if (channel === 'codeMode:getConfig') return { enabled: false }
  if (channel === 'workspace:readFile') return { data: '{}' }
  return { success: true }
})
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('PointerEvent', MouseEvent)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  Object.assign(window, { ipc: { invoke, on: vi.fn(() => () => {}) } })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

it.each([null, '/documents/non-git'])('keeps Harness out of Assistant, including chats with old saved preferences (cwd=%s)', async (workDir) => {
  localStorage.setItem('rowboat:harness:old-chat', JSON.stringify({ enabled: true, agent: 'codex', model: 'old-model', policy: 'yolo' }))
  const onSubmit = vi.fn()
  render(<TooltipProvider><ChatInputWithMentions draftKey="old-chat" knowledgeFiles={[]} recentFiles={[]} visibleFiles={[]} onSubmit={onSubmit} isProcessing={false} workDir={workDir} /></TooltipProvider>)
  expect(screen.queryByRole('button', { name: 'Harness' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Harness agent settings' })).toBeNull()
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: 'Help me plan the week' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
  expect(onSubmit.mock.calls[0]?.[4]).toBeUndefined()
  expect(onSubmit.mock.calls[0]?.[6]).toBeUndefined()
  expect(invoke).not.toHaveBeenCalledWith('codeSession:create', expect.anything())
})

it.each([true, false])('respects the Project session Harness preference (%s)', async (enabled) => {
  const onSubmit = vi.fn()
  render(<TooltipProvider><ChatInputWithMentions knowledgeFiles={[]} recentFiles={[]} visibleFiles={[]} onSubmit={onSubmit} isProcessing={false} codeSessionLock={{ cwd: '/repo', agent: 'codex', codeModeEnabled: enabled }} /></TooltipProvider>)
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: 'Continue this project' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
  expect(onSubmit.mock.calls[0]?.[4]).toBe(enabled ? 'codex' : undefined)
})
