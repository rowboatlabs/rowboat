/**
 * External-change detection + transactional writes for ONE open deck file,
 * extracted from the editor component so the conflict interleavings are
 * testable (companion to save-pipeline.ts).
 *
 * The tracked state is a SNAPSHOT of the file as this editor instance last
 * read or wrote it (etag + size/mtime). Every write is transactional: it
 * carries the snapshot's etag as `expectedEtag`, which the main process
 * verifies UNDER THE FILE LOCK — so an assistant tool writing between our
 * read and our save can never be silently overwritten, no matter how the
 * events raced. There is no renderer-side check-then-write window.
 *
 * `checkExternal` is the cheap listener-side question "was that didChange /
 * deck-touched event our own write echoing back?": it compares a fresh stat
 * against the snapshot (size + mtime — the same identity the etag is built
 * from) without reading the file.
 */

export interface FileSnapshot {
  etag: string
  mtimeMs: number
  size: number
}

export interface DeckFileSyncOptions {
  /** Reads the whole file (base64) with its stat + etag. */
  read: () => Promise<{ data: string; etag: string; stat: { mtimeMs: number; size: number } }>
  /**
   * Writes the file. `expectedEtag === null` means unguarded (first write to
   * a file we never read, or an explicit keep-mine overwrite).
   */
  write: (
    data: string,
    expectedEtag: string | null,
  ) => Promise<{ etag: string; stat: { mtimeMs: number; size: number } }>
  /** Stats the file; null when it does not exist (or cannot be statted). */
  stat: () => Promise<{ mtimeMs: number; size: number } | null>
  /** The file changed underneath us and a write was refused. */
  onConflict: () => void
}

/** A guarded write was refused because the file changed outside this editor. */
export class ExternalChangeError extends Error {
  constructor() {
    super('The file was changed outside this editor')
    this.name = 'ExternalChangeError'
  }
}

/**
 * The main process refuses a stale expectedEtag with this marker. A file
 * that went MISSING under an expectedEtag carries the same marker (it is the
 * same conflict: the file is not the one we read), so it lands here too —
 * never as a raw ENOENT the editor could not recover from.
 */
function isEtagMismatch(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes('ETag mismatch')
}

export interface DeckFileSync {
  /** Reads the file and adopts its state as the snapshot (initial open). */
  load(): Promise<string>
  /**
   * Reads the file WITHOUT adopting its state. `adopt()` installs what was
   * read as the snapshot and returns true; until then every guarded write is
   * still keyed on the PREVIOUS snapshot. A reload that has to back out (an
   * edit started while the read was in flight) simply never adopts — so the
   * armed autosave, which would clobber the newly read bytes with stale-base
   * edits, is refused by the guard instead of sailing through on an etag it
   * never earned. `adopt()` returns false (and installs nothing) when one of
   * our own writes landed after the read: what was read is already stale.
   */
  read(): Promise<{ data: string; adopt: () => boolean }>
  /**
   * Writes with the snapshot's etag as the transactional guard. On an
   * external change: signals `onConflict` and throws ExternalChangeError,
   * leaving the file untouched.
   */
  guardedWrite(data: string): Promise<void>
  /**
   * Whether an external-change signal is about someone else's write:
   * 'self' — the file matches our snapshot (our own write echoing back);
   * 'external' — someone else wrote it; 'missing' — it is gone.
   */
  checkExternal(): Promise<'self' | 'external' | 'missing'>
  /**
   * Arms ONE unguarded write ("Keep mine"): the next guardedWrite skips the
   * etag check, then guarding resumes from that write's result. Stays armed
   * across failed attempts so a retry still overwrites.
   */
  keepMine(): void
  /** The current snapshot, for tests and diagnostics. */
  snapshot(): FileSnapshot | null
}

export function createDeckFileSync(opts: DeckFileSyncOptions): DeckFileSync {
  let snapshot: FileSnapshot | null = null
  let overrideNext = false
  /** Bumped by every successful write, so a pending read knows it went stale. */
  let writeSeq = 0

  const read = async (): Promise<{ data: string; adopt: () => boolean }> => {
    const seqAtRead = writeSeq
    const res = await opts.read()
    const next: FileSnapshot = { etag: res.etag, mtimeMs: res.stat.mtimeMs, size: res.stat.size }
    return {
      data: res.data,
      adopt: () => {
        if (writeSeq !== seqAtRead) return false
        snapshot = next
        overrideNext = false
        return true
      },
    }
  }

  return {
    async load() {
      const res = await read()
      res.adopt()
      return res.data
    },

    read,

    async guardedWrite(data: string) {
      const expected = overrideNext ? null : (snapshot?.etag ?? null)
      try {
        const res = await opts.write(data, expected)
        overrideNext = false
        writeSeq += 1
        snapshot = { etag: res.etag, mtimeMs: res.stat.mtimeMs, size: res.stat.size }
      } catch (err) {
        if (isEtagMismatch(err)) {
          opts.onConflict()
          throw new ExternalChangeError()
        }
        throw err
      }
    },

    async checkExternal() {
      let stat: { mtimeMs: number; size: number } | null
      try {
        stat = await opts.stat()
      } catch {
        stat = null
      }
      if (!stat) return 'missing'
      if (snapshot && stat.mtimeMs === snapshot.mtimeMs && stat.size === snapshot.size) {
        return 'self'
      }
      return 'external'
    },

    keepMine() {
      overrideNext = true
    },

    snapshot() {
      return snapshot
    },
  }
}
