import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __resetModelsForTests } from '@/hooks/use-models'
import { ModelSelectionSection } from './model-selection-section'

// Radix popper content needs these in jsdom (opening the Image model picker).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub
Element.prototype.scrollIntoView = () => {}

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

type ImageProvider = { id: string; flavor: string; status: 'ok' | 'error'; error?: string; models: string[]; listable: boolean }
const GATEWAY_IMAGE_PROVIDER: ImageProvider = {
  id: 'rowboat', flavor: 'rowboat', status: 'ok', models: ['google/gemini-2.5-flash-image'], listable: true,
}

function serve(opts: {
  assistant?: { provider: string; model: string } | null
  taskModels?: Record<string, { provider: string; model: string } | null>
  imageModel?: { provider: string; model: string } | null
  imageProviders?: ImageProvider[]
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
    imageModel: opts.imageModel ?? null,
    deferBackgroundTasks: false,
  })
  handlers['models:listImageModels'] = async () => ({
    providers: opts.imageProviders ?? [GATEWAY_IMAGE_PROVIDER],
  })
  handlers['models:updateConfig'] = async () => ({ success: true })
}

async function openImagePicker(): Promise<void> {
  fireEvent.click(screen.getByTitle('Image model'))
  await waitFor(() => expect(document.querySelector('[cmdk-root]')).not.toBeNull())
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

  it('renders the Image model row; unset reads as "None" with image generation unavailable', async () => {
    serve({ assistant: { provider: 'rowboat', model: 'google/gemini-3.5-flash' } })
    render(<ModelSelectionSection dialogOpen />)

    await waitFor(() => expect(screen.getByTitle('Image model')).toHaveTextContent('None'))
    expect(screen.getByText('Image generation is unavailable until a model is chosen.')).toBeInTheDocument()
    expect(updateCalls).toEqual([])
  })

  it('picking an image model from the image catalog persists the ref', async () => {
    serve({ assistant: { provider: 'rowboat', model: 'google/gemini-3.5-flash' } })
    render(<ModelSelectionSection dialogOpen />)
    await waitFor(() => expect(screen.getByTitle('Image model')).toHaveTextContent('None'))

    await openImagePicker()
    // The image catalog, not the chat catalog, feeds this picker.
    fireEvent.click(await screen.findByText('google/gemini-2.5-flash-image'))
    await waitFor(() => expect(updateCalls).toEqual([
      { imageModel: { provider: 'rowboat', model: 'google/gemini-2.5-flash-image' } },
    ]))
    await waitFor(() => expect(screen.getByTitle('Image model')).toHaveTextContent('google/gemini-2.5-flash-image'))
    expect(screen.getByText('Currently uses Rowboat · google/gemini-2.5-flash-image')).toBeInTheDocument()
  })

  it('a set image model shows Clear, and clearing nulls the field', async () => {
    serve({
      assistant: { provider: 'rowboat', model: 'google/gemini-3.5-flash' },
      imageModel: { provider: 'rowboat', model: 'google/gemini-2.5-flash-image' },
    })
    render(<ModelSelectionSection dialogOpen />)

    await waitFor(() => expect(screen.getByTitle('Image model')).toHaveTextContent('google/gemini-2.5-flash-image'))
    fireEvent.click(screen.getByText('Clear'))
    await waitFor(() => expect(updateCalls).toEqual([{ imageModel: null }]))
    await waitFor(() => expect(screen.getByTitle('Image model')).toHaveTextContent('None'))
    expect(screen.queryByText('Clear')).toBeNull()
  })

  it('a provider without an image listing takes a typed model id', async () => {
    serve({
      assistant: { provider: 'google', model: 'gemini-3.5-flash' },
      imageProviders: [{ id: 'google', flavor: 'google', status: 'ok', models: [], listable: false }],
    })
    render(<ModelSelectionSection dialogOpen />)
    await waitFor(() => expect(screen.getByTitle('Image model')).toHaveTextContent('None'))

    await openImagePicker()
    await screen.findByText('No listed image models — type a model id and pick “Use …”.')
    fireEvent.change(screen.getByPlaceholderText('Search models and providers…'), { target: { value: 'gemini-2.5-flash-image' } })
    fireEvent.click(await screen.findByText('Use "gemini-2.5-flash-image"'))
    await waitFor(() => expect(updateCalls).toEqual([
      { imageModel: { provider: 'google', model: 'gemini-2.5-flash-image' } },
    ]))
  })
})
