/**
 * The editor's debounced autosave, extracted from the component so the
 * edit → save → edit → close interleavings are testable.
 *
 * Dirty tracking is GENERATION-based. Every edit bumps `editGen`; a save
 * records the generation it serialized and marks it covered on completion.
 * "Dirty" is derived (`editGen !== savedGen`), so a completing save can never
 * clear dirtiness for an edit that arrived after it began — the race a boolean
 * flag had: save A completes, clears the flag B had set, the file is closed
 * inside the debounce window, and the unmount flush skips. B was never
 * written anywhere while the UI said "Saved".
 */

import type { SaveStatus } from './toolbar'

export interface SavePipelineOptions {
  debounceMs: number
  /** True when the current edit state differs from the original document. */
  hasEdits: () => boolean
  /** Serializes the CURRENT edit state to its canonical written form. */
  serialize: () => Promise<string>
  /** Writes one serialized state to disk. */
  write: (data: string) => Promise<void>
  onStatus: (status: SaveStatus) => void
  onError: (err: unknown) => void
}

export interface SavePipeline {
  /** Records an edit that must eventually reach disk, without scheduling. */
  markEdited(): void
  /** Records an edit and (re)arms the debounced save. */
  scheduleSave(): void
  /** Saves now. Deduped: during a save this returns the in-flight promise. */
  persist(): Promise<void>
  /**
   * Unmount / path change: cancels the debounce and resolves only once every
   * edit made before this call is covered — awaiting an in-flight save first.
   */
  flush(): Promise<void>
  /**
   * True when everything the user did is on disk: no armed debounce, no save
   * in flight, no generation behind. The external-change reload asks this —
   * an idle pipeline means a reload from disk loses nothing.
   */
  isIdle(): boolean
  /**
   * Abandons every pending edit WITHOUT writing — the explicit "discard my
   * unsaved changes" path of an external-change reload. The caller owns
   * resetting its edit state; from here on the pipeline behaves as freshly
   * created. An in-flight save is not interrupted (its guarded write decides
   * its own fate); its completion no longer marks anything covered.
   */
  discard(): void
  /**
   * Resolves once any in-flight save has finished (successfully or not),
   * WITHOUT starting one — unlike flush(). Never rejects.
   */
  settled(): Promise<void>
}

export function createSavePipeline(opts: SavePipelineOptions): SavePipeline {
  let editGen = 0
  let savedGen = 0
  let lastWritten: string | null = null
  let inFlight: Promise<void> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  async function run(): Promise<void> {
    try {
      // Loop until the newest generation is covered: an edit landing while a
      // write is in flight is picked up immediately, never left to a debounce
      // timer that an unmount would clear. This is also what lets flush()
      // simply await the in-flight save — it cannot resolve while behind.
      for (;;) {
        const gen = editGen
        if (gen === savedGen) break
        // Nothing to write only while nothing was ever written: undoing back
        // to a clean document after a save must restore the original bytes.
        if (opts.hasEdits() || lastWritten !== null) {
          const data = await opts.serialize()
          if (data !== lastWritten) {
            await opts.write(data)
            lastWritten = data
          }
        }
        savedGen = gen
      }
      opts.onStatus(lastWritten === null ? 'clean' : 'saved')
    } catch (err) {
      // savedGen stays behind, so the next edit, persist() or flush() retries.
      opts.onError(err)
      opts.onStatus('error')
    }
  }

  const persist = (): Promise<void> => {
    if (inFlight === null) {
      inFlight = run().finally(() => {
        inFlight = null
      })
    }
    return inFlight
  }

  return {
    markEdited() {
      editGen += 1
    },
    scheduleSave() {
      editGen += 1
      opts.onStatus('saving')
      clearTimer()
      timer = setTimeout(() => {
        void persist()
      }, opts.debounceMs)
    },
    persist,
    async flush() {
      clearTimer()
      if (inFlight !== null || editGen !== savedGen) await persist()
    },
    isIdle() {
      return timer === null && inFlight === null && editGen === savedGen
    },
    discard() {
      clearTimer()
      savedGen = editGen
      lastWritten = null
      opts.onStatus('clean')
    },
    settled() {
      return inFlight ?? Promise.resolve()
    },
  }
}
