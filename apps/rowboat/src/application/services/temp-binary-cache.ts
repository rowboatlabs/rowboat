import crypto from 'crypto';

type Entry = {
  buf: Buffer;
  mimeType: string;
  expiresAt: number; // epoch ms
};

class TempBinaryCache {
  private store = new Map<string, Entry>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanup();
  }

  private startCleanup() {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, entry] of this.store.entries()) {
        if (entry.expiresAt <= now) this.store.delete(id);
      }
    }, 60_000); // every minute
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  put(buf: Buffer, mimeType: string, ttlMs: number = 10 * 60 * 1000): string {
    const id = crypto.randomUUID();
    const expiresAt = Date.now() + ttlMs;
    this.store.set(id, { buf, mimeType, expiresAt });
    return id;
  }

  get(id: string): { buf: Buffer; mimeType: string } | undefined {
    const entry = this.store.get(id);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(id);
      return undefined;
    }
    return { buf: entry.buf, mimeType: entry.mimeType };
  }
}

export const tempBinaryCache = new TempBinaryCache();

