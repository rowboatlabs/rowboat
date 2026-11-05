import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// What the worker keeps per conversation, on the machine it runs on (spec §8
// Connectors: a connector keeps a record per thread): the harness's session
// for the thread, and how far the thread was delivered into it, so the next
// turn resumes the session and tells it only what it has not heard. One JSON
// file, rewritten whole, replaced atomically.

export interface ThreadRecord {
  /** The harness's session for this conversation: Codex's thread id. */
  session?: string;
  /** The stream offset of the last message the session heard, or answered. */
  deliveredOffset?: number;
}

interface StateFile {
  version: 1;
  threads: Record<string, ThreadRecord>;
}

export class ThreadState {
  private readonly threads = new Map<string, ThreadRecord>();

  /** `file` undefined keeps everything in memory (tests, a one-off run). */
  constructor(private readonly file: string | undefined) {
    if (!file || !existsSync(file)) return;
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<StateFile>;
    for (const [key, record] of Object.entries(parsed.threads ?? {})) this.threads.set(key, { ...record });
  }

  static key(spaceId: string, threadRootId: string): string {
    return `${spaceId}/${threadRootId}`;
  }

  get(spaceId: string, threadRootId: string): ThreadRecord | undefined {
    const found = this.threads.get(ThreadState.key(spaceId, threadRootId));
    return found ? { ...found } : undefined;
  }

  put(spaceId: string, threadRootId: string, record: ThreadRecord): void {
    this.threads.set(ThreadState.key(spaceId, threadRootId), { ...this.get(spaceId, threadRootId), ...record });
    this.save();
  }

  /** Records from elsewhere (Harbor's own, at the switch to a worker) for conversations this file does not know yet. */
  seed(records: Record<string, ThreadRecord>): number {
    let added = 0;
    for (const [key, record] of Object.entries(records)) {
      if (this.threads.has(key)) continue;
      this.threads.set(key, { ...record });
      added += 1;
    }
    if (added > 0) this.save();
    return added;
  }

  private save(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const body: StateFile = { version: 1, threads: Object.fromEntries(this.threads) };
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(body, null, 2));
    renameSync(tmp, this.file);
  }
}
