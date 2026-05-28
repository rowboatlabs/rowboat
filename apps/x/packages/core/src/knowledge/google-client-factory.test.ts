import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuthTokens } from '../auth/types.js';

/**
 * Regression for the cold-start race that left a stuck `error` field in
 * oauth.json: Gmail + Calendar both call getClient() in the same tick, the
 * dedup singleton's check-and-assign were separated by an `await`, two
 * parallel refreshes go out, backend 429s the second one, the upsert(error)
 * write from the 429 path could land last and stick "Needs reconnect" in
 * the UI even though tokens were valid.
 */

interface MockOAuthRepo {
  read: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  getClientFacingConfig: ReturnType<typeof vi.fn>;
}

let refreshSpy: ReturnType<typeof vi.fn>;
let mockOAuthRepo: MockOAuthRepo;
let storedTokens: OAuthTokens;

beforeEach(() => {
  vi.resetModules();

  // Expired 1 minute ago — forces the refresh path through getClient.
  storedTokens = {
    access_token: 'old-access',
    refresh_token: 'rt',
    expires_at: Math.floor(Date.now() / 1000) - 60,
    token_type: 'Bearer',
    scopes: ['https://www.googleapis.com/auth/gmail.modify'],
  };

  mockOAuthRepo = {
    read: vi.fn(async () => ({ tokens: storedTokens, mode: 'rowboat' as const })),
    upsert: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    getClientFacingConfig: vi.fn(async () => ({})),
  };

  vi.doMock('../di/container.js', () => ({
    default: {
      resolve: (key: string) => {
        if (key === 'oauthRepo') return mockOAuthRepo;
        throw new Error(`unexpected DI resolve in test: ${key}`);
      },
    },
  }));

  // Real-ish delay so two concurrent callers actually have something to
  // overlap on — without it the spy might resolve synchronously and mask
  // the very race we're testing for.
  refreshSpy = vi.fn(async (_rt: string, scopes?: string[]) => {
    await new Promise((r) => setTimeout(r, 25));
    return {
      access_token: 'new-access',
      refresh_token: 'rt',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer' as const,
      scopes,
    };
  });

  vi.doMock('../auth/google-backend-oauth.js', async () => {
    const actual = await vi.importActual<typeof import('../auth/google-backend-oauth.js')>(
      '../auth/google-backend-oauth.js',
    );
    return {
      ...actual,
      refreshTokensViaBackend: refreshSpy,
    };
  });
});

afterEach(() => {
  vi.doUnmock('../di/container.js');
  vi.doUnmock('../auth/google-backend-oauth.js');
  vi.resetModules();
});

describe('GoogleClientFactory.getClient', () => {
  it('coalesces concurrent callers into a single refresh', async () => {
    const { GoogleClientFactory } = await import('./google-client-factory.js');
    GoogleClientFactory.clearCache();

    // Same tick — this is the exact pattern that sync_gmail.init() and
    // sync_calendar.init() produce on cold start.
    const [a, b] = await Promise.all([
      GoogleClientFactory.getClient(),
      GoogleClientFactory.getClient(),
    ]);

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(a).not.toBeNull();
    expect(a).toBe(b);

    // And the failure-path upsert (error: '429…') is never invoked, so
    // oauth.json doesn't get a stuck error.
    const errorUpserts = mockOAuthRepo.upsert.mock.calls.filter(
      ([, conn]) => (conn as { error?: string | null }).error,
    );
    expect(errorUpserts).toHaveLength(0);
  });

  it('returns cached client when tokens are not expired', async () => {
    // Tokens valid for another hour — no refresh should fire.
    storedTokens = {
      access_token: 'fresh-access',
      refresh_token: 'rt',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
      scopes: ['https://www.googleapis.com/auth/gmail.modify'],
    };
    mockOAuthRepo.read = vi.fn(async () => ({ tokens: storedTokens, mode: 'rowboat' as const }));

    const { GoogleClientFactory } = await import('./google-client-factory.js');
    GoogleClientFactory.clearCache();

    const a = await GoogleClientFactory.getClient();
    const b = await GoogleClientFactory.getClient();

    expect(refreshSpy).not.toHaveBeenCalled();
    expect(a).toBe(b);
  });

  it('does not stick an error on transient (429) refresh failure', async () => {
    const { TransientRefreshError } = await import('../auth/google-backend-oauth.js');
    refreshSpy.mockRejectedValueOnce(new TransientRefreshError('refresh failed: 429 Refresh in progress', 429));

    const { GoogleClientFactory } = await import('./google-client-factory.js');
    GoogleClientFactory.clearCache();

    const result = await GoogleClientFactory.getClient();

    expect(result).toBeNull();
    const errorUpserts = mockOAuthRepo.upsert.mock.calls.filter(
      ([, conn]) => (conn as { error?: string | null }).error,
    );
    expect(errorUpserts).toHaveLength(0);
  });
});
