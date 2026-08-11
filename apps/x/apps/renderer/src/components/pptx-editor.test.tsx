import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { deck as deckShared } from '@x/shared'
import { synthesizeDeckFromOutline } from '@x/shared/dist/pptx/generate.js'
import { DECK_PALETTES } from '@x/shared/dist/pptx/new-deck.js'
import { UserMessageContext } from '@x/shared/dist/message.js'
import { getViewerType } from '@/lib/file-types'
import { PptxEditor } from './pptx-editor'

// Radix primitives in jsdom.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub
Element.prototype.scrollIntoView = () => {}
;(Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false

const PATH = 'decks/test.pptx'

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

async function deckBase64(slide2Heading: string): Promise<string> {
  const outline: deckShared.DeckOutline = {
    title: 'Alpha',
    suggestedPalette: 'navy',
    slides: [
      { layout: 'title', pattern: 'title', heading: 'Alpha' },
      { layout: 'title-body', pattern: 'bullets', heading: slide2Heading, bullets: ['one', 'two'] },
      { layout: 'title-body', pattern: 'bullets', heading: 'Gamma', bullets: ['three'] },
    ],
  }
  const { bytes } = await synthesizeDeckFromOutline(outline, DECK_PALETTES[0])
  return toBase64(bytes)
}

/**
 * The main process's file semantics in memory: etag derived from
 * (size, mtime), expectedEtag verified before anything changes.
 */
function makeDisk(initial: string) {
  const state = { content: initial, mtime: 1000, refusals: 0, writes: 0 }
  const etagOf = () => `${state.content.length}-${state.mtime}`
  const statOf = () => ({ kind: 'file', size: state.content.length, mtimeMs: state.mtime, ctimeMs: 0 })
  const handlers: Record<string, (args: unknown) => Promise<unknown>> = {
    'workspace:readFile': async () => ({
      path: PATH,
      encoding: 'base64',
      data: state.content,
      stat: statOf(),
      etag: etagOf(),
    }),
    'workspace:stat': async () => statOf(),
    'workspace:writeFile': async (args: unknown) => {
      const { data, opts } = args as { data: string; opts?: { expectedEtag?: string } }
      if (opts?.expectedEtag && opts.expectedEtag !== etagOf()) {
        state.refusals += 1
        throw new Error('File was modified (ETag mismatch)')
      }
      state.content = data
      state.mtime += 1
      state.writes += 1
      return { path: PATH, stat: statOf(), etag: etagOf() }
    },
  }
  return {
    state,
    handlers,
    externalWrite(next: string) {
      state.content = next
      state.mtime += 1
    },
  }
}

function installIpc(disk: ReturnType<typeof makeDisk>) {
  ;(window as unknown as { ipc: unknown }).ipc = {
    on: () => () => undefined,
    send: () => undefined,
    invoke: (channel: string, args: unknown) => {
      const handler = disk.handlers[channel]
      return handler ? handler(args) : Promise.reject(new Error(`no handler: ${channel}`))
    },
  }
}

function touchDeck(): void {
  window.dispatchEvent(new CustomEvent('rowboat:deck-touched', { detail: { path: PATH } }))
}

let v1: string
let v2: string

beforeEach(async () => {
  v1 = await deckBase64('Beta')
  v2 = await deckBase64('Delta')
})

afterEach(() => {
  cleanup()
})

describe('pptx editor / assistant write sync', () => {
  it('clean editor: reloads in place on deck-touched and preserves the selected slide', async () => {
    const disk = makeDisk(v1)
    installIpc(disk)
    render(<PptxEditor path={PATH} />)

    const card2 = await screen.findByRole('button', { name: 'Slide 2: Beta' })
    fireEvent.click(card2)
    expect(card2).toHaveAttribute('aria-current', 'true')

    disk.externalWrite(v2)
    touchDeck()

    // The reloaded deck renders (slide 2 now says Delta) with no banner...
    const reloaded = await screen.findByRole('button', { name: 'Slide 2: Delta' })
    expect(screen.queryByRole('alert')).toBeNull()
    // ...the same slide NUMBER stays selected...
    expect(reloaded).toHaveAttribute('aria-current', 'true')
    // ...and the reload wrote nothing back.
    expect(disk.state.content).toBe(v2)
  })

  it('dirty editor: banner instead of reload, and nothing writes until Reload is chosen', async () => {
    const disk = makeDisk(v1)
    installIpc(disk)
    render(<PptxEditor path={PATH} />)

    await screen.findByRole('button', { name: 'Slide 2: Beta' })
    const writesBefore = disk.state.writes

    // Dirty the editor through a real edit path (Add Slide arms the autosave).
    fireEvent.click(screen.getByRole('button', { name: 'Add slide' }))
    await screen.findByRole('button', { name: /^Slide 4/ })

    disk.externalWrite(v2)
    touchDeck()

    // The banner appears; the stale content is NOT reloaded over the edits.
    // (Add slide inserted after slide 1, so the local view shows Beta at 3.)
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'Slide 3: Beta' })).toBeInTheDocument()

    // The armed autosave debounce fires regardless — and the etag guard
    // refuses it. The assistant's bytes survive.
    await waitFor(() => expect(disk.state.refusals).toBeGreaterThan(0), { timeout: 3000 })
    expect(disk.state.content).toBe(v2)
    expect(disk.state.writes).toBe(writesBefore)

    // Explicit choice: Reload (discard) installs the assistant's version.
    fireEvent.click(screen.getByRole('button', { name: 'Reload (discard your unsaved changes)' }))
    await screen.findByRole('button', { name: 'Slide 2: Delta' })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Slide 4/ })).toBeNull()
    expect(disk.state.content).toBe(v2)
  })

  it('dirty editor: Keep mine overwrites once, then tracking resumes on the new state', async () => {
    const disk = makeDisk(v1)
    installIpc(disk)
    render(<PptxEditor path={PATH} />)

    await screen.findByRole('button', { name: 'Slide 2: Beta' })
    fireEvent.click(screen.getByRole('button', { name: 'Add slide' }))
    await screen.findByRole('button', { name: /^Slide 4/ })

    disk.externalWrite(v2)
    touchDeck()
    await screen.findByRole('alert')

    const writesBefore = disk.state.writes
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine (your next save overwrites)' }))

    // The editor's 4-slide version lands on disk; the banner clears.
    await waitFor(() => expect(disk.state.writes).toBeGreaterThan(writesBefore), { timeout: 3000 })
    expect(disk.state.content).not.toBe(v2)
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByRole('button', { name: /^Slide 4/ })).toBeInTheDocument()
  })
})

