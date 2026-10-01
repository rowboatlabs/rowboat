import { createHash } from 'node:crypto';
import type { ModelPolicy } from './models.js';
import type { Money } from './pricing.js';
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
  monthlyPrices: Money[];
  /** null: any model, within the quota. */
  models: ModelPolicy | null;
}

/** One model call, as the control plane saw it (architecture §3.5, UsageRecord). */
export interface UsageRecord {
  accountId: string;
  at: number;
  path: string;
  /** The model sent to OpenRouter. */
  model: string | null;
  /** The model core asked for, when a plan policy replaced it. */
  requestedModel: string | null;
  status: number;
  credits: number;
  estimated: boolean;
  useCase: string | null;
  agentName: string | null;
}

/** One media generation, kept so its owner alone can follow it and a failure is refunded once. */
export interface MediaJob {
  /** Pixazo's request id. */
  id: string;
  accountId: string;
  model: string;
  /** Media credits charged (media.ts, MEDIA_CREDIT_USD). */
  credits: number;
  /** The ledger reference of its charge, reused by its refund. */
  chargeRef: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  url: string | null;
  refunded: boolean;
}

/** One change to an account's media credits; the balance is their sum (decided 01/10/2026). */
export interface MediaLedgerEntry {
  accountId: string;
  at: number;
  kind: 'topup' | 'charge' | 'refund';
  /** Positive for a top-up or a refund, negative for a charge. */
  credits: number;
  /** The payment of a top-up, the charge a refund gives back: each is applied once. */
  reference: string;
}

/**
 * `duplicate`: an entry of this kind and reference was applied already.
 * `insufficient`: it would take the balance below zero; nothing changed.
 */
export type LedgerResult = 'applied' | 'duplicate' | 'insufficient';

/**
 * Persistence seam. Phase 0 runs the in-memory store; the Postgres one, in
 * the `baarali` schema with its own migration ladder (UPSTREAM.md §2), comes
 * with the first multi-user deployment.
 */
export interface ControlStore {
  accountByToken(token: string): Promise<Account | null>;
  account(id: string): Promise<Account | null>;
  plan(planId: string): Promise<Plan | null>;
  plans(): Promise<Plan[]>;
  quotaState(accountId: string): Promise<QuotaState | null>;
  saveQuotaState(accountId: string, state: QuotaState): Promise<void>;
  appendUsage(record: UsageRecord): Promise<void>;
  mediaJob(id: string): Promise<MediaJob | null>;
  saveMediaJob(job: MediaJob): Promise<void>;
  mediaBalance(accountId: string): Promise<number>;
  /** Atomic: the balance check and the write happen together, so two charges never both spend the same credits. */
  applyMediaEntry(entry: MediaLedgerEntry): Promise<LedgerResult>;
}

export class MemoryStore implements ControlStore {
  readonly usage: UsageRecord[] = [];
  readonly ledger: MediaLedgerEntry[] = [];
  private readonly states = new Map<string, QuotaState>();
  private readonly jobs = new Map<string, MediaJob>();

  /** `tokens` maps a token HASH (hashToken) to its account. */
  constructor(
    private readonly tokens: Map<string, Account>,
    private readonly catalog: Plan[],
  ) {}

  async accountByToken(token: string) {
    return this.tokens.get(hashToken(token)) ?? null;
  }
  async account(id: string) {
    return [...this.tokens.values()].find((a) => a.id === id) ?? null;
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
  async mediaJob(id: string) {
    return this.jobs.get(id) ?? null;
  }
  async saveMediaJob(job: MediaJob) {
    this.jobs.set(job.id, job);
  }
  async mediaBalance(accountId: string) {
    return this.ledger.filter((e) => e.accountId === accountId).reduce((sum, e) => sum + e.credits, 0);
  }
  // No await between the check and the push: atomic on Node's single thread.
  async applyMediaEntry(entry: MediaLedgerEntry): Promise<LedgerResult> {
    if (this.ledger.some((e) => e.kind === entry.kind && e.reference === entry.reference)) return 'duplicate';
    const balance = this.ledger.filter((e) => e.accountId === entry.accountId).reduce((sum, e) => sum + e.credits, 0);
    if (balance + entry.credits < 0) return 'insufficient';
    this.ledger.push(entry);
    return 'applied';
  }
}
