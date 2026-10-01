import { CREDITS_PER_DOLLAR } from '@x/shared/dist/billing.js';

// Usage quota in two windows, 5 hours and one week, at real cost
// (architecture §3.5 "Le quota d'utilisation", decided 30/09/2026).
// Everything here is pure: the clock and the stored state come in, the new
// state goes out, so the rules are tested without a server.

export const SESSION_MS = 5 * 60 * 60 * 1000;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** A response without a cost is charged this floor, never zero. */
export const FLOOR_CREDITS = CREDITS_PER_DOLLAR / 1000;

export type QuotaWindow = 'session' | 'week';

export interface QuotaState {
  /** Start of the open session, or null when none is open. */
  sessionStart: number | null;
  sessionUsed: number;
  /** Start of the current week; weeks are anchored to account creation. */
  weekStart: number;
  weekUsed: number;
}

export interface Budgets {
  sessionCredits: number;
  weekCredits: number;
}

/** A session is a quarter of the week, as decided on 30/09/2026. */
export function budgetsForWeek(weekCredits: number): Budgets {
  return { sessionCredits: Math.floor(weekCredits / 4), weekCredits };
}

export function initialState(accountCreatedAt: number): QuotaState {
  return { sessionStart: null, sessionUsed: 0, weekStart: accountCreatedAt, weekUsed: 0 };
}

/** Closes an expired session and rolls the week forward to the one containing `now`. */
export function advance(state: QuotaState, now: number): QuotaState {
  let { sessionStart, sessionUsed, weekStart, weekUsed } = state;
  if (sessionStart !== null && now >= sessionStart + SESSION_MS) {
    sessionStart = null;
    sessionUsed = 0;
  }
  if (now >= weekStart + WEEK_MS) {
    weekStart += Math.floor((now - weekStart) / WEEK_MS) * WEEK_MS;
    weekUsed = 0;
  }
  return { sessionStart, sessionUsed, weekStart, weekUsed };
}

export type Admission =
  | { ok: true }
  | { ok: false; window: QuotaWindow; resetsAt: number };

/**
 * Decided before the call. The week is checked first: when both are spent,
 * the later reset is the one the person actually waits for.
 */
export function admit(state: QuotaState, budgets: Budgets, now: number): Admission {
  const s = advance(state, now);
  if (s.weekUsed >= budgets.weekCredits) {
    return { ok: false, window: 'week', resetsAt: s.weekStart + WEEK_MS };
  }
  if (s.sessionStart !== null && s.sessionUsed >= budgets.sessionCredits) {
    return { ok: false, window: 'session', resetsAt: s.sessionStart + SESSION_MS };
  }
  return { ok: true };
}

/** Opens the session on the first call when none is open. */
export function open(state: QuotaState, now: number): QuotaState {
  const s = advance(state, now);
  return s.sessionStart === null ? { ...s, sessionStart: now } : s;
}

/** Counts a finished call. A call already started is never cut: it may overrun. */
export function charge(state: QuotaState, credits: number, now: number): QuotaState {
  const s = open(state, now);
  return { ...s, sessionUsed: s.sessionUsed + credits, weekUsed: s.weekUsed + credits };
}

export interface Gauge {
  sanctionedCredits: number;
  usedCredits: number;
  availableCredits: number;
  resetsAt: number;
}

/** What the person sees: one gauge per window. A closed session shows empty. */
export function gauges(state: QuotaState, budgets: Budgets, now: number): Record<QuotaWindow, Gauge> {
  const s = advance(state, now);
  const gauge = (sanctioned: number, used: number, resetsAt: number): Gauge => ({
    sanctionedCredits: sanctioned,
    usedCredits: used,
    availableCredits: Math.max(0, sanctioned - used),
    resetsAt,
  });
  return {
    session: gauge(budgets.sessionCredits, s.sessionUsed, (s.sessionStart ?? now) + SESSION_MS),
    week: gauge(budgets.weekCredits, s.weekUsed, s.weekStart + WEEK_MS),
  };
}

/** OpenRouter reports cost in dollars; missing or invalid means the floor. */
export function creditsForCost(cost: unknown): { credits: number; estimated: boolean } {
  if (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0) {
    return { credits: Math.round(cost * CREDITS_PER_DOLLAR), estimated: false };
  }
  return { credits: FLOOR_CREDITS, estimated: true };
}
