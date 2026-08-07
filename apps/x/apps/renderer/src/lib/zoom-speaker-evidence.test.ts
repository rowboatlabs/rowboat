import { describe, expect, it } from 'vitest';
import {
  appendZoomSpeakerEvidence,
  resolveZoomSpeakerForInterval,
  type ZoomSpeakerEvent,
} from './zoom-speaker-evidence';

function speaker(overrides: Partial<ZoomSpeakerEvent> = {}): ZoomSpeakerEvent {
  return {
    type: 'speaker',
    displayName: 'Akbar Singh',
    isSelf: false,
    isActive: true,
    isMuted: false,
    confidence: 0.98,
    signals: ['explicit-talking-label'],
    observedAtMs: 10_000,
    ...overrides,
  };
}

describe('Zoom speaker evidence', () => {
  it('uses aligned active-speaker evidence for system audio', () => {
    expect(resolveZoomSpeakerForInterval([speaker()], 9_500, 10_500, 'Speaker 0'))
      .toBe('Akbar Singh');
  });

  it('never assigns a self observation to system audio', () => {
    expect(resolveZoomSpeakerForInterval([speaker({ isSelf: true })], 9_500, 10_500, 'Speaker 0'))
      .toBe('Speaker 0');
  });

  it('fails closed when two people overlap without a dominant signal', () => {
    const timeline = [
      speaker({ displayName: 'Akbar Singh', observedAtMs: 10_000 }),
      speaker({ displayName: 'Parminder Kaur', observedAtMs: 10_050 }),
    ];
    expect(resolveZoomSpeakerForInterval(timeline, 9_500, 10_500, 'Speaker 0'))
      .toBe('Speaker 0');
  });

  it('ignores stale observations', () => {
    expect(resolveZoomSpeakerForInterval([speaker({ observedAtMs: 1_000 })], 9_500, 10_500, 'Speaker 0'))
      .toBe('Speaker 0');
  });

  it('keeps the evidence timeline bounded', () => {
    let timeline: ZoomSpeakerEvent[] = [];
    for (let index = 0; index < 120; index += 1) {
      timeline = appendZoomSpeakerEvidence(timeline, speaker({ observedAtMs: index }));
    }
    expect(timeline).toHaveLength(96);
    expect(timeline[0].observedAtMs).toBe(24);
  });
});
