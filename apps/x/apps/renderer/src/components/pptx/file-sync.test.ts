import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExternalChangeError, createDeckFileSync, type DeckFileSyncOptions } from './file-sync'
import { createSavePipeline } from './save-pipeline'

/**
 * An in-memory file with the main process's write semantics: etag derived
 * from (size, mtime), `expectedEtag` verified before the bytes change — the
 * same refusal message workspace:writeFile produces (wrapped the way an IPC
 * rejection arrives). `externalWrite` is the assistant tool.
 */
function makeDisk(initial: string) {
  let content = initial
  let mtime = 1000
  let missing = false
  let failNextWrite: string | null = null
  const etagOf = () => `${content.length}-${mtime}`
  const statOf = () => ({ mtimeMs: mtime, size: content.length })
  const conflicts: number[] = []
  const options: DeckFileSyncOptions = {
    read: async () => {
      if (missing) throw new Error('ENOENT')
      return { data: content, etag: etagOf(), stat: statOf() }
    },
    write: async (data, expectedEtag) => {
      if (failNextWrite !== null) {
        const message = failNextWrite
        failNextWrite = null
        throw new Error(message)
      }
      if (expectedEtag !== null && expectedEtag !== etagOf()) {
        throw new Error(
          "Error invoking remote method 'workspace:writeFile': Error: File was modified (ETag mismatch)",
        )
      }
      content = data
      mtime += 1
      return { etag: etagOf(), stat: statOf() }
    },
    stat: async () => (missing ? null : statOf()),
    onConflict: () => {
      conflicts.push(1)
    },
  }
  return {
    options,
    conflicts,
    externalWrite(next: string) {
      content = next
      mtime += 1
    },
    setMissing(next: boolean) {
      missing = next
    },
    failNext(message: string) {
      failNextWrite = message
    },
    get content() {
      return content
    },
  }
}

describe('deck file sync', () => {
  it('load adopts the disk snapshot and returns the data', async () => {
    const disk = makeDisk('original')
    const sync = createDeckFileSync(disk.options)

    await expect(sync.load()).resolves.toBe('original')
    expect(sync.snapshot()).not.toBeNull()
    await expect(sync.checkExternal()).resolves.toBe('self')
  })

  it('AUDIT DATA LOSS: a guarded write after an external change aborts and keeps the external bytes', async () => {
    const disk = makeDisk('original')
    const sync = createDeckFileSync(disk.options)
    await sync.load()

    disk.externalWrite('assistant version')

    await expect(sync.guardedWrite('editor version')).rejects.toBeInstanceOf(ExternalChangeError)
    expect(disk.content).toBe('assistant version')
    expect(disk.conflicts).toHaveLength(1)
  })

  it('writes again after a reload has adopted the external state', async () => {
    const disk = makeDisk('original')
    const sync = createDeckFileSync(disk.options)
    await sync.load()
    disk.externalWrite('assistant version')
    await expect(sync.guardedWrite('editor version')).rejects.toBeInstanceOf(ExternalChangeError)

    // Reload: re-read the file, then the editor's next save goes through.
    await expect(sync.load()).resolves.toBe('assistant version')
    await sync.guardedWrite('edited after reload')
    expect(disk.content).toBe('edited after reload')
  })

  it('keepMine arms exactly one overwrite, then guarding resumes', async () => {
    const disk = makeDisk('original')
    const sync = createDeckFileSync(disk.options)
    await sync.load()
    disk.externalWrite('assistant version')

    sync.keepMine()
    await sync.guardedWrite('editor version')
    expect(disk.content).toBe('editor version')

    // A later external change is refused again — the override was one-shot.
    disk.externalWrite('assistant again')
    await expect(sync.guardedWrite('editor again')).rejects.toBeInstanceOf(ExternalChangeError)
    expect(disk.content).toBe('assistant again')
  })

  it('keepMine survives an unrelated write failure so the retry still overwrites', async () => {
    const disk = makeDisk('original')
    const sync = createDeckFileSync(disk.options)
    await sync.load()
    disk.externalWrite('assistant version')

    sync.keepMine()
    disk.failNext('disk unavailable')
    await expect(sync.guardedWrite('editor version')).rejects.toThrow('disk unavailable')
    expect(disk.conflicts).toHaveLength(0)

    await sync.guardedWrite('editor version')
    expect(disk.content).toBe('editor version')
  })

  // The reload path reads WITHOUT adopting and adopts only once it knows it
  // will go through. Adopting first (what load() does) handed the armed
  // autosave the NEW etag: the back-out then left an edit pending whose save
  // passed the guard and overwrote the assistant's bytes with stale-base edits.
  it('read() leaves the snapshot alone until adopt(); a guarded write in between is still keyed on the old etag', async () => {
    const disk = makeDisk('original')
    const sync = createDeckFileSync(disk.options)
    await sync.load()
    const before = sync.snapshot()

    disk.externalWrite('assistant version')
    const pending = await sync.read()
    expect(pending.data).toBe('assistant version')
    // Not adopted: the snapshot is still the pre-read one...
    expect(sync.snapshot()).toEqual(before)
    // ...so the guard refuses a write keyed on it (the back-out path).
    await expect(sync.guardedWrite('editor edit')).rejects.toBeInstanceOf(ExternalChangeError)
    expect(disk.content).toBe('assistant version')
    expect(disk.conflicts).toHaveLength(1)

    // Adopting installs what was read; writes now go through.
    expect(pending.adopt()).toBe(true)
    expect(sync.snapshot()).not.toEqual(before)
    await expect(sync.checkExternal()).resolves.toBe('self')
    await sync.guardedWrite('editor edit')
    expect(disk.content).toBe('editor edit')
  })

  it('adopt() refuses when one of our own writes landed during the read', async () => {
    const disk = makeDisk('original')
    const sync = createDeckFileSync(disk.options)
    await sync.load()

    const pending = await sync.read()
    await sync.guardedWrite('written after the read began')
    const afterWrite = sync.snapshot()

    // What was read is stale now: adopting it would key later writes on a
    // dead etag and re-install pre-write bytes as the base.
    expect(pending.adopt()).toBe(false)
    expect(sync.snapshot()).toEqual(afterWrite)
    await expect(sync.checkExternal()).resolves.toBe('self')
  })

  it('checkExternal tells own writes from foreign ones without reading the file', async () => {
    const disk = makeDisk('original')
    const sync = createDeckFileSync(disk.options)
    await sync.load()

    await sync.guardedWrite('saved by us')
    await expect(sync.checkExternal()).resolves.toBe('self')

    disk.externalWrite('foreign')
    await expect(sync.checkExternal()).resolves.toBe('external')

    disk.setMissing(true)
    await expect(sync.checkExternal()).resolves.toBe('missing')
  })
})

