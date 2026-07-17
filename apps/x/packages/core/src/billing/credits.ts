import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';
import { getAccessToken } from '../auth/tokens.js';
import { decodeJwtPayload } from '../auth/jwt.js';
import { isSignedIn } from '../account/account.js';
import { isFeatureEnabled } from '../analytics/posthog.js';
import { API_URL } from '../config/env.js';
import { getBillingInfo } from './billing.js';
import { getRowboatConfig } from '../config/rowboat.js';
import { getBillingPlanData } from '@x/shared/dist/billing.js';
import {
  CreditActivityCodeSchema,
  type CreditActivationCatalogEntry,
  type CreditActivityCode,
  type CreditsState,
  type ReferralClaimResult,
  type ReferralState,
} from '@x/shared/dist/credits.js';

// The reward catalog (names, descriptions, amounts) is owned by the backend
// and served via GET /v1/config `creditActivations` — the app hardcodes only
// the activity codes it knows how to trigger. Entries with codes this app
// version doesn't recognize are dropped (nothing here can fire them).
type KnownCatalogEntry = CreditActivationCatalogEntry & { code: CreditActivityCode };

async function getActivityCatalog(): Promise<KnownCatalogEntry[]> {
  const config = await getRowboatConfig();
  return (config.creditActivations ?? []).filter(
    (entry): entry is KnownCatalogEntry => CreditActivityCodeSchema.safeParse(entry.code).success,
  );
}

const CLAIMED_FILE = path.join(WorkDir, 'config', 'credit_activations.json');

const CREDITS_FLAG_KEY = 'credit-rewards';
const FLAG_CACHE_TTL_MS = 5 * 60 * 1000;

let flagCache: { value: boolean; fetchedAt: number } | null = null;

/**
 * Whether the credit-rewards feature is on for this user. Defaults ON; the
 * PostHog `credit-rewards` flag is a remote kill switch / rollout control —
 * create it and set release conditions to turn the feature off (or ramp it)
 * for non-matching users. Evaluated against the identified rowboat user and
 * cached briefly so reward triggers don't add a network hop. ROWBOAT_CREDITS
 * env var (1/0) overrides everything for development.
 */
export async function isCreditsEnabled(): Promise<boolean> {
  const override = process.env.ROWBOAT_CREDITS;
  if (override === '1' || override === 'true') return true;
  if (override === '0' || override === 'false') return false;

  if (flagCache && Date.now() - flagCache.fetchedAt < FLAG_CACHE_TTL_MS) {
    return flagCache.value;
  }
  const value = await isFeatureEnabled(CREDITS_FLAG_KEY, true);
  flagCache = { value, fetchedAt: Date.now() };
  return value;
}

const PLAN_CACHE_TTL_MS = 60 * 1000;

let planCache: { userId: string; paid: boolean; fetchedAt: number } | null = null;

// Rewards target free-tier users; paid (starter/pro, including trials of
// those plans) neither see the UI nor receive grants. Cached briefly since
// UI refreshes can arrive in bursts and /v1/me isn't free; keyed by user so
// an account switch on the same install can't reuse the previous account's
// answer. Throws on network failure — callers treat that as "not eligible
// right now" and retry later.
async function hasPaidPlan(userId: string): Promise<boolean> {
  if (planCache && planCache.userId === userId && Date.now() - planCache.fetchedAt < PLAN_CACHE_TTL_MS) {
    return planCache.paid;
  }
  const billing = await getBillingInfo();
  const category = getBillingPlanData(billing.catalog, billing.subscriptionPlanId)?.category;
  const paid = category === 'starter' || category === 'pro';
  planCache = { userId, paid, fetchedAt: Date.now() };
  return paid;
}

// Claimed-state cache, keyed by Rowboat user id so switching accounts on the
// same install doesn't hide unclaimed rewards. This is only a cache: the
// backend enforces once-per-customer via the grants table, and a lost file
// merely means the next occurrence of the action re-attempts activation and
// gets a 409 (which re-marks it claimed here). Besides activity codes, the
// store holds the pseudo-code below marking that this account has redeemed
// someone's invite code (the backend allows one lifetime claim per account).
const REFERRAL_CLAIMED_KEY = 'referral_claimed';

interface ClaimedStore {
  [userId: string]: {
    [code: string]: { claimedAt: string };
  };
}

function readClaimedStore(): ClaimedStore {
  try {
    if (fs.existsSync(CLAIMED_FILE)) {
      return JSON.parse(fs.readFileSync(CLAIMED_FILE, 'utf-8')) as ClaimedStore;
    }
  } catch (err) {
    console.warn('[Credits] Failed to read credit_activations.json:', err);
  }
  return {};
}

function markClaimed(userId: string, code: CreditActivityCode | typeof REFERRAL_CLAIMED_KEY): void {
  try {
    const store = readClaimedStore();
    store[userId] = store[userId] ?? {};
    if (store[userId][code]) return;
    store[userId][code] = { claimedAt: new Date().toISOString() };
    const dir = path.dirname(CLAIMED_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CLAIMED_FILE, JSON.stringify(store, null, 2));
  } catch (err) {
    console.warn('[Credits] Failed to persist claimed state:', err);
  }
}

