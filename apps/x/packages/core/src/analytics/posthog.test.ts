import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockPostHogInstance = {
  identify: vi.fn(),
  capture: vi.fn(),
  alias: vi.fn(),
  isFeatureEnabled: vi.fn().mockResolvedValue(true),
  shutdown: vi.fn().mockResolvedValue(undefined),
};

vi.mock('posthog-node', () => {
  return {
    PostHog: vi.fn().mockImplementation(function () {
      return mockPostHogInstance;
    }),
  };
});

let mockSettings: Record<string, unknown> = {};

vi.mock('../config/app_settings.js', () => ({
  loadAppSettings: vi.fn(() => mockSettings),
  saveAppSettings: vi.fn((patch: Record<string, unknown>) => {
    mockSettings = { ...mockSettings, ...patch };
  }),
}));

vi.mock('./installation.js', () => ({
  getInstallationId: vi.fn(() => 'test-install-uuid-1234'),
}));

import {
  isTelemetryOptedOut,
  setTelemetryOptedOut,
  capture,
  identify,
  isFeatureEnabled,
  _resetStateForTesting,
  getAnalyticsEnabled,
  setAnalyticsEnabled,
  setPersonProperties,
} from './posthog.js';

describe('posthog telemetry opt-out (issue #415)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings = {};
    _resetStateForTesting();
    delete process.env.DO_NOT_TRACK;
    delete process.env.ROWBOAT_TELEMETRY_DISABLED;
    process.env.POSTHOG_KEY = 'phc_test_key_123';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    _resetStateForTesting();
  });

  describe('isTelemetryOptedOut', () => {
    it('returns false by default when no flags or settings are set', () => {
      expect(isTelemetryOptedOut()).toBe(false);
    });

    it('returns true when DO_NOT_TRACK is 1', () => {
      process.env.DO_NOT_TRACK = '1';
      expect(isTelemetryOptedOut()).toBe(true);
    });

    it('returns true when DO_NOT_TRACK is true (case-insensitive)', () => {
      process.env.DO_NOT_TRACK = 'True';
      expect(isTelemetryOptedOut()).toBe(true);
    });

    it('returns false when DO_NOT_TRACK is 0', () => {
      process.env.DO_NOT_TRACK = '0';
      expect(isTelemetryOptedOut()).toBe(false);
    });

    it('returns true when ROWBOAT_TELEMETRY_DISABLED is 1', () => {
      process.env.ROWBOAT_TELEMETRY_DISABLED = '1';
      expect(isTelemetryOptedOut()).toBe(true);
    });

    it('returns true when ROWBOAT_TELEMETRY_DISABLED is true', () => {
      process.env.ROWBOAT_TELEMETRY_DISABLED = 'true';
      expect(isTelemetryOptedOut()).toBe(true);
    });

    it('returns true when telemetryOptOut is true in app_settings', () => {
      mockSettings = { telemetryOptOut: true };
      expect(isTelemetryOptedOut()).toBe(true);
    });
  });

  describe('setTelemetryOptedOut', () => {
    it('persists telemetryOptOut to settings and disables future capture', () => {
      setTelemetryOptedOut(true);
      expect(mockSettings.telemetryOptOut).toBe(true);
      expect(isTelemetryOptedOut()).toBe(true);

      capture('test_event', { foo: 'bar' });
      expect(mockPostHogInstance.capture).not.toHaveBeenCalled();
    });

    it('persists telemetryOptOut: false to allow re-enabling', () => {
      setTelemetryOptedOut(true);
      expect(isTelemetryOptedOut()).toBe(true);

      setTelemetryOptedOut(false);
      expect(mockSettings.telemetryOptOut).toBe(false);
      expect(isTelemetryOptedOut()).toBe(false);
    });

    it('shuts down existing PostHog client when opted out after initialization', () => {
      // Trigger client initialization
      capture('initial_event');
      expect(mockPostHogInstance.capture).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'initial_event' }),
      );

      // Opt out
      setTelemetryOptedOut(true);
      expect(mockPostHogInstance.shutdown).toHaveBeenCalled();

      // Subsequent capture should no-op
      mockPostHogInstance.capture.mockClear();
      capture('subsequent_event');
      expect(mockPostHogInstance.capture).not.toHaveBeenCalled();
    });
  });

  describe('guarding capture, identify, and feature flags when opted out', () => {
    beforeEach(() => {
      process.env.DO_NOT_TRACK = '1';
    });

    it('does not send events via capture()', () => {
      capture('app_launched');
      expect(mockPostHogInstance.capture).not.toHaveBeenCalled();
    });

    it('does not send identity via identify()', () => {
      identify('user_123', { email: 'user@example.com' });
      expect(mockPostHogInstance.identify).not.toHaveBeenCalled();
      expect(mockPostHogInstance.alias).not.toHaveBeenCalled();
    });

    it('returns defaultValue for isFeatureEnabled() without querying client', async () => {
      const enabled = await isFeatureEnabled('new_feature', false);
      expect(enabled).toBe(false);
      expect(mockPostHogInstance.isFeatureEnabled).not.toHaveBeenCalled();

      const defaultTrue = await isFeatureEnabled('new_feature', true);
      expect(defaultTrue).toBe(true);
    });
  });
});

