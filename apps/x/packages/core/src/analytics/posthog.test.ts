import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureMock = vi.fn();
const identifyMock = vi.fn();
const aliasMock = vi.fn();
const featureFlagMock = vi.fn();
const flushMock = vi.fn(async () => {});
const saveAppSettings = vi.fn();
let storedEnabled: boolean | undefined;

vi.mock('posthog-node', () => ({
  PostHog: class {
    capture = captureMock;
    identify = identifyMock;
    alias = aliasMock;
    isFeatureEnabled = featureFlagMock;
    flush = flushMock;
    shutdown = vi.fn();
  },
}));
vi.mock('./installation.js', () => ({ getInstallationId: () => 'install-id' }));
vi.mock('../config/env.js', () => ({ API_URL: 'http://api.test' }));
vi.mock('../config/app_settings.js', () => ({
  isAnalyticsEnabled: () => storedEnabled !== false,
  saveAppSettings: (patch: { analyticsEnabled?: boolean }) => {
    saveAppSettings(patch);
    storedEnabled = patch.analyticsEnabled;
  },
}));

async function loadModule() {
  vi.resetModules();
  vi.stubEnv('POSTHOG_KEY', 'phc_test');
  return import('./posthog.js');
}

describe('analytics opt-out', () => {
  beforeEach(() => {
    captureMock.mockClear();
    identifyMock.mockClear();
    aliasMock.mockClear();
    featureFlagMock.mockClear();
    flushMock.mockClear();
    saveAppSettings.mockClear();
    storedEnabled = undefined;
  });

  it('captures by default', async () => {
    const analytics = await loadModule();
    analytics.capture('evt');
    expect(captureMock).toHaveBeenCalledTimes(1);
  });

  it('never captures when the persisted setting is opted out', async () => {
    storedEnabled = false;
    const analytics = await loadModule();
    expect(analytics.getAnalyticsEnabled()).toBe(false);
    analytics.capture('evt');
    analytics.identify('user');
    analytics.setPersonProperties({ plan: 'test' });
    expect(await analytics.isFeatureEnabled('flag', true)).toBe(true);
    expect(captureMock).not.toHaveBeenCalled();
    expect(identifyMock).not.toHaveBeenCalled();
    expect(aliasMock).not.toHaveBeenCalled();
    expect(featureFlagMock).not.toHaveBeenCalled();
  });

  it('stops capturing immediately after opting out, and resumes on opt-in', async () => {
    const analytics = await loadModule();
    analytics.capture('before');
    await analytics.setAnalyticsEnabled(false);
    expect(saveAppSettings).toHaveBeenCalledWith({ analyticsEnabled: false });
    analytics.capture('during');
    expect(captureMock).toHaveBeenCalledTimes(1);
    await analytics.setAnalyticsEnabled(true);
    analytics.capture('after');
    expect(captureMock).toHaveBeenCalledTimes(2);
  });
  it('honours a setting changed by another process after initialization', async () => {
    const analytics = await loadModule();
    analytics.capture('before');
    storedEnabled = false;
    identifyMock.mockClear();
    analytics.identify('user');
    analytics.setPersonProperties({ plan: 'test' });
    expect(identifyMock).not.toHaveBeenCalled();
    expect(aliasMock).not.toHaveBeenCalled();
    analytics.capture('during');
    expect(await analytics.isFeatureEnabled('flag', true)).toBe(true);
    expect(featureFlagMock).not.toHaveBeenCalled();
    expect(captureMock).toHaveBeenCalledTimes(1);
    storedEnabled = true;
    analytics.capture('after');
    expect(captureMock).toHaveBeenCalledTimes(2);
  });
});
