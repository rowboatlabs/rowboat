import PostHog from 'posthog-react-native';

// Mirrors the desktop wrapper (apps/renderer/src/lib/analytics.ts): the key
// is injected at build time; without one, every call is a no-op. `platform`
// separates mobile events from desktop's in the shared PostHog project
// (see apps/x/ANALYTICS.md).

const KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

const client = KEY ? new PostHog(KEY, { host: HOST }) : null;

function capture(event: string, properties?: Record<string, unknown>) {
  client?.capture(event, { platform: 'mobile', ...properties });
}

export function mobilePaired(method: 'qr' | 'manual' | 'dev-link') {
  capture('mobile_paired', { method });
}

export function mobileUnpaired(reason: 'user' | 'unauthorized') {
  capture('mobile_unpaired', { reason });
}

export function mobileMessageSent() {
  capture('mobile_message_sent');
}

export function mobileReconnected() {
  capture('mobile_reconnected');
}

export function mobileNoteOpened() {
  capture('mobile_note_opened');
}

export function mobileVoiceUsed() {
  capture('mobile_voice_used');
}