// What the assistant is told the user is looking at. The editor reports its
// visible slide via onSlideChange; App.tsx stamps that onto deckStateRef and
// buildMiddlePaneContext turns it into the deck-kind middle-pane payload. This
// exercises the real editor, the real getViewerType predicate and the real
// shared schema — only App's few lines of assembly are mirrored here.
describe('deck context reported to the host', () => {
  /** App.tsx's wiring: a path-stamped ref plus the deck branch's payload. */
  function host() {
    const deckStateRef: { current: { path: string; slideNumber: number; slideCount: number } | null } = {
      current: null,
    }
    const onSlideChange = (slideNumber: number, slideCount: number) => {
      deckStateRef.current = { path: PATH, slideNumber, slideCount }
    }
    const middlePaneContext = () => {
      if (getViewerType(PATH) !== 'pptx') return undefined
      const deck = deckStateRef.current
      if (!deck || deck.path !== PATH) return undefined
      return {
        kind: 'deck' as const,
        path: PATH,
        slideNumber: deck.slideNumber,
        slideCount: deck.slideCount,
      }
    }
    return { onSlideChange, middlePaneContext }
  }

  it('opening a pptx yields a deck-kind context on the first slide', async () => {
    const disk = makeDisk(v1)
    installIpc(disk)
    const h = host()
    render(<PptxEditor path={PATH} onSlideChange={h.onSlideChange} />)

    await screen.findByRole('button', { name: 'Slide 2: Beta' })

    const context = h.middlePaneContext()
    expect(context).toEqual({
      kind: 'deck',
      path: 'decks/test.pptx',
      slideNumber: 1,
      slideCount: 3,
    })
    // The payload must satisfy the wire schema the encoder reads.
    expect(UserMessageContext.safeParse({ middlePane: context }).success).toBe(true)
  })

  it('selecting another slide updates the reported slide number', async () => {
    const disk = makeDisk(v1)
    installIpc(disk)
    const h = host()
    render(<PptxEditor path={PATH} onSlideChange={h.onSlideChange} />)

    const card2 = await screen.findByRole('button', { name: 'Slide 2: Beta' })
    fireEvent.click(card2)
    await waitFor(() => expect(h.middlePaneContext()?.slideNumber).toBe(2))

    fireEvent.click(screen.getByRole('button', { name: 'Slide 3: Gamma' }))
    await waitFor(() => expect(h.middlePaneContext()?.slideNumber).toBe(3))
    expect(h.middlePaneContext()?.slideCount).toBe(3)
  })

  it('adding a slide updates the reported count', async () => {
    const disk = makeDisk(v1)
    installIpc(disk)
    const h = host()
    render(<PptxEditor path={PATH} onSlideChange={h.onSlideChange} />)

    await screen.findByRole('button', { name: 'Slide 2: Beta' })
    expect(h.middlePaneContext()?.slideCount).toBe(3)

    fireEvent.click(screen.getByRole('button', { name: 'Add slide' }))
    await screen.findByRole('button', { name: /^Slide 4/ })
    await waitFor(() => expect(h.middlePaneContext()?.slideCount).toBe(4))
  })

  it('is inert for a non-pptx path', () => {
    expect(getViewerType('knowledge/A.md')).not.toBe('pptx')
  })
})
