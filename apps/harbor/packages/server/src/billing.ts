// Billing for managed agents (2026-11-04, "billing" in Main): an agent Rowboat
// hosts bills to its owner's Rowboat account, the one the desktop app bills
// to, in rowboatx-backend (spec §4: the control plane owns plans and
// payment). Harbor only reports and asks; the account, its plan, its credits
// and the free plan's one-agent limit are the backend's. Harbor calls its
// internal routes on the operator's key:
//
// - an agent is registered under its owner when created, and unregistered
//   when deleted; the backend refuses a registration past the plan's limit;
// - a Hermes calls the model through the backend's LLM gateway on a key the
//   backend mints for the owner and the agent, so model calls are settled
//   per call like the desktop app's;
// - the machine's cost is the platform's own, passed on at cost: Harbor
//   reports each agent's running total for the month and the backend debits
//   what is new since its last settlement;
// - before a turn, Harbor asks whether the owner has credits left.
//
// Absent (no HARBOR_BILLING_URL) the deployment bills nothing and managed
// agents run as before, on the trial: the open-source Harbor self-hosts
// without Rowboat's backend (spec §4, one codebase).

export interface RegisterAgentInput {
  /** The agent's id in billing: its end-user id on the platform, unique per hosting. */
  ref: string;
  kind: string;
  name: string;
}

export interface BillingAccounts {
  /** Rowboat's LLM gateway, OpenAI-format: where a billed Hermes sends its model calls. */
  readonly gatewayUrl: string;
  /** Where an owner changes their plan, for the message an agent posts when credits run out. */
  upgradeUrl(): Promise<string | undefined>;
  /** Refused with `limit` when the owner's plan already has as many managed agents as it allows. Idempotent on `ref`. */
  registerAgent(customer: string, input: RegisterAgentInput): Promise<{ ok: true } | { ok: false; limit: number }>;
  unregisterAgent(customer: string, ref: string): Promise<void>;
  /** A gateway key billed to `customer`, revoking the ref's earlier one; the plaintext goes straight to the VM. */
  mintGatewayKey(customer: string, input: { ref: string; name: string }): Promise<{ key: string; hint: string }>;
  revokeGatewayKey(customer: string, ref: string): Promise<void>;
  /** Whether the owner has credits to spend: the gateway's own check, asked before waking the VM. */
  authorize(customer: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** The agent's cumulative platform cost for the month starting `periodStart`; the backend debits only what is new. */
  reportHosting(customer: string, input: { ref: string; periodStart: string; totalCents: number }): Promise<void>;
  /** The plan the account is on (2026-11-04): the free plan's agents keep the smallest machine. */
  planOf(customer: string): Promise<string | undefined>;
  /** Whether a member's subject at an issuer names a Rowboat account. */
  accountFor(identities: Array<{ iss: string; sub: string }>): string | undefined;
}

export class BillingError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = 15_000;

export interface HttpBillingOptions {
  /** rowboatx-backend's origin, e.g. https://api.x.rowboatlabs.com. */
  url: string;
  /** Its internal routes' bearer key. */
  key: string;
  /** The issuer whose subjects are Rowboat accounts (Supabase Auth); any issuer when unset. */
  issuer?: string;
  /** Overrides the upgrade address the backend's config names. */
  upgradeUrl?: string;
  fetch?: typeof fetch;
}

export function httpBilling(options: HttpBillingOptions): BillingAccounts {
  const base = options.url.replace(/\/+$/, '');
  const doFetch = options.fetch ?? fetch;
  let upgrade: string | undefined = options.upgradeUrl;

  async function call<T>(path: string, body: unknown, accept: number[] = []): Promise<{ status: number; data: T }> {
    const res = await doFetch(`${base}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${options.key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok && !accept.includes(res.status)) throw new BillingError(res.status, data?.error ?? `billing answered ${res.status}`);
    return { status: res.status, data };
  }
  const customerPath = (customer: string, rest: string) => `/internal/billing/customers/${encodeURIComponent(customer)}${rest}`;

  return {
    gatewayUrl: `${base}/v1/llm`,
    async upgradeUrl() {
      if (upgrade) return upgrade;
      try {
        const res = await doFetch(`${base}/v1/config`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        const config = (await res.json()) as { appUrl?: unknown };
        if (typeof config.appUrl === 'string' && config.appUrl) upgrade = `${config.appUrl.replace(/\/+$/, '')}?intent=upgrade`;
      } catch {
        // The message goes out without the link; the next one tries again.
      }
      return upgrade;
    },
    async registerAgent(customer, input) {
      const { status, data } = await call<{ limit?: number }>(customerPath(customer, '/managed-agents'), input, [403]);
      if (status === 403) return { ok: false, limit: typeof data.limit === 'number' ? data.limit : 0 };
      return { ok: true };
    },
    async unregisterAgent(customer, ref) {
      await call(customerPath(customer, '/managed-agents/unregister'), { ref });
    },
    async mintGatewayKey(customer, input) {
      const { data } = await call<{ key?: unknown; hint?: unknown }>(customerPath(customer, '/gateway-keys'), input);
      if (typeof data.key !== 'string' || !data.key) throw new BillingError(502, 'billing minted no key');
      return { key: data.key, hint: typeof data.hint === 'string' ? data.hint : data.key.slice(-4) };
    },
    async revokeGatewayKey(customer, ref) {
      await call(customerPath(customer, '/gateway-keys/revoke'), { ref });
    },
    async authorize(customer) {
      const { data } = await call<{ success?: boolean; error?: string }>(customerPath(customer, '/authorize'), { type: 'use_credits' });
      return data.success ? { ok: true } : { ok: false, error: data.error ?? 'Not authorized' };
    },
    async planOf(customer) {
      const res = await doFetch(`${base}${customerPath(customer, '')}`, { headers: { authorization: `Bearer ${options.key}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new BillingError(res.status, `billing answered ${res.status}`);
      const data = (await res.json().catch(() => ({}))) as { customer?: { subscriptionPlanId?: unknown } };
      return typeof data.customer?.subscriptionPlanId === 'string' ? data.customer.subscriptionPlanId : undefined;
    },
    async reportHosting(customer, input) {
      await call(customerPath(customer, '/hosting-usage'), input);
    },
    accountFor(identities) {
      const match = identities.find((i) => UUID.test(i.sub) && (!options.issuer || i.iss === options.issuer));
      return match?.sub;
    },
  };
}

/** The deployment's billing, or none: HARBOR_BILLING_URL and HARBOR_BILLING_KEY, both or neither. */
export function billingFromEnv(): BillingAccounts | undefined {
  const url = process.env.HARBOR_BILLING_URL;
  const key = process.env.HARBOR_BILLING_KEY;
  if (!url || !key) return undefined;
  return httpBilling({
    url,
    key,
    ...(process.env.HARBOR_BILLING_ISSUER ? { issuer: process.env.HARBOR_BILLING_ISSUER } : {}),
    ...(process.env.HARBOR_BILLING_UPGRADE_URL ? { upgradeUrl: process.env.HARBOR_BILLING_UPGRADE_URL } : {}),
  });
}
