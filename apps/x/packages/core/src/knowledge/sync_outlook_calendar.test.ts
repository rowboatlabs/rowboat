import { describe, expect, it } from 'vitest';
import { allDayDate } from './sync_outlook_calendar.js';

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
