import { describe, expect, it } from 'vitest';
import { shouldSuppressDuringStartupGrace, STARTUP_GRACE_MS } from './service.js';

describe('shouldSuppressDuringStartupGrace (background-task reopen flood)', () => {
  const launchedAt = 1_700_000_000_000;

  it('suppresses a grace-eligible notification fired inside the window', () => {
    const now = launchedAt + STARTUP_GRACE_MS - 1;
    expect(shouldSuppressDuringStartupGrace({ suppressDuringStartupGrace: true }, launchedAt, now)).toBe(true);
  });

  it('lets a grace-eligible notification through once the window has passed', () => {
    const now = launchedAt + STARTUP_GRACE_MS;
    expect(shouldSuppressDuringStartupGrace({ suppressDuringStartupGrace: true }, launchedAt, now)).toBe(false);
  });

  it('never suppresses a notification that is not grace-eligible', () => {
    const now = launchedAt + 1; // well inside the window
    expect(shouldSuppressDuringStartupGrace({ suppressDuringStartupGrace: false }, launchedAt, now)).toBe(false);
    expect(shouldSuppressDuringStartupGrace({}, launchedAt, now)).toBe(false);
  });

  it('respects a custom grace window', () => {
    const customWindow = 5_000;
    expect(
      shouldSuppressDuringStartupGrace({ suppressDuringStartupGrace: true }, launchedAt, launchedAt + 4_999, customWindow),
    ).toBe(true);
    expect(
      shouldSuppressDuringStartupGrace({ suppressDuringStartupGrace: true }, launchedAt, launchedAt + 5_000, customWindow),
    ).toBe(false);
  });
});
