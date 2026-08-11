import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { deck as deckShared } from '@x/shared'
import { NewPresentationDialog } from './new-presentation-dialog'
import { synthesizeDeckFromOutline } from '@x/shared/dist/pptx/generate.js'

// Radix primitives in jsdom.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub
Element.prototype.scrollIntoView = () => {}
;(Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false

// Synthesis is mocked so a "build failure" can be forced deterministically;
// the real path is covered by generate.test.ts.
vi.mock('@x/shared/dist/pptx/generate.js', () => ({
  synthesizeDeckFromOutline: vi.fn(),
}))
const synthMock = vi.mocked(synthesizeDeckFromOutline)

let handlers: Record<string, (args: unknown) => Promise<unknown>> = {}
const writeCalls: Array<{ path: string }> = []

;(window as unknown as { ipc: unknown }).ipc = {
  on: () => () => undefined,
  send: () => undefined,
  invoke: (channel: string, args: unknown) => {
    const handler = handlers[channel]
    return handler ? handler(args) : Promise.reject(new Error(`no handler: ${channel}`))
  },
}

function baseHandlers(outline: deckShared.DeckOutline, outlineOnRetry?: deckShared.DeckOutline) {
  let call = 0
  handlers = {
    'workspace:exists': async () => ({ exists: false }),
    'workspace:writeFile': async (args: unknown) => {
      writeCalls.push({ path: (args as { path: string }).path })
      return { path: (args as { path: string }).path, stat: {}, etag: '' }
    },
    'deck:generateOutline': async () => {
      call += 1
      return { outline: call === 1 ? outline : outlineOnRetry ?? outline }
    },
  }
}

// A first-turn clarify response now carries questions and NO slides.
// A gap-sized clarify round: more than the old 2-question cap.
const CLARIFY_QUESTIONS = [
  'Who is the audience?',
  'How long is the talk?',
  'What growth metrics can you share?',
  'Do you have a customer quote?',
]
const CLARIFY_OUTLINE: deckShared.DeckOutline = {
  title: 'Draft',
  suggestedPalette: 'navy',
  clarifyingQuestions: CLARIFY_QUESTIONS,
  slides: [],
}

const FINAL_OUTLINE: deckShared.DeckOutline = {
  title: 'Final',
  suggestedPalette: 'navy',
  slides: [
    { layout: 'title', heading: 'Final' },
    { layout: 'title-body', heading: 'Point one', bullets: ['a', 'b'] },
    {
      layout: 'title-body',
      heading: 'Point two',
      bullets: ['[X]% growth'],
      needsInput: ['MoM growth %', 'customer quote'],
    },
  ],
}

function openDialog() {
  return render(
    <NewPresentationDialog
      open
      targetFolder="knowledge/Workspace/Demo"
      onOpenChange={() => {}}
      onCreated={() => {}}
    />,
  )
}

async function switchToGenerate() {
  fireEvent.click(screen.getByText('Generate with AI'))
  await screen.findByLabelText('What should the deck cover?')
}

beforeEach(() => {
  writeCalls.length = 0
  synthMock.mockReset()
})
afterEach(cleanup)

describe('NewPresentationDialog — generate flow', () => {
  it('surfaces a gap-sized question list (4), then re-calls with answers and reaches review', async () => {
    const seen: unknown[] = []
    baseHandlers(CLARIFY_OUTLINE, FINAL_OUTLINE)
    const originalGen = handlers['deck:generateOutline']
    handlers['deck:generateOutline'] = async (args) => {
      seen.push(args)
      return originalGen(args)
    }

    openDialog()
    await switchToGenerate()
    fireEvent.change(screen.getByLabelText('What should the deck cover?'), {
      target: { value: 'a talk about our product' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // Every question appears as an input; Continue stays disabled until ALL answered.
    await screen.findByText(CLARIFY_QUESTIONS[0])
    for (const q of CLARIFY_QUESTIONS.slice(1)) {
      expect(screen.getByText(q)).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    const answers = ['executives', '10 minutes', '40% MoM', 'no quote yet']
    const inputs = screen.getAllByRole('textbox')
    expect(inputs).toHaveLength(CLARIFY_QUESTIONS.length)
    answers.slice(0, 3).forEach((a, i) => fireEvent.change(inputs[i], { target: { value: a } }))
    // Three of four answered → still gated.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    fireEvent.change(inputs[3], { target: { value: answers[3] } })
    expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // Review step: the re-request carried the answers, and the final outline shows.
    await screen.findByRole('button', { name: 'Create' })
    expect(screen.getByLabelText('Title')).toHaveValue('Final')
    expect(screen.getByDisplayValue('Point two')).toBeInTheDocument()

    const retryReq = seen[1] as deckShared.GenerateDeckOutlineRequest
    expect(retryReq.answers).toEqual(answers)
  })

  it('shows needsInput as "fill in" chips on the review rows', async () => {
    baseHandlers(FINAL_OUTLINE)
    openDialog()
    await switchToGenerate()
    fireEvent.change(screen.getByLabelText('What should the deck cover?'), {
      target: { value: 'a deck' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('button', { name: 'Create' })

    expect(screen.getByText('fill in: MoM growth %')).toBeInTheDocument()
    expect(screen.getByText('fill in: customer quote')).toBeInTheDocument()
    // The bracketed placeholder is shown verbatim in the editable bullets.
    expect(screen.getByDisplayValue('[X]% growth')).toBeInTheDocument()
  })

  it('writes nothing when synthesis fails, and shows the error', async () => {
    baseHandlers(FINAL_OUTLINE)
    synthMock.mockRejectedValue(new Error('bad geometry'))

    openDialog()
    await switchToGenerate()
    fireEvent.change(screen.getByLabelText('What should the deck cover?'), {
      target: { value: 'a deck' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await screen.findByRole('button', { name: 'Create' })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await screen.findByText('bad geometry')
    expect(synthMock).toHaveBeenCalledTimes(1)
    expect(writeCalls).toHaveLength(0)
  })

  it('writes and opens when synthesis succeeds', async () => {
    baseHandlers(FINAL_OUTLINE)
    synthMock.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), slideCount: 3, droppedSpeakerNotes: false })

    openDialog()
    await switchToGenerate()
    fireEvent.change(screen.getByLabelText('What should the deck cover?'), {
      target: { value: 'a deck' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('button', { name: 'Create' })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(writeCalls).toHaveLength(1))
    expect(writeCalls[0].path).toBe('knowledge/Workspace/Demo/Final.pptx')
  })
})
