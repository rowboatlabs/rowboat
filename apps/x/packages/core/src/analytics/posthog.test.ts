import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureMock = vi.fn();
const flushMock = vi.fn(async () => {});
const saveAppSettings = vi.fn();
let storedEnabled: boolean | undefined;

vi.mock('posthog-node', () => ({
  PostHog: class {
    capture = captureMock;
    identify = vi.fn();
    alias = vi.fn();
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
    expect(captureMock).not.toHaveBeenCalled();
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
});