/**
 * Extract the Supabase user id (`sub` claim) from the Rowboat access token
 * without verification — we only use it as a local cache key.
 */
function userIdFromToken(accessToken: string): string | null {
  const sub = decodeJwtPayload(accessToken)?.sub;
  return typeof sub === 'string' ? sub : null;
}

export interface CreditActivationSuccess {
  code: CreditActivityCode | typeof REFERRAL_CLAIMED_KEY;
  title: string;
  // granted amount as confirmed by the backend
  credits: number;
}

type CreditActivationListener = (event: CreditActivationSuccess) => void;
const activationListeners = new Set<CreditActivationListener>();

/**
 * Be notified whenever the backend confirms a new credit grant, regardless of
 * which call site triggered it. Main subscribes once and relays the event to
 * all renderer windows (`credits:didActivate`).
 */
export function subscribeCreditActivations(listener: CreditActivationListener): () => void {
  activationListeners.add(listener);
  return () => activationListeners.delete(listener);
}

function notifyActivation(event: CreditActivationSuccess): void {
  for (const listener of activationListeners) {
    try {
      listener(event);
    } catch (err) {
      console.warn('[Credits] Activation listener failed:', err);
    }
  }
}

/**
 * Activate a first-time-action reward with the backend, at most once per user.
 *
 * Returns the granted amount when the backend confirms a new grant, and null
 * in every other case (not signed in, already claimed, unknown code, network
 * failure). Never throws — reward activation must not break the action that
 * triggered it. Failures other than "already claimed" leave the local state
 * untouched, so the next occurrence of the action retries; the backend's
 * uniqueness guarantee makes retries safe.
 */
