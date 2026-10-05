import type { ModelSetting } from './model-access.js';
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
  /** Set while the account is suspended from the admin console: its tokens open nothing. */
  suspendedAt?: number;
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

/** A ledger entry as its owner reads it: a charge names the model it paid for (03/10/2026). */
export interface MediaHistoryEntry {
  at: number;
  kind: MediaLedgerEntry['kind'];
  credits: number;
  /** The model of the generation a charge or a refund belongs to; null for a top-up. */
  model: string | null;
}

/**
 * Where an account's instance lives on Fly (architecture §3.5 « Instances »).
 * `managed`: created by the control plane, which also updates its image; the
 * owner's instance of phase 0 is deployed by hand and only reached.
 */
export interface InstanceRecord {
  accountId: string;
  app: string;
  /** null until the machine exists: a creation cut short resumes from what was saved. */
  machineId: string | null;
  volumeId: string | null;
  image: string | null;
  managed: boolean;
  /**
   * The generation of the keys the machine runs with (instances.ts KEYS):
   * the gateway relays with that generation's key until the machine moves
   * to the current one, at its next wake or connection.
   */
  keys: number;
}

/** One app install that may reach its owner's instance through the gateway (security §2). */
export interface Device {
  id: string;
  accountId: string;
  name: string;
  createdAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
}

/** One action taken from the admin console, kept for good (decided 03/10/2026). */
export interface AdminLogEntry {
  at: number;
  /** Who acted: the admin's email, or `token` for the operator token. */
  actor: string;
  action: string;
  accountId: string | null;
  /** What changed, in words the console shows as is. */
  detail: string;
}

/** An account as the admin console lists it. */
export interface AccountSummary {
  account: Account;
  quota: QuotaState | null;
  mediaBalance: number;
  /** The last model call, or null when there was none. */
  lastActiveAt: number | null;
  /** Credits the account's model calls cost since the `since` asked for. */
  recentCredits: number;
}

/**
 * Persistence seam. Phase 0 runs the in-memory store; the Postgres one, in
 * the `baarali` schema with its own migration ladder (UPSTREAM.md §2), comes
 * with the first multi-user deployment.
 */
export interface ControlStore {
  /** Every model the owner set up in the console (model-access.ts). */
  modelSettings(): Promise<ModelSetting[]>;
  /** Creates or replaces each one, in one go. */
  saveModelSettings(settings: ModelSetting[], at: number): Promise<void>;
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
  /** The account's latest ledger entries, newest first. */
  mediaHistory(accountId: string, limit: number): Promise<MediaHistoryEntry[]>;
  /** Lets `token` act as the account. Kept hashed only. */
  grantToken(token: string, accountId: string): Promise<void>;
  /** `token` no longer acts as anyone; nothing happens when it never did. */
  revokeToken(token: string): Promise<void>;
  /** The account a signed-in user acts as: the one linked to them, else the one they created. */
  accountForUser(userId: string): Promise<Account | null>;
  instance(accountId: string): Promise<InstanceRecord | null>;
  saveInstance(record: InstanceRecord): Promise<void>;
  /** Forgets an account's instance record (the machine itself is not touched). */
  removeInstance(accountId: string): Promise<void>;
  countInstances(): Promise<number>;
  /** `keyHash`: hashToken of the device key, which is never stored. */
  addDevice(device: Device, keyHash: string): Promise<void>;
  /** A device that is not revoked, by its key. */
  deviceByKey(key: string): Promise<Device | null>;
  devices(accountId: string): Promise<Device[]>;
  touchDevice(id: string, at: number): Promise<void>;
  /** Only the account's own device; false when there is none to revoke. */
  revokeDevice(accountId: string, id: string, at: number): Promise<boolean>;
  /** Every account, newest first, with `recentCredits` counted from `since`. */
  listAccounts(since: number): Promise<AccountSummary[]>;
  /** False when there is no such account. */
  setPlan(accountId: string, planId: string): Promise<boolean>;
  /** `at` suspends, null lifts it; false when there is no such account. */
  setSuspended(accountId: string, at: number | null): Promise<boolean>;
  allInstances(): Promise<InstanceRecord[]>;
  appendAdminLog(entry: AdminLogEntry): Promise<void>;
  /** Newest first; with `accountId`, that account's entries only. */
  adminLog(limit: number, accountId?: string): Promise<AdminLogEntry[]>;
}

export class MemoryStore implements ControlStore {
  readonly usage: UsageRecord[] = [];
  readonly ledger: MediaLedgerEntry[] = [];
  readonly log: AdminLogEntry[] = [];
  private readonly models = new Map<string, ModelSetting>();
  private readonly states = new Map<string, QuotaState>();
  private readonly jobs = new Map<string, MediaJob>();
  private readonly instances = new Map<string, InstanceRecord>();
  private readonly deviceList: Array<Device & { keyHash: string }> = [];

  private readonly tokens: Map<string, Account>;

