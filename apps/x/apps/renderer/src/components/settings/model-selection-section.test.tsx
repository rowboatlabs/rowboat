import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __resetModelsForTests } from '@/hooks/use-models'
import { ModelSelectionSection } from './model-selection-section'

// Same preload stub pattern as use-models.test.tsx.
let handlers: Record<string, (args: unknown) => Promise<unknown>> = {}
let updateCalls: unknown[] = []

;(window as unknown as { ipc: unknown }).ipc = {
  on: () => () => undefined,
  invoke: (channel: string, args: unknown) => {
    if (channel === 'models:updateConfig') updateCalls.push(args)
    const handler = handlers[channel]
    return handler ? handler(args) : Promise.reject(new Error(`no handler: ${channel}`))
  },
}

const EMPTY_TASKS = {
  knowledgeGraph: null,
  meetingNotes: null,
  liveNoteAgent: null,
  autoPermissionDecision: null,
  chatTitle: null,
  backgroundTask: null,
  subagent: null,
}

function serve(opts: {
  assistant?: { provider: string; model: string } | null
  taskModels?: Record<string, { provider: string; model: string } | null>
}): void {
  handlers['models:list'] = async () => ({
    providers: [
      { id: 'rowboat', flavor: 'rowboat', status: 'ok', models: [{ id: 'google/gemini-3.5-flash' }] },
    ],
    defaultModel: opts.assistant ?? null,
  })
  handlers['models:getConfig'] = async () => ({
    assistantModel: opts.assistant ?? null,
    taskModels: { ...EMPTY_TASKS, ...(opts.taskModels ?? {}) },
    deferBackgroundTasks: false,
  })
  handlers['models:updateConfig'] = async () => ({ success: true })
}

beforeEach(() => {
  __resetModelsForTests()
  handlers = {}
  updateCalls = []
})

afterEach(cleanup)

describe('ModelSelectionSection', () => {
  it('shows the effective assistant model and "Same as Assistant" for un-overridden tasks', async () => {
    serve({ assistant: { provider: 'rowboat', model: 'google/gemini-3.5-flash' } })
    render(<ModelSelectionSection dialogOpen />)

    // Assistant trigger shows the actual model — no "Auto" anywhere.
    await waitFor(() => expect(screen.getByTitle('Assistant model')).toHaveTextContent('google/gemini-3.5-flash'))
    // The old sentinel labels are gone for good.
    expect(screen.queryByText(/Auto \(/)).toBeNull()
    expect(screen.queryByText('Rowboat default')).toBeNull()

    // All seven tasks render, inheriting.
    for (const label of ['Background agents', 'Subagents', 'Knowledge graph', 'Meeting notes', 'Live notes', 'Permission checks', 'Chat titles']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getAllByText('Same as Assistant').length).toBe(7)
    // Inherit subtext names the resolved assistant.
    expect(screen.getAllByText('Currently uses Rowboat · google/gemini-3.5-flash').length).toBeGreaterThan(0)
  })

  it('an overridden task shows "Use Assistant model" and clicking it clears the override', async () => {
    serve({
      assistant: { provider: 'rowboat', model: 'google/gemini-3.5-flash' },
      taskModels: { knowledgeGraph: { provider: 'rowboat', model: 'google/gemini-3.1-flash-lite' } },
    })
    render(<ModelSelectionSection dialogOpen />)

    const clear = await screen.findByText('Use Assistant model')
    fireEvent.click(clear)
    await waitFor(() => expect(updateCalls).toEqual([
      { taskModels: { knowledgeGraph: null } },
    ]))
    // Back to inheriting.
    await waitFor(() => expect(screen.queryByText('Use Assistant model')).toBeNull())
  })
})
