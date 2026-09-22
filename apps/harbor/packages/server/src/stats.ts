import { hostname } from 'node:os';
import type { ServerFrame } from '@rowboat/spaces-protocol';

// What one instance is carrying on the live face (2026-09-22). The hub is
// in-process, so a second instance partitions live delivery (AGENTS.md,
// "One instance"); these are the numbers that say when one stops being
// enough — long before Render's CPU graph does, because the whiteboard relay
// is frames, not compute. Counters only: no vendor, no dependency. Read them
// on GET /internal/stats (internal.ts) or in the once-a-minute log line.
// When a second instance arrives, the sink becomes an OpenTelemetry push and
// these counters feed it unchanged.

type Counts = { published: Record<string, number>; delivered: number };
const fresh = (): Counts => ({ published: {}, delivered: 0 });

export interface LiveStatsSnapshot {
  instance: { host: string; pid: number; startedAt: string; uptimeSeconds: number };
  live: { connections: number; subscriptions: number };
  /** Frames handed to the hub, by frame kind: the previous full window, and since boot. */
  published: { lastMinute: Record<string, number>; sinceBoot: Record<string, number> };
  /** Listener deliveries (one frame to five subscribers = five): the fan-out cost. */
  delivered: { lastMinute: number; sinceBoot: number };
}

export class LiveStats {
  private connections = 0;
  private subscriptions = 0;
  private window = fresh();
  private lastMinute = fresh();
  private total = fresh();
  private readonly startedAt = new Date();
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly opts: { log?: boolean; windowMs?: number } = {}) {
    this.timer = setInterval(() => this.rotate(), opts.windowMs ?? 60_000);
    this.timer.unref();
  }

  connectionOpened(): void {
    this.connections += 1;
  }
  connectionClosed(): void {
    this.connections -= 1;
  }
  subscribed(): void {
    this.subscriptions += 1;
  }
  unsubscribed(): void {
    this.subscriptions -= 1;
  }

  published(frame: ServerFrame, deliveries: number): void {
    for (const c of [this.window, this.total]) {
      c.published[frame.kind] = (c.published[frame.kind] ?? 0) + 1;
      c.delivered += deliveries;
    }
  }

  /** Close the window: what was `current` becomes `lastMinute`. The timer calls this once a minute. */
  rotate(): void {
    this.lastMinute = this.window;
    this.window = fresh();
    if (this.opts.log) console.log(this.line());
  }

  snapshot(): LiveStatsSnapshot {
    return {
      instance: {
        host: hostname(),
        pid: process.pid,
        startedAt: this.startedAt.toISOString(),
        uptimeSeconds: Math.round((Date.now() - this.startedAt.getTime()) / 1000),
      },
      live: { connections: this.connections, subscriptions: this.subscriptions },
      published: { lastMinute: { ...this.lastMinute.published }, sinceBoot: { ...this.total.published } },
      delivered: { lastMinute: this.lastMinute.delivered, sinceBoot: this.total.delivered },
    };
  }

  private line(): string {
    const kinds = Object.entries(this.lastMinute.published)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([kind, n]) => `${kind}=${n}`)
      .join(' ');
    return `[harbor] live connections=${this.connections} subscriptions=${this.subscriptions} published/min ${kinds || '-'} delivered/min=${this.lastMinute.delivered}`;
  }

  close(): void {
    clearInterval(this.timer);
  }
}