describe('Advanced analytics consent compatibility', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
    _resetStateForTesting();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings = {};
    _resetStateForTesting();
    delete process.env.DO_NOT_TRACK;
    delete process.env.ROWBOAT_TELEMETRY_DISABLED;
    process.env.POSTHOG_KEY = 'phc_test';
  });

  it('captures by default', () => {
    capture('evt');
    expect(mockPostHogInstance.capture).toHaveBeenCalledTimes(1);
  });

  it('never captures when the persisted setting is opted out', async () => {
    mockSettings.analyticsEnabled = false;
    expect(getAnalyticsEnabled()).toBe(false);
    capture('evt');
    identify('user');
    setPersonProperties({ plan: 'test' });
    expect(await isFeatureEnabled('flag', true)).toBe(true);
    expect(mockPostHogInstance.capture).not.toHaveBeenCalled();
    expect(mockPostHogInstance.identify).not.toHaveBeenCalled();
    expect(mockPostHogInstance.alias).not.toHaveBeenCalled();
    expect(mockPostHogInstance.isFeatureEnabled).not.toHaveBeenCalled();
  });

  it('stops capturing immediately after opting out, and resumes on opt-in', async () => {
    capture('before');
    await setAnalyticsEnabled(false);
    expect(mockSettings).toMatchObject({ analyticsEnabled: false, telemetryOptOut: true });
    capture('during');
    expect(mockPostHogInstance.capture).toHaveBeenCalledTimes(1);
    await setAnalyticsEnabled(true);
    capture('after');
    expect(mockPostHogInstance.capture).toHaveBeenCalledTimes(2);
  });
  it('honours a setting changed by another process after initialization', async () => {
    capture('before');
    mockSettings.analyticsEnabled = false;
    mockPostHogInstance.identify.mockClear();
    identify('user');
    setPersonProperties({ plan: 'test' });
    expect(mockPostHogInstance.identify).not.toHaveBeenCalled();
    expect(mockPostHogInstance.alias).not.toHaveBeenCalled();
    capture('during');
    expect(await isFeatureEnabled('flag', true)).toBe(true);
    expect(mockPostHogInstance.isFeatureEnabled).not.toHaveBeenCalled();
    expect(mockPostHogInstance.capture).toHaveBeenCalledTimes(1);
    mockSettings.analyticsEnabled = true;
    capture('after');
    expect(mockPostHogInstance.capture).toHaveBeenCalledTimes(2);
  });
  it('keeps environment opt-outs effective when either setting opts in', async () => {
    process.env.DO_NOT_TRACK = '1';
    await setAnalyticsEnabled(true);
    expect(getAnalyticsEnabled()).toBe(false);
    setTelemetryOptedOut(false);
    expect(isTelemetryOptedOut()).toBe(true);
    capture('blocked');
    expect(mockPostHogInstance.capture).not.toHaveBeenCalled();
  });

});