export async function maybeActivateCredit(code: CreditActivityCode): Promise<CreditActivationSuccess | null> {
  try {
    if (!(await isSignedIn())) return null;
    const accessToken = await getAccessToken();
    const userId = userIdFromToken(accessToken);
    if (!userId) return null;

    // decisive local short-circuit first: after the one-time claim, repeat
    // actions (every email send, agent create, …) must not pay the feature
    // flag or /v1/me lookups below
    if (readClaimedStore()[userId]?.[code]) return null;

    if (!(await isCreditsEnabled())) return null;
    if (await hasPaidPlan(userId)) return null;

    const response = await fetch(`${API_URL}/v1/billing/credit-activations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code }),
    });

    if (response.status === 409) {
      // already granted on the backend (e.g. fresh install, second device)
      markClaimed(userId, code);
      return null;
    }
    if (!response.ok) {
      // 404 = code not in the backend catalog yet; anything else is transient.
      // Either way, don't mark claimed — retry on the next occurrence.
      console.warn(`[Credits] Activation of ${code} failed: ${response.status}`);
      return null;
    }

    // validate the response shape BEFORE persisting the claim — a malformed
    // 200 must stay retryable (the retry then gets a 409 and reconciles)
    const body = await response.json() as { grant?: { amount?: number } };
    const amount = body?.grant?.amount;
    if (typeof amount !== 'number') {
      console.warn(`[Credits] Activation of ${code} returned an unexpected body`);
      return null;
    }
    markClaimed(userId, code);
    console.log(`[Credits] Activated ${code}: +${amount} credits`);
    // display name from the backend catalog; the code is a serviceable
    // fallback if the config fetch fails right now
    const title = await getActivityCatalog()
      .then((catalog) => catalog.find((entry) => entry.code === code)?.displayName)
      .catch(() => undefined);
    const success: CreditActivationSuccess = { code, title: title ?? code, credits: amount };
    notifyActivation(success);
    return success;
  } catch (err) {
    console.warn(`[Credits] Activation of ${code} errored:`, err);
    return null;
  }
}

const REFERRAL_CACHE_TTL_MS = 60 * 1000;

type ReferralApiStatus = Omit<ReferralState, 'claimedByMe'>;

let referralCache: { userId: string; status: ReferralApiStatus; fetchedAt: number } | null = null;

/**
 * The user's own invite code and claim-slot usage (GET /v1/referral — the
 * backend creates the permanent code lazily on first fetch). Cached briefly
 * because state refreshes arrive in bursts; busted after a successful claim.
 * Returns null on any failure — the UI simply omits the invite row.
 */
async function fetchReferralStatus(accessToken: string, userId: string): Promise<ReferralApiStatus | null> {
  if (referralCache && referralCache.userId === userId && Date.now() - referralCache.fetchedAt < REFERRAL_CACHE_TTL_MS) {
    return referralCache.status;
  }
  try {
    const response = await fetch(`${API_URL}/v1/referral`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      console.warn(`[Credits] Referral status fetch failed: ${response.status}`);
      return null;
    }
    const body = await response.json() as Partial<ReferralApiStatus>;
    const { code, claimsUsed, maxClaims, referrerCredits, refereeCredits } = body ?? {};
    if (
      typeof code !== 'string' ||
      typeof claimsUsed !== 'number' ||
      typeof maxClaims !== 'number' ||
      typeof referrerCredits !== 'number' ||
      typeof refereeCredits !== 'number'
    ) {
      console.warn('[Credits] Referral status has an unexpected shape');
      return null;
    }
    const status: ReferralApiStatus = { code, claimsUsed, maxClaims, referrerCredits, refereeCredits };
    referralCache = { userId, status, fetchedAt: Date.now() };
    return status;
  } catch (err) {
    console.warn('[Credits] Referral status fetch errored:', err);
    return null;
  }
}

/**
 * Redeem another user's invite code (POST /v1/referral/claims); the backend
 * grants both sides credits in one transaction and enforces all the rules
 * (one lifetime claim per account, new accounts only, per-code cap, no
 * self-claims). Failure messages are user-presentable — the backend's own
 * copy where it provided one.
 */
export async function claimReferralCode(rawCode: string): Promise<ReferralClaimResult> {
  const fallback: ReferralClaimResult = { ok: false, message: 'Could not apply the invite code. Please try again.' };
  try {
    const code = rawCode.trim();
    if (!code) return { ok: false, message: 'Enter an invite code.' };
    if (!(await isSignedIn())) return { ok: false, message: 'Sign in to Rowboat to use an invite code.' };
    const accessToken = await getAccessToken();
    const userId = userIdFromToken(accessToken);
    if (!userId) return { ok: false, message: 'Sign in to Rowboat to use an invite code.' };
    if (readClaimedStore()[userId]?.[REFERRAL_CLAIMED_KEY]) {
      return { ok: false, message: 'This account has already used an invite code.' };
    }
    if (!(await isCreditsEnabled())) return { ok: false, message: 'Invite codes are not available right now.' };

    const response = await fetch(`${API_URL}/v1/referral/claims`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code }),
    });
    const body = await response.json().catch(() => null) as { creditsGranted?: number; error?: string } | null;

    if (response.ok) {
      const amount = body?.creditsGranted;
      if (typeof amount !== 'number') {
        console.warn('[Credits] Referral claim returned an unexpected body');
        return fallback;
      }
      markClaimed(userId, REFERRAL_CLAIMED_KEY);
      // the inviter-side status (claimsUsed) is now stale for the invitee's
      // own code too — cheap to just refetch next time
      referralCache = null;
      console.log(`[Credits] Referral claim succeeded: +${amount} credits`);
      notifyActivation({ code: REFERRAL_CLAIMED_KEY, title: 'Invite code applied', credits: amount });
      return { ok: true, creditsGranted: amount };
    }

    const message = typeof body?.error === 'string' ? body.error : undefined;
    // a definitive "already claimed" answer means the entry UI can hide for
    // good on this account (e.g. claimed earlier on another device)
    if (response.status === 409 && message?.toLowerCase().includes('already claimed')) {
      markClaimed(userId, REFERRAL_CLAIMED_KEY);
    }
    return { ok: false, message: message ?? fallback.message };
  } catch (err) {
    console.warn('[Credits] Referral claim errored:', err);
    return fallback;
  }
}

/**
 * Backend reward catalog joined with the current user's claimed flags, for
 * the UI. Claimed flags come from the local cache (the /v1/me grants list
 * doesn't expose activation codes), so a fresh install shows an action as
 * unclaimed until it is performed again and the backend answers 409.
 */
export async function getCreditsState(): Promise<CreditsState> {
  const enabled = await isCreditsEnabled();
  let userId: string | null = null;
  let eligible = false;
  let catalog: KnownCatalogEntry[] = [];
  let referral: ReferralApiStatus | null = null;
  try {
    if (enabled && (await isSignedIn())) {
      const accessToken = await getAccessToken();
      userId = userIdFromToken(accessToken);
      // billing-fetch failures fall through to eligible=false — the UI
      // refreshes on the next credits/oauth event anyway
      eligible = userId != null && !(await hasPaidPlan(userId));
      if (eligible && userId) {
        catalog = await getActivityCatalog();
        referral = await fetchReferralStatus(accessToken, userId);
      }
    }
  } catch {
    // treat token/billing/config errors as not eligible right now
    eligible = false;
  }
  const claimed = userId ? readClaimedStore()[userId] ?? {} : {};
  return {
    enabled,
    eligible,
    // API order is preserved — the backend catalog decides display order too
    activities: catalog.map((entry) => ({
      code: entry.code,
      title: entry.displayName,
      ...(entry.description !== undefined ? { description: entry.description } : {}),
      credits: entry.credits,
      claimed: !!claimed[entry.code],
    })),
    ...(referral ? { referral: { ...referral, claimedByMe: !!claimed[REFERRAL_CLAIMED_KEY] } } : {}),
  };
}
