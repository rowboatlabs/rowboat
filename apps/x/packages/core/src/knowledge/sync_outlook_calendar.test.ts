import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../di/container.js', () => ({
  default: {
    resolve: vi.fn(),
  },
}));

import { allDayDate, performSync } from './sync_outlook_calendar.js';
import { OutlookClientFactory } from './outlook-client-factory.js';
import {
  noteOutlookRateLimit,
  outlookRateLimitCooldownMs,
  resetOutlookRateLimitForTests,
} from './outlook-rate-limit.js';

// Graph returns all-day boundaries as midnight in the event's original time
// zone converted to UTC (Prefer: outlook.timezone="UTC"); allDayDate must
// recover the intended civil date from that instant.
describe('allDayDate', () => {
  it('recovers the date for UTC+ zones (IST midnight arrives as 18:30Z the day before)', () => {
    expect(allDayDate('2026-07-26T18:30:00.0000000')).toBe('2026-07-27');
  });

  it('recovers the date for larger UTC+ offsets (Sydney midnight arrives as 14:00Z)', () => {
    expect(allDayDate('2026-07-26T14:00:00.0000000')).toBe('2026-07-27');
  });

  it('keeps the date for UTC- zones (PST midnight arrives as 08:00Z the same day)', () => {
    expect(allDayDate('2026-07-27T08:00:00.0000000')).toBe('2026-07-27');
  });

  it('keeps exact UTC midnights unchanged', () => {
    expect(allDayDate('2026-07-27T00:00:00.0000000')).toBe('2026-07-27');
  });

  it('handles already-zoned timestamps', () => {
    expect(allDayDate('2026-07-26T18:30:00Z')).toBe('2026-07-27');
  });

  it('falls back to the raw date slice for unparseable input', () => {
    expect(allDayDate('not-a-date-at-all')).toBe('not-a-date');
  });
});

describe('Outlook calendar rate-limit cooldown', () => {
  beforeEach(() => {
    resetOutlookRateLimitForTests();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('skips sync when rate-limit cooldown is active', async () => {
    noteOutlookRateLimit('60');
    expect(outlookRateLimitCooldownMs()).toBeGreaterThan(0);

    const tokenSpy = vi.spyOn(OutlookClientFactory, 'getAccessToken').mockResolvedValue(null);
    await performSync();

    expect(tokenSpy).not.toHaveBeenCalled();
  });

  it('proceeds with sync when rate-limit cooldown is inactive', async () => {
    expect(outlookRateLimitCooldownMs()).toBe(0);

    const tokenSpy = vi.spyOn(OutlookClientFactory, 'getAccessToken').mockResolvedValue(null);
    await performSync();

    expect(tokenSpy).toHaveBeenCalled();
  });
});

