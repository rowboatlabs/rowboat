import { createHash } from 'node:crypto';
import type { QuotaState } from './quota.js';

/** Tokens are kept hashed, so a memory dump or a log line never leaks one. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface Account {
  id: string;
  email: string | null;
  planId: string;
  createdAt: number;
}

export interface Plan {
  id: string;
  category: 'free' | 'starter' | 'pro';
  displayName: string;
  weekCredits: number;
}

/** One model call, as the control plane saw it (architecture §3.5, UsageRecord). */
export interface UsageRecord {
  accountId: string;
  at: number;
  path: string;
  model: string | null;
  status: number;
  credits: number;
  estimated: boolean;
  useCase: string | null;
  agentName: string | null;
}

/**
 * Persistence seam. Phase 0 runs the in-memory store; the Postgres one, in
 * the `warell` schema with its own migration ladder (UPSTREAM.md §2), comes
 * with the first multi-user deployment.
 */
export interface ControlStore {
  accountByToken(token: string): Promise<Account | null>;
  plan(planId: string): Promise<Plan | null>;
  plans(): Promise<Plan[]>;
  quotaState(accountId: string): Promise<QuotaState | null>;
  saveQuotaState(accountId: string, state: QuotaState): Promise<void>;
  appendUsage(record: UsageRecord): Promise<void>;
}

export class MemoryStore implements ControlStore {
  readonly usage: UsageRecord[] = [];
  private readonly states = new Map<string, QuotaState>();

  /** `tokens` maps a token HASH (hashToken) to its account. */
  constructor(
    private readonly tokens: Map<string, Account>,
    private readonly catalog: Plan[],
  ) {}

  async accountByToken(token: string) {
    return this.tokens.get(hashToken(token)) ?? null;
  }
  async plan(planId: string) {
    return this.catalog.find((p) => p.id === planId) ?? null;
  }
  async plans() {
    return this.catalog;
  }
  async quotaState(accountId: string) {
    return this.states.get(accountId) ?? null;
  }
  async saveQuotaState(accountId: string, state: QuotaState) {
    this.states.set(accountId, state);
  }
  async appendUsage(record: UsageRecord) {
    this.usage.push(record);
  }
}
