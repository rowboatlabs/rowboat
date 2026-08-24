import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { deck as deckShared } from '@x/shared'
import { synthesizeDeckFromOutline } from '@x/shared/dist/pptx/generate.js'
import { DECK_PALETTES } from '@x/shared/dist/pptx/new-deck.js'
import { UserMessageContext } from '@x/shared/dist/message.js'
import { getViewerType } from '@/lib/file-types'
import { PptxEditor } from './pptx-editor'

// The editor announces failures through sonner; the conflict paths must NOT
// (the banner owns that conversation), so the toast surface is observed.
const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}))
vi.mock('sonner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sonner')>()
  return { ...actual, toast: Object.assign(vi.fn(), toastMock) }
})

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
  // `content === null` is a deleted file. `readGate` holds readFile open so a
  // test can interleave an edit with an in-flight reload.
  const state = {
    content: initial as string | null,
    mtime: 1000,
    refusals: 0,
    writes: 0,
    readGate: null as Promise<void> | null,
  }
  const enoent = () => Object.assign(new Error(`ENOENT: no such file or directory, lstat '${PATH}'`), { code: 'ENOENT' })
  const etagOf = () => `${state.content?.length ?? 0}-${state.mtime}`
  const statOf = () => {
    if (state.content === null) throw enoent()
    return { kind: 'file', size: state.content.length, mtimeMs: state.mtime, ctimeMs: 0 }
  }
  const handlers: Record<string, (args: unknown) => Promise<unknown>> = {
    'workspace:readFile': async () => {
      if (state.readGate) await state.readGate
      if (state.content === null) throw enoent()
      return { path: PATH, encoding: 'base64', data: state.content, stat: statOf(), etag: etagOf() }
    },
    'workspace:stat': async () => statOf(),
    'workspace:writeFile': async (args: unknown) => {
      const { data, opts } = args as { data: string; opts?: { expectedEtag?: string } }
      if (opts?.expectedEtag) {
        // The main-process guard (core filesystem/etag.ts): a missing file
        // under an expectedEtag is the SAME typed mismatch as a changed one.
        if (state.content === null) {
          state.refusals += 1
          throw new Error('File no longer exists (ETag mismatch)')
        }
        if (opts.expectedEtag !== etagOf()) {
          state.refusals += 1
          throw new Error('File was modified (ETag mismatch)')
        }
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
    /** Deletes the file out from under the editor (Finder, git, file-remove). */
    delete() {
      state.content = null
    },
    /** Holds every readFile until the returned release() is called. */
    holdReads(): () => void {
      let release!: () => void
      state.readGate = new Promise<void>((resolve) => {
        release = resolve
      })
      return () => {
        state.readGate = null
        release()
      }
    },
  }
}

type IpcListener = (event: unknown) => void

function installIpc(disk: ReturnType<typeof makeDisk>) {
  const listeners = new Map<string, Set<IpcListener>>()
  ;(window as unknown as { ipc: unknown }).ipc = {
    on: (channel: string, cb: IpcListener) => {
      const set = listeners.get(channel) ?? new Set<IpcListener>()
      set.add(cb)
      listeners.set(channel, set)
      return () => set.delete(cb)
    },
    send: () => undefined,
    invoke: (channel: string, args: unknown) => {
      const handler = disk.handlers[channel]
      return handler ? handler(args) : Promise.reject(new Error(`no handler: ${channel}`))
    },
  }
  return {
    /** Fires a main-process push event (e.g. workspace:didChange) at the editor. */
    emit(channel: string, event: unknown) {
      for (const cb of listeners.get(channel) ?? []) cb(event)
    },
  }
}

function touchDeck(): void {
  window.dispatchEvent(new CustomEvent('rowboat:deck-touched', { detail: { path: PATH } }))
}

/** Opens the palette picker and returns the palette buttons it shows. */
async function openPalettePicker() {
  const trigger = screen.getByRole('button', { name: 'Change theme' })
  await waitFor(() => expect(trigger).not.toBeDisabled())
  fireEvent.click(trigger)
  const heading = await screen.findByText('Theme')
  const grid = heading.parentElement!
  return {
    palette: (name: string) => within(grid).getByRole('button', { name }),
    close: () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }),
  }
}

let v1: string
let v2: string
let v3: string

