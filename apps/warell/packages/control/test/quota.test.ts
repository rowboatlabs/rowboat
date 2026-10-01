import { describe, expect, it } from 'vitest';
import { CREDITS_PER_DOLLAR } from '@x/shared/dist/billing.js';
import {
  FLOOR_CREDITS,
  SESSION_MS,
  WEEK_MS,
  admit,
  admitCost,
  budgetsForWeek,
  charge,
  creditsForCost,
  gauges,
  initialState,
  refund,
} from '../src/quota.js';

const T0 = Date.UTC(2026, 8, 30, 8, 0, 0);
const HOUR = 60 * 60 * 1000;
const budgets = budgetsForWeek(400);

describe('usage quota (architecture §3.5)', () => {
  it('gives a session a quarter of the week', () => {
    expect(budgetsForWeek(400)).toEqual({ sessionCredits: 100, weekCredits: 400 });
  });

  it('opens the session on the first call and closes it 5 hours later', () => {
    let s = charge(initialState(T0), 60, T0 + HOUR);
    expect(s.sessionStart).toBe(T0 + HOUR);
    expect(gauges(s, budgets, T0 + 2 * HOUR).session.usedCredits).toBe(60);

    s = charge(s, 10, T0 + HOUR + SESSION_MS);
    expect(s.sessionStart).toBe(T0 + HOUR + SESSION_MS);
    expect(s.sessionUsed).toBe(10);
    expect(s.weekUsed).toBe(70);
  });

  it('refuses when the session is spent, until the session resets', () => {
    const s = charge(initialState(T0), 100, T0);
    expect(admit(s, budgets, T0 + HOUR)).toEqual({ ok: false, window: 'session', resetsAt: T0 + SESSION_MS });
    expect(admit(s, budgets, T0 + SESSION_MS)).toEqual({ ok: true });
  });

  it('anchors the week to account creation and rolls over skipped weeks', () => {
    let s = initialState(T0);
    for (let i = 0; i < 4; i++) s = charge(s, 100, T0 + i * SESSION_MS);
    expect(admit(s, budgets, T0 + 4 * SESSION_MS)).toEqual({ ok: false, window: 'week', resetsAt: T0 + WEEK_MS });
    expect(admit(s, budgets, T0 + WEEK_MS)).toEqual({ ok: true });

    const later = charge(s, 5, T0 + 3 * WEEK_MS + HOUR);
    expect(later.weekStart).toBe(T0 + 3 * WEEK_MS);
    expect(later.weekUsed).toBe(5);
  });

  it('reports the week first when both windows are spent', () => {
    const s = { sessionStart: T0, sessionUsed: 100, weekStart: T0, weekUsed: 400 };
    expect(admit(s, budgets, T0 + HOUR)).toMatchObject({ window: 'week' });
  });

  it('never cuts a started call: its cost may overrun the budget', () => {
    const s = charge(charge(initialState(T0), 90, T0), 50, T0 + 1);
    expect(s.sessionUsed).toBe(140);
    expect(gauges(s, budgets, T0 + 2).session.availableCredits).toBe(0);
  });

  it('shows an empty session gauge when no session is open', () => {
    const g = gauges(initialState(T0), budgets, T0 + HOUR);
    expect(g.session).toEqual({ sanctionedCredits: 100, usedCredits: 0, availableCredits: 100, resetsAt: T0 + HOUR + SESSION_MS });
  });

  it('counts the real cost, or the floor when OpenRouter gives none', () => {
    expect(creditsForCost(0.0123)).toEqual({ credits: 0.0123 * CREDITS_PER_DOLLAR, estimated: false });
    expect(creditsForCost(0)).toEqual({ credits: 0, estimated: false });
    for (const bad of [undefined, null, -1, Number.NaN, '0.1']) {
      expect(creditsForCost(bad)).toEqual({ credits: FLOOR_CREDITS, estimated: true });
    }
  });
});

describe('priced calls (media, decided 30/09/2026)', () => {
  it('admits a cost only if it fits in both windows', () => {
    const s = charge(initialState(T0), 60, T0);
    expect(admitCost(s, budgets, 40, T0 + HOUR)).toEqual({ ok: true });
    expect(admitCost(s, budgets, 41, T0 + HOUR)).toEqual({ ok: false, reason: 'quota_reached', window: 'session', resetsAt: T0 + SESSION_MS });
    expect(admitCost(s, budgets, 41, T0 + SESSION_MS)).toEqual({ ok: true });
  });

  it('says when waiting will never help', () => {
    expect(admitCost(initialState(T0), budgets, 101, T0)).toEqual({ ok: false, reason: 'over_plan', window: 'session' });
    expect(admitCost(initialState(T0), budgets, 401, T0)).toEqual({ ok: false, reason: 'over_plan', window: 'week' });
  });

  it('checks the week first', () => {
    let s = initialState(T0);
    for (let i = 0; i < 4; i++) s = charge(s, 95, T0 + i * SESSION_MS);
    expect(admitCost(s, budgets, 30, T0 + 4 * SESSION_MS)).toMatchObject({ ok: false, window: 'week' });
  });

  it('refunds only the windows still open since the charge, never below zero', () => {
    const s = charge(initialState(T0), 50, T0);
    expect(refund(s, 50, T0, T0 + HOUR)).toMatchObject({ sessionUsed: 0, weekUsed: 0 });
    // The session reset in between: only the week gets it back.
    const later = charge(s, 10, T0 + SESSION_MS + HOUR);
    expect(refund(later, 50, T0, T0 + SESSION_MS + 2 * HOUR)).toMatchObject({ sessionUsed: 10, weekUsed: 10 });
    expect(refund(s, 80, T0, T0 + HOUR)).toMatchObject({ sessionUsed: 0, weekUsed: 0 });
  });
});
