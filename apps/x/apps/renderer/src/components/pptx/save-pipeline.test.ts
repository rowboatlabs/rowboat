import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSavePipeline } from './save-pipeline'

const DEBOUNCE = 100

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

/**
 * A pipeline over a mutable "document": `edit()` changes the state and
 * schedules, `gate` (when set) blocks the disk write mid-flight, `started` and
 * `writes` record what reached the writer and what completed.
 */
function harness() {
  let state = ''
  const started: string[] = []
  const writes: string[] = []
  const statuses: string[] = []
  const errors: unknown[] = []
  const gate: { current: Promise<void> | null } = { current: null }
  const failNext: { current: boolean } = { current: false }
  const pipeline = createSavePipeline({
    debounceMs: DEBOUNCE,
    hasEdits: () => state !== '',
    serialize: async () => state,
    write: async (data) => {
      started.push(data)
      if (gate.current) await gate.current
      if (failNext.current) {
        failNext.current = false
        throw new Error('disk unavailable')
      }
      writes.push(data)
    },
    onStatus: (s) => statuses.push(s),
    onError: (err) => errors.push(err),
  })
  const edit = (next: string): void => {
    state = next
    pipeline.scheduleSave()
  }
  return { pipeline, edit, started, writes, statuses, errors, gate, failNext }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('save pipeline generations', () => {
  it('AUDIT RACE: an edit during an in-flight save survives closing inside the debounce window', async () => {
    const h = harness()
    const block = deferred()
    h.gate.current = block.promise

    // Edit A; the debounce fires and save A starts, its write held in flight.
    h.edit('A')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(h.started).toEqual(['A'])
    expect(h.writes).toEqual([])

    // Edit B lands while A's write is still on the wire.
    h.edit('B')

    // Save A completes. With a boolean dirty flag this is where B's dirtiness
    // was wiped: A's completion cleared the flag B had set.
    h.gate.current = null
    block.resolve()

    // The file is closed BEFORE B's debounce fires. The flush must still
    // resolve only after B is on disk.
    await h.pipeline.flush()
    expect(h.writes).toEqual(['A', 'B'])
    expect(h.statuses[h.statuses.length - 1]).toBe('saved')
  })

  it('an edit after a fully completed save is flushed when closed inside the debounce window', async () => {
    const h = harness()
    h.edit('A')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(h.writes).toEqual(['A'])

    h.edit('B') // debounce armed, never fires
    await h.pipeline.flush()
    expect(h.writes).toEqual(['A', 'B'])
  })

  it('rapid edit/save/edit/close interleavings never lose the last edit', async () => {
    // Vary how much of the second debounce elapses before the close, with a
    // save of an older generation in flight the whole time.
    for (const elapsed of [0, DEBOUNCE / 2, DEBOUNCE, DEBOUNCE * 1.5]) {
      const h = harness()
      const block = deferred()
      h.gate.current = block.promise

      h.edit('1')
      await vi.advanceTimersByTimeAsync(DEBOUNCE) // save '1' starts, blocked
      h.edit('2')
      await vi.advanceTimersByTimeAsync(elapsed)
      h.edit('3')
      h.gate.current = null
      block.resolve()

      await h.pipeline.flush()
      expect(h.writes[h.writes.length - 1], `elapsed=${elapsed}`).toBe('3')
      expect(h.statuses[h.statuses.length - 1]).toBe('saved')
    }
  })

  it('skips the disk write when the serialized state is unchanged', async () => {
    const h = harness()
    h.edit('A')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(h.writes).toEqual(['A'])

    // An overlay-only change that serializes identically: dirty, but deduped.
    h.pipeline.markEdited()
    await h.pipeline.flush()
    expect(h.writes).toEqual(['A'])
    expect(h.statuses[h.statuses.length - 1]).toBe('saved')
  })

  it('a pristine document flushes to nothing and reports clean', async () => {
    const h = harness()
    await h.pipeline.persist()
    await h.pipeline.flush()
    expect(h.started).toEqual([])
    expect(h.statuses).toEqual(['clean'])
  })

  it('a failed write stays dirty and the flush retries it', async () => {
    const h = harness()
    h.failNext.current = true
    h.edit('A')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(h.writes).toEqual([])
    expect(h.errors).toHaveLength(1)
    expect(h.statuses[h.statuses.length - 1]).toBe('error')

    await h.pipeline.flush()
    expect(h.writes).toEqual(['A'])
    expect(h.statuses[h.statuses.length - 1]).toBe('saved')
  })
})

describe('idle / discard / settled (external-change support)', () => {
  it('isIdle tracks the armed debounce, the in-flight save, and the generations', async () => {
    const h = harness()
    expect(h.pipeline.isIdle()).toBe(true)

    h.edit('A')
    expect(h.pipeline.isIdle()).toBe(false) // debounce armed

    const block = deferred()
    h.gate.current = block.promise
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(h.pipeline.isIdle()).toBe(false) // write in flight

    h.gate.current = null
    block.resolve()
    await h.pipeline.flush()
    expect(h.pipeline.isIdle()).toBe(true)
  })

  // The editor's clean-reload decision. A debounced save that completes ON
  // ITS OWN (no flush) must leave the pipeline idle — the fired timer handle
  // was never cleared, so isIdle() stayed false for the rest of the session
  // after the first autosave and every assistant write raised the conflict
  // banner on an editor with nothing unsaved.
  it('isIdle is true again once the debounced save completes by itself (no flush)', async () => {
    const h = harness()
    h.edit('A')
    expect(h.pipeline.isIdle()).toBe(false)

    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(h.writes).toEqual(['A'])
    expect(h.statuses[h.statuses.length - 1]).toBe('saved')
    expect(h.pipeline.isIdle()).toBe(true)

    // And again after a second round — it is not a one-off.
    h.edit('B')
    expect(h.pipeline.isIdle()).toBe(false)
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(h.writes).toEqual(['A', 'B'])
    expect(h.pipeline.isIdle()).toBe(true)
  })

  it('discard abandons pending edits without ever writing', async () => {
    const h = harness()
    h.edit('A')
    expect(h.pipeline.isIdle()).toBe(false)

    h.pipeline.discard()
    expect(h.pipeline.isIdle()).toBe(true)
    expect(h.statuses[h.statuses.length - 1]).toBe('clean')

    await vi.advanceTimersByTimeAsync(DEBOUNCE * 10)
    await h.pipeline.flush()
    expect(h.started).toEqual([])
    expect(h.writes).toEqual([])
  })

  it('settled awaits an in-flight save without starting one', async () => {
    const h = harness()
    const block = deferred()
    h.gate.current = block.promise
    h.edit('A')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(h.started).toEqual(['A'])

    let settledDone = false
    const settledPromise = h.pipeline.settled().then(() => {
      settledDone = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(settledDone).toBe(false) // blocked behind the gated write

    h.gate.current = null
    block.resolve()
    await settledPromise
    expect(h.writes).toEqual(['A'])

    // And on an idle pipeline it resolves immediately, writing nothing.
    await h.pipeline.settled()
    expect(h.started).toEqual(['A'])
  })
})