beforeEach(async () => {
  v1 = await deckBase64('Beta')
  v2 = await deckBase64('Delta')
  v3 = await deckBase64('Epsilon')
  toastMock.error.mockClear()
  toastMock.info.mockClear()
  toastMock.success.mockClear()
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

  // End-to-end on a CLEAN editor, through the realistic sequence: the editor
  // has SAVED once (so its snapshot is a write result, not the initial read),
  // its own write echoes back as a signal (classified 'self', nothing
  // happens), and then an assistant write arrives through BOTH signal paths
  // the app uses — the rowboat:deck-touched window event and the
  // workspace:didChange IPC push. Each must reload in place.
  it('clean editor after its own save: echo is ignored, an assistant write reloads via deck-touched AND didChange', async () => {
    const disk = makeDisk(v1)
    const ipc = installIpc(disk)
    render(<PptxEditor path={PATH} />)
    await screen.findByRole('button', { name: 'Slide 2: Beta' })

    // An edit the editor saves itself: snapshot now comes from the write.
    fireEvent.click(screen.getByRole('button', { name: 'Add slide' }))
    await screen.findByRole('button', { name: /^Slide 4/ })
    await waitFor(() => expect(disk.state.writes).toBe(1), { timeout: 3000 })
    const savedContent = disk.state.content

    // Our own write echoing back: classified 'self' — no reload, no banner.
    touchDeck()
    ipc.emit('workspace:didChange', { type: 'changed', path: PATH })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: /^Slide 4/ })).toBeInTheDocument()
    expect(disk.state.content).toBe(savedContent)

    // The assistant writes → deck-touched → the editor reloads in place.
    disk.externalWrite(v2)
    touchDeck()
    await screen.findByRole('button', { name: 'Slide 2: Delta' }, { timeout: 3000 })
    expect(screen.queryByRole('button', { name: /^Slide 4/ })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(disk.state.content).toBe(v2)

    // And again through the watcher's IPC event — fired while the previous
    // reload may still be finishing, which must coalesce, not drop.
    disk.externalWrite(v3)
    ipc.emit('workspace:didChange', { type: 'changed', path: PATH })
    await screen.findByRole('button', { name: 'Slide 2: Epsilon' }, { timeout: 3000 })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(disk.state.content).toBe(v3)
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  // ITEM 2: an edit that starts while the reload's read is in flight. The
  // reload backs out (banner) — and the autosave that edit armed must be
  // REFUSED. Adopting the new etag before the idle check handed that autosave
  // a valid etag, so it overwrote the assistant's bytes with stale-base edits.
  it('edit during the reload read: banner, and the armed autosave does NOT write', async () => {
    const disk = makeDisk(v1)
    installIpc(disk)
    render(<PptxEditor path={PATH} />)
    await screen.findByRole('button', { name: 'Slide 2: Beta' })
    const writesBefore = disk.state.writes

    // Assistant write + signal on a clean editor → reload starts, read held.
    const release = disk.holdReads()
    disk.externalWrite(v2)
    touchDeck()
    await new Promise((r) => setTimeout(r, 20))

    // The user edits while the read is pending (arms the autosave).
    fireEvent.click(screen.getByRole('button', { name: 'Add slide' }))
    await screen.findByRole('button', { name: /^Slide 4/ })
    release()

    // Reload backs out: banner, the local view keeps the edit...
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: /^Slide 4/ })).toBeInTheDocument()
    // ...and the armed autosave is refused by the guard: the assistant's
    // bytes survive, nothing was written.
    await waitFor(() => expect(disk.state.refusals).toBeGreaterThan(0), { timeout: 3000 })
    expect(disk.state.writes).toBe(writesBefore)
    expect(disk.state.content).toBe(v2)
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  // ITEM 3: the open deck is deleted. The next save must take the CONFLICT
  // path (banner), not fail forever with a raw ENOENT; Reload reports the
  // file is gone and offers to recreate it; no toasts anywhere.
  it('deleted file: next save → conflict banner; Reload reports it gone and Recreate brings it back', async () => {
    const disk = makeDisk(v1)
    installIpc(disk)
    render(<PptxEditor path={PATH} />)
    await screen.findByRole('button', { name: 'Slide 2: Beta' })

    disk.delete()
    // An edit → the autosave is refused as a conflict → banner, no toast.
    fireEvent.click(screen.getByRole('button', { name: 'Add slide' }))
    await screen.findByRole('button', { name: /^Slide 4/ })
    const banner = await screen.findByRole('alert', {}, { timeout: 3000 })
    expect(banner).toHaveTextContent('This file was changed by the assistant.')
    expect(disk.state.refusals).toBeGreaterThan(0)
    expect(disk.state.content).toBeNull()
    expect(toastMock.error).not.toHaveBeenCalled()

    // Reload finds no file: it says so and offers to recreate (still no toast).
    fireEvent.click(screen.getByRole('button', { name: 'Reload (discard your unsaved changes)' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('no longer exists on disk'))
    expect(toastMock.error).not.toHaveBeenCalled()
    // The local edits are still on screen.
    expect(screen.getByRole('button', { name: /^Slide 4/ })).toBeInTheDocument()

    // Recreate writes the editor's state unguarded; guarding then resumes.
    const writesBefore = disk.state.writes
    fireEvent.click(screen.getByRole('button', { name: 'Recreate it from your edits' }))
    await waitFor(() => expect(disk.state.writes).toBeGreaterThan(writesBefore), { timeout: 3000 })
    expect(disk.state.content).not.toBeNull()
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByRole('button', { name: /^Slide 4/ })).toBeInTheDocument()

    // Saving works again: another edit lands on the recreated file.
    const refusalsBefore = disk.state.refusals
    fireEvent.click(screen.getByRole('button', { name: 'Add slide' }))
    await screen.findByRole('button', { name: /^Slide 5/ })
    await waitFor(() => expect(disk.state.writes).toBeGreaterThan(writesBefore + 1), { timeout: 3000 })
    expect(disk.state.refusals).toBe(refusalsBefore)
    expect(toastMock.error).not.toHaveBeenCalled()
  })
})