  /** `tokens` maps a token HASH (hashToken) to its account; the accounts are copied, so a change stays here. */
  constructor(
    tokens: Map<string, Account>,
    private readonly catalog: Plan[],
  ) {
    const copies = new Map<string, Account>();
    this.tokens = new Map([...tokens].map(([hash, a]) => {
      const copy = copies.get(a.id) ?? { ...a };
      copies.set(a.id, copy);
      return [hash, copy];
    }));
  }

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
  async mediaHistory(accountId: string, limit: number): Promise<MediaHistoryEntry[]> {
    const modelOf = (ref: string) => [...this.jobs.values()].find((j) => j.chargeRef === ref)?.model ?? null;
    return this.ledger
      .filter((e) => e.accountId === accountId)
      .map((e, i) => ({ e, i }))
      .sort((a, b) => b.e.at - a.e.at || b.i - a.i)
      .slice(0, limit)
      .map(({ e }) => ({ at: e.at, kind: e.kind, credits: e.credits, model: e.kind === 'topup' ? null : modelOf(e.reference) }));
  }
  async grantToken(token: string, accountId: string) {
    const account = await this.account(accountId);
    if (account) this.tokens.set(hashToken(token), account);
  }
  async revokeToken(token: string) {
    this.tokens.delete(hashToken(token));
  }
  // In memory there is no sign-in server, hence no link: a user is their account.
  async accountForUser(userId: string) {
    return this.account(userId);
  }
  async instance(accountId: string) {
    const record = this.instances.get(accountId);
    return record ? { ...record } : null;
  }
  async saveInstance(record: InstanceRecord) {
    this.instances.set(record.accountId, { ...record });
  }
  async removeInstance(accountId: string) {
    this.instances.delete(accountId);
  }
  async countInstances() {
    return this.instances.size;
  }
  async addDevice(device: Device, keyHash: string) {
    this.deviceList.push({ ...device, keyHash });
  }
  async deviceByKey(key: string) {
    const found = this.deviceList.find((d) => d.keyHash === hashToken(key) && d.revokedAt === null);
    if (!found) return null;
    const { keyHash: _, ...device } = found;
    return device;
  }
  async devices(accountId: string) {
    return this.deviceList.filter((d) => d.accountId === accountId).map(({ keyHash: _, ...d }) => d);
  }
  async touchDevice(id: string, at: number) {
    const found = this.deviceList.find((d) => d.id === id);
    if (found) found.lastSeenAt = at;
  }
  async revokeDevice(accountId: string, id: string, at: number) {
    const found = this.deviceList.find((d) => d.id === id && d.accountId === accountId && d.revokedAt === null);
    if (!found) return false;
    found.revokedAt = at;
    return true;
  }
  /** One entry per account, though several tokens may point to it. */
  private accounts(): Account[] {
    const byId = new Map<string, Account>();
    for (const a of this.tokens.values()) if (!byId.has(a.id)) byId.set(a.id, a);
    return [...byId.values()];
  }
  async listAccounts(since: number): Promise<AccountSummary[]> {
    const summaries = await Promise.all(
      this.accounts().map(async (account) => {
        const calls = this.usage.filter((u) => u.accountId === account.id);
        return {
          account: { ...account },
          quota: this.states.get(account.id) ?? null,
          mediaBalance: await this.mediaBalance(account.id),
          lastActiveAt: calls.length ? Math.max(...calls.map((u) => u.at)) : null,
          recentCredits: calls.filter((u) => u.at >= since).reduce((sum, u) => sum + u.credits, 0),
        };
      }),
    );
    return summaries.sort((a, b) => b.account.createdAt - a.account.createdAt);
  }
  // Every token of the account sees the change: they share its record.
  private update(accountId: string, change: (a: Account) => void): boolean {
    let found = false;
    for (const a of this.tokens.values()) {
      if (a.id === accountId) {
        change(a);
        found = true;
      }
    }
    return found;
  }
  async setPlan(accountId: string, planId: string) {
    return this.update(accountId, (a) => {
      a.planId = planId;
    });
  }
  async setSuspended(accountId: string, at: number | null) {
    return this.update(accountId, (a) => {
      if (at === null) delete a.suspendedAt;
      else a.suspendedAt = at;
    });
  }
  async modelSettings() {
    return [...this.models.values()].map((s) => ({ ...s }));
  }
  async saveModelSettings(settings: ModelSetting[], _at?: number) {
    for (const s of settings) this.models.set(s.modelId, { ...s });
  }
  async allInstances() {
    return [...this.instances.values()].map((r) => ({ ...r }));
  }
  async appendAdminLog(entry: AdminLogEntry) {
    this.log.push({ ...entry });
  }
  async adminLog(limit: number, accountId?: string) {
    return this.log
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => accountId === undefined || e.accountId === accountId)
      .sort((a, b) => b.e.at - a.e.at || b.i - a.i)
      .slice(0, limit)
      .map(({ e }) => ({ ...e }));
  }
}