// ---------------------------------------------------------------------------
// The real wiring, minus React: the debounced autosave writes through the
// guarded sync, exactly as the editor composes them.

const DEBOUNCE = 100

function editorHarness(disk: ReturnType<typeof makeDisk>) {
  const sync = createDeckFileSync(disk.options)
  let state = ''
  const errors: unknown[] = []
  const pipeline = createSavePipeline({
    debounceMs: DEBOUNCE,
    hasEdits: () => state !== '',
    serialize: async () => state,
    write: (data) => sync.guardedWrite(data),
    onStatus: () => {},
    onError: (err) => errors.push(err),
  })
  const edit = (next: string): void => {
    state = next
    pipeline.scheduleSave()
  }
  const reset = (): void => {
    state = ''
  }
  return { sync, pipeline, edit, reset, errors }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('autosave under external change (pipeline + sync)', () => {
  it('AUDIT DATA LOSS: the debounced autosave never overwrites an assistant write', async () => {
    const disk = makeDisk('original')
    const h = editorHarness(disk)
    await h.sync.load()

    h.edit('editor v1')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(disk.content).toBe('editor v1')

    disk.externalWrite('assistant version')
    h.edit('editor v2')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)

    expect(disk.content).toBe('assistant version')
    expect(disk.conflicts.length).toBeGreaterThan(0)
    expect(h.errors.some((e) => e instanceof ExternalChangeError)).toBe(true)
  })

  it('the unmount flush is guarded too', async () => {
    const disk = makeDisk('original')
    const h = editorHarness(disk)
    await h.sync.load()

    disk.externalWrite('assistant version')
    h.edit('editor v1')
    await h.pipeline.flush()

    expect(disk.content).toBe('assistant version')
    expect(disk.conflicts.length).toBeGreaterThan(0)
  })

  it('the dirty path writes nothing until an explicit choice is made', async () => {
    const disk = makeDisk('original')
    const h = editorHarness(disk)
    await h.sync.load()

    disk.externalWrite('assistant version')
    h.edit('editor v1')

    // The debounce fires, the guard refuses; later retries refuse the same
    // way. At no point does the editor's content reach the file.
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    h.edit('editor v2')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(disk.content).toBe('assistant version')

    // Explicit choice #1 — Reload (discard): nothing pending writes anymore.
    h.pipeline.discard()
    await h.pipeline.settled()
    h.pipeline.discard()
    h.reset()
    await h.sync.load()
    expect(h.pipeline.isIdle()).toBe(true)
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 10)
    expect(disk.content).toBe('assistant version')

    // New edits after the reload write cleanly against the adopted state.
    h.edit('edited after reload')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(disk.content).toBe('edited after reload')
  })

  it('explicit choice #2 — keep mine: one persist overwrites, tracking resumes', async () => {
    const disk = makeDisk('original')
    const h = editorHarness(disk)
    await h.sync.load()

    disk.externalWrite('assistant version')
    h.edit('editor v1')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(disk.content).toBe('assistant version')

    h.sync.keepMine()
    await h.pipeline.persist()
    expect(disk.content).toBe('editor v1')

    // Guarding resumes from the overwrite's result.
    disk.externalWrite('assistant again')
    h.edit('editor v2')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(disk.content).toBe('assistant again')
  })
})
