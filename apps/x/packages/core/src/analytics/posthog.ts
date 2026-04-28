import { PostHog } from 'posthog-node';
import { getInstallationId } from './installation.js';
import { API_URL } from '../config/env.js';

// Build-time injected via esbuild `define` (apps/main/bundle.mjs).
// In dev/tsc, fall back to process.env so local runs work too.
const POSTHOG_KEY = process.env.POSTHOG_KEY ?? process.env.VITE_PUBLIC_POSTHOG_KEY ?? '';
const POSTHOG_HOST = process.env.POSTHOG_HOST ?? process.env.VITE_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

let client: PostHog | null = null;
let initAttempted = false;
let identifiedUserId: string | null = null;

function getClient(): PostHog | null {
  if (initAttempted) return client;
  initAttempted = true;
  if (!POSTHOG_KEY) {
    console.log('[Analytics] POSTHOG_KEY not set; analytics disabled');
    return null;
  }
  try {
    client = new PostHog(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      flushAt: 20,
      flushInterval: 10_000,
    });
    // Tag the install with api_url as a person property up-front,
    // so anonymous users are also segmentable by environment (api_url
    // distinguishes prod / staging / custom — meaning is assigned in PostHog).
    client.identify({
      distinctId: getInstallationId(),
      properties: { api_url: API_URL },
    });
  } catch (err) {
    console.error('[Analytics] Failed to init PostHog:', err);
    client = null;
  }
  return client;
}

function activeDistinctId(): string {
  return identifiedUserId ?? getInstallationId();
}

export function capture(event: string, properties?: Record<string, unknown>): void {
  const ph = getClient();
  if (!ph) return;
  try {
    ph.capture({
      distinctId: activeDistinctId(),
      event,
      properties,
    });
  } catch (err) {
    console.error('[Analytics] capture failed:', err);
  }
}

export function identify(userId: string, properties?: Record<string, unknown>): void {
  const ph = getClient();
  if (!ph) return;
  try {
    // Alias the anonymous installation ID to the rowboat user ID so historical
    // anonymous events are linked to the identified user.
    ph.alias({ distinctId: userId, alias: getInstallationId() });
    ph.identify({
      distinctId: userId,
      properties: {
        ...properties,
        api_url: API_URL,
      },
    });
    identifiedUserId = userId;
  } catch (err) {
    console.error('[Analytics] identify failed:', err);
  }
}

export function reset(): void {
  identifiedUserId = null;
}

export async function shutdown(): Promise<void> {
  if (!client) return;
  try {
    await client.shutdown();
  } catch (err) {
    console.error('[Analytics] shutdown failed:', err);
  }
}