// Theme changes write the whole deck through the same guard. The on-screen
// theme must follow the FILE: persist first, then swap in memory and record
// history. Mutating the in-memory theme before the write left the screen
// restyled while the file was not, with no history entry to undo it.
describe('pptx editor / theme changes under external change', () => {
  it('ITEM 6: a refused theme write shows the banner and leaves the on-screen theme (and history) unchanged', async () => {
    const disk = makeDisk(v1)
    installIpc(disk)
    render(<PptxEditor path={PATH} />)
    await screen.findByRole('button', { name: 'Slide 2: Beta' })
    expect(screen.getByRole('button', { name: 'Undo (⌘Z)' })).toBeDisabled()

    // The assistant wrote; the editor has not heard about it yet.
    disk.externalWrite(v2)

    const picker = await openPalettePicker()
    expect(picker.palette('Navy')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(picker.palette('Sunset'))

    // The guarded write is refused → banner; nothing written over v2.
    await screen.findByRole('alert')
    expect(disk.state.content).toBe(v2)
    expect(disk.state.refusals).toBeGreaterThan(0)
    expect(toastMock.error).not.toHaveBeenCalled()
    // The on-screen theme did not move, and nothing was pushed onto history.
    const again = await openPalettePicker()
    expect(again.palette('Navy')).toHaveAttribute('aria-pressed', 'true')
    expect(again.palette('Sunset')).toHaveAttribute('aria-pressed', 'false')
    again.close()
    expect(screen.getByRole('button', { name: 'Undo (⌘Z)' })).toBeDisabled()
  })

  it('ITEM 7: a refused theme UNDO shows the banner and leaves the history index and theme where they were', async () => {
    const disk = makeDisk(v1)
    installIpc(disk)
    render(<PptxEditor path={PATH} />)
    await screen.findByRole('button', { name: 'Slide 2: Beta' })

    // A successful theme change: written, undoable.
    const picker = await openPalettePicker()
    fireEvent.click(picker.palette('Sunset'))
    await waitFor(() => expect(disk.state.writes).toBe(1), { timeout: 3000 })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo (⌘Z)' })).not.toBeDisabled())
    const restyled = disk.state.content
    expect(restyled).not.toBe(v1)
    const check = await openPalettePicker()
    expect(check.palette('Sunset')).toHaveAttribute('aria-pressed', 'true')
    check.close()

    // The assistant writes underneath; then the user hits Undo.
    disk.externalWrite(v2)
    const undoButton = screen.getByRole('button', { name: 'Undo (⌘Z)' })
    await waitFor(() => expect(undoButton).not.toBeDisabled())
    fireEvent.click(undoButton)

    // Refused → banner; the file keeps the assistant's bytes...
    await screen.findByRole('alert')
    expect(disk.state.content).toBe(v2)
    expect(toastMock.error).not.toHaveBeenCalled()
    // ...the history index did not move (Undo still available, no Redo)...
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo (⌘Z)' })).not.toBeDisabled())
    expect(screen.getByRole('button', { name: 'Redo (⇧⌘Z)' })).toBeDisabled()
    // ...and the on-screen theme is still the one the file last held.
    const after = await openPalettePicker()
    expect(after.palette('Sunset')).toHaveAttribute('aria-pressed', 'true')
    expect(after.palette('Navy')).toHaveAttribute('aria-pressed', 'false')
    after.close()
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
