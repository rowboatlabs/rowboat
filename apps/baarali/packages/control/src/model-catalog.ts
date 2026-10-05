import { catalogOf, type Catalog } from './model-access.js';
import type { ControlStore } from './store.js';

/**
 * The model settings, read at most every 30 s: every model call needs them,
 * and a change from the console reaches the pickers within the minute. The
 * console clears it after a change, so its own preview is never stale.
 */
export class ModelCatalog {
  private cached: { at: number; catalog: Catalog } | null = null;

  constructor(
    private readonly store: ControlStore,
    private readonly now: () => number,
    private readonly ttlMs = 30_000,
  ) {}

  async get(): Promise<Catalog> {
    const now = this.now();
    if (this.cached && now - this.cached.at < this.ttlMs) return this.cached.catalog;
    const [plans, settings] = await Promise.all([this.store.plans(), this.store.modelSettings()]);
    const catalog = catalogOf(plans, settings);
    this.cached = { at: now, catalog };
    return catalog;
  }

  clear(): void {
    this.cached = null;
  }
}

/**
 * OpenRouter's whole model list, for the console (the apps get theirs
 * through /v1/llm/models). Kept 10 minutes: it changes a few times a week.
 */
export class UpstreamModels {
  private cached: { at: number; body: string; ids: Set<string> | null } | null = null;

  constructor(
    private readonly fetchUpstream: () => Promise<Response>,
    private readonly now: () => number,
    private readonly ttlMs = 10 * 60_000,
  ) {}

  async get(force = false): Promise<string> {
    const now = this.now();
    if (!force && this.cached && now - this.cached.at < this.ttlMs) return this.cached.body;
    const res = await this.fetchUpstream();
    if (!res.ok) throw new Error(`OpenRouter /models answered ${res.status}`);
    const body = await res.text();
    this.remember(body);
    return body;
  }

  /** A list read elsewhere (the apps' pickers, through the proxy): kept as if fetched here. */
  remember(body: string): void {
    this.cached = { at: this.now(), body, ids: null };
  }

  /**
   * The ids of the last list read, without asking OpenRouter: a chat call
   * never waits for it. null when none was read yet, so nothing is rerouted.
   */
  knownIds(): Set<string> | null {
    const cached = this.cached;
    if (!cached) return null;
    if (!cached.ids) {
      try {
        const parsed = JSON.parse(cached.body) as { data?: unknown };
        if (!Array.isArray(parsed.data)) return null;
        cached.ids = new Set(
          parsed.data.flatMap((m) => (m && typeof m === 'object' && typeof (m as { id?: unknown }).id === 'string' ? [(m as { id: string }).id] : [])),
        );
      } catch {
        return null;
      }
    }
    return cached.ids;
  }
}
