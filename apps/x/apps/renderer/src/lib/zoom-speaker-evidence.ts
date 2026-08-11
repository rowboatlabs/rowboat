import type { IPCChannels } from '@x/shared/dist/ipc';

export type ZoomAccessibilityEvent = IPCChannels['meeting:zoomAccessibilityEvidence']['req'];
export type ZoomSpeakerEvent = Extract<ZoomAccessibilityEvent, { type: 'speaker' }>;

const MAX_TIMELINE_EVENTS = 96;
const BEFORE_INTERVAL_TOLERANCE_MS = 1_500;
const AFTER_INTERVAL_TOLERANCE_MS = 2_500;
const MINIMUM_DOMINANCE_RATIO = 1.35;

export function appendZoomSpeakerEvidence(
  timeline: ZoomSpeakerEvent[],
  event: ZoomSpeakerEvent,
): ZoomSpeakerEvent[] {
  const next = [...timeline, event];
  return next.length > MAX_TIMELINE_EVENTS
    ? next.slice(next.length - MAX_TIMELINE_EVENTS)
    : next;
}

/**
 * Resolve one system-audio transcript interval to a Zoom display name. Raw
 * roster names and self markers are insufficient: only explicit active
 * speaker evidence (or the helper's sole-unmuted fallback) is accepted.
 * Overlap or weak/conflicting evidence deliberately preserves diarization.
 */
export function resolveZoomSpeakerForInterval(
  timeline: readonly ZoomSpeakerEvent[],
  intervalStartMs: number,
  intervalEndMs: number,
  fallback: string,
): string {
  const scores = new Map<string, { displayName: string; score: number }>();
  for (const event of timeline) {
    if (!event.isActive || event.isSelf === true) continue;
    if (event.observedAtMs < intervalStartMs - BEFORE_INTERVAL_TOLERANCE_MS) continue;
    if (event.observedAtMs > intervalEndMs + AFTER_INTERVAL_TOLERANCE_MS) continue;
    const key = event.displayName.trim().toLocaleLowerCase();
    if (!key) continue;
    const previous = scores.get(key);
    scores.set(key, {
      displayName: event.displayName.trim(),
      score: (previous?.score ?? 0) + event.confidence,
    });
  }

  const ranked = [...scores.values()].sort((left, right) => right.score - left.score);
  if (ranked.length === 0) return fallback;
  if (ranked.length > 1 && ranked[0].score < ranked[1].score * MINIMUM_DOMINANCE_RATIO) {
    return fallback;
  }
  return ranked[0].displayName;
}
