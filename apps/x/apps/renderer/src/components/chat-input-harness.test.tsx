import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChatInputWithMentions } from './chat-input-with-mentions'
import { TooltipProvider } from './ui/tooltip'

vi.mock('@/hooks/use-models', () => ({ useModels: () => ({ isRowboatConnected: false, defaultModel: null, defaultEffort: null, refresh: vi.fn() }) }))
vi.mock('@/components/model-selector', () => ({ ModelSelector: () => null }))
vi.mock('@/hooks/use-spaces-mention-targets', () => ({ useSpacesMentionTargets: () => ({ spaces: [], members: [], boards: [] }) }))
vi.mock('@/hooks/use-quick-ask-shortcut', () => ({ useQuickAskShortcut: () => ({ accelerator: 'Alt+Space', registered: true, isDefault: true }) }))
vi.mock('./code/code-agent-options', () => ({ fetchCodeAgentOptions: async () => ({ models: [], efforts: [] }), withDefault: () => [{ value: 'default', label: 'Default' }] }))
vi.mock('./code/code-agent-status', () => ({ AGENT_LABEL: { claude: 'Claude Code', codex: 'Codex' }, fetchCodeAgentsStatus: async () => null, isAgentReady: () => true }))
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

it.each([null, '/documents/non-git'])('allows either harness in an ordinary chat with cwd=%s and legacy Code Mode disabled', async (workDir) => {
  const onSubmit = vi.fn()
  render(<TooltipProvider><ChatInputWithMentions knowledgeFiles={[]} recentFiles={[]} visibleFiles={[]} onSubmit={onSubmit} isProcessing={false} workDir={workDir} /></TooltipProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Harness' }))
  await screen.findByRole('button', { name: 'Harness agent settings' })
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: 'Help me plan the week' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(onSubmit.mock.calls[0]?.[4]).toBe('claude'))
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Harness agent settings' }), { button: 0, ctrlKey: false })
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Codex' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Harness agent settings' }).textContent).toContain('Codex'))
  fireEvent.change(input, { target: { value: 'Draft a summary' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(onSubmit.mock.calls[1]?.[4]).toBe('codex'))
  fireEvent.click(screen.getByRole('button', { name: 'Harness' }))
  fireEvent.change(input, { target: { value: 'Continue without a harness' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3))
  expect(onSubmit.mock.calls[2]?.[4]).toBeUndefined()
  expect(invoke).not.toHaveBeenCalledWith('codeSession:create', expect.anything())
})

it('restores saved Harness options and submits them with the message', async () => {
  localStorage.setItem('rowboat:harness:chat-saved', JSON.stringify({ enabled: true, agent: 'codex', model: 'chosen-model', effort: 'high', policy: 'ask' }))
  const onSubmit = vi.fn()
  render(<TooltipProvider><ChatInputWithMentions draftKey="chat-saved" knowledgeFiles={[]} recentFiles={[]} visibleFiles={[]} onSubmit={onSubmit} isProcessing={false} /></TooltipProvider>)
  expect(screen.getByRole('button', { name: 'Harness' }).getAttribute('aria-pressed')).toBe('true')
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: 'Draft a summary' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(onSubmit).toHaveBeenCalled())
  expect(onSubmit.mock.calls[0]?.[4]).toBe('codex')
  expect(onSubmit.mock.calls[0]?.[6]).toEqual({ enabled: true, agent: 'codex', model: 'chosen-model', effort: 'high', policy: 'ask' })
})
