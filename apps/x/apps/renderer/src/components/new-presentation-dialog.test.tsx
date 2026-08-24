import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewPresentationDialog } from './new-presentation-dialog'
import { DECK_PALETTES } from '@x/shared/dist/pptx/new-deck.js'

// Radix primitives in jsdom.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub
Element.prototype.scrollIntoView = () => {}
;(Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false

let handlers: Record<string, (args: unknown) => Promise<unknown>> = {}
let writeCalls: Array<{ path: string; data: string }> = []
let existing: Set<string>

;(window as unknown as { ipc: unknown }).ipc = {
  on: () => () => undefined,
  send: () => undefined,
  invoke: (channel: string, args: unknown) => {
    const handler = handlers[channel]
    return handler ? handler(args) : Promise.reject(new Error(`no handler: ${channel}`))
  },
}

const onCreated = vi.fn()
const onOpenChange = vi.fn()

beforeEach(() => {
  writeCalls = []
  existing = new Set()
  onCreated.mockClear()
  onOpenChange.mockClear()
  handlers = {
    'workspace:exists': async (args) => ({
      exists: existing.has((args as { path: string }).path),
    }),
    'workspace:writeFile': async (args) => {
      const { path, data } = args as { path: string; data: string }
      writeCalls.push({ path, data })
      return { path, stat: {}, etag: '' }
    },
  }
})

afterEach(() => {
  cleanup()
})

function renderDialog() {
  return render(
    <NewPresentationDialog
      open
      targetFolder="presentations"
      onOpenChange={onOpenChange}
      onCreated={onCreated}
    />,
  )
}

describe('NewPresentationDialog', () => {
  it('writes a blank deck at the typed name and opens it', async () => {
    renderDialog()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Quarterly review' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(writeCalls).toHaveLength(1))
    expect(writeCalls[0].path).toBe('presentations/Quarterly review.pptx')
    // A real .pptx is a zip — "PK" base64-encodes to a "UEs" prefix.
    expect(writeCalls[0].data.startsWith('UEs')).toBe(true)
    expect(onCreated).toHaveBeenCalledWith('presentations/Quarterly review.pptx')
  })

  it('dedupes against an existing file instead of overwriting it', async () => {
    existing.add('presentations/Untitled presentation.pptx')
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(writeCalls).toHaveLength(1))
    expect(writeCalls[0].path).toBe('presentations/Untitled presentation (1).pptx')
  })

  it('rejects a name containing a slash without writing', async () => {
    renderDialog()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'a/b' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('Name cannot contain "/"')).toBeInTheDocument()
    expect(writeCalls).toHaveLength(0)
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('offers every palette and builds with the selected one', async () => {
    renderDialog()

    for (const palette of DECK_PALETTES) {
      expect(screen.getByRole('button', { name: new RegExp(palette.name) })).toBeInTheDocument()
    }

    // The first palette starts selected; pick a different one and build with it.
    const second = DECK_PALETTES[1]
    const swatch = screen.getByRole('button', { name: new RegExp(second.name) })
    fireEvent.click(swatch)
    expect(swatch).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(writeCalls).toHaveLength(1))
  })

  it('has no AI generate affordance', () => {
    renderDialog()
    expect(screen.queryByText(/generate with ai/i)).toBeNull()
    expect(screen.queryByLabelText(/what should the deck cover/i)).toBeNull()
  })
})
