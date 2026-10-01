import { describe, expect, it } from 'vitest';
import { CREDITS_PER_DOLLAR } from '@x/shared/dist/billing.js';
import { mediaCredits, mediaModel, parseMediaRequest, type MediaRequest } from '../src/media.js';

const cost = (req: MediaRequest) => mediaModel(req.model)!.costUsd(req);

describe('media prices (pixazo.ai, 30/09/2026)', () => {
  it('charges video by the second, with sound where it costs more', () => {
    expect(cost({ model: 'veo-fast', prompt: 'x' })).toBeCloseTo(0.8);
    expect(cost({ model: 'veo-fast', prompt: 'x', duration: 4, audio: true })).toBeCloseTo(0.6);
    expect(cost({ model: 'veo', prompt: 'x' })).toBeCloseTo(3.2);
    expect(cost({ model: 'seedance-mini', prompt: 'x' })).toBeCloseTo(0.378);
  });

  it('charges speech by the started minute, music by the song', () => {
    expect(cost({ model: 'gemini-voice', prompt: 'a'.repeat(700) })).toBeCloseTo(0.01728);
    expect(cost({ model: 'gemini-voice', prompt: 'a'.repeat(721) })).toBeCloseTo(0.03456);
    expect(cost({ model: 'lyria-pro', prompt: 'x' })).toBeCloseTo(0.084);
  });

  it('rounds credits up, never down', () => {
    const m = mediaModel('lyria')!;
    expect(mediaCredits(m, { model: 'lyria', prompt: 'x' })).toBe(Math.ceil(0.042 * CREDITS_PER_DOLLAR));
  });

  it('asks Veo for 1080p only at 8 seconds', () => {
    const veo = mediaModel('veo-fast')!;
    expect(veo.submit({ model: 'veo-fast', prompt: 'x' }).body.resolution).toBe('1080p');
    expect(veo.submit({ model: 'veo-fast', prompt: 'x', duration: 6 }).body.resolution).toBe('720p');
  });
});

describe('parseMediaRequest', () => {
  it('accepts a valid request and keeps only known fields', () => {
    const r = parseMediaRequest({ model: 'veo-fast', prompt: ' Un marché à Ouaga ', duration: 4, aspect_ratio: '9:16', audio: true, extra: 1 });
    expect(r).toMatchObject({ ok: true, req: { model: 'veo-fast', prompt: 'Un marché à Ouaga', duration: 4, aspectRatio: '9:16', audio: true } });
  });

  it.each([
    [null, 'Expected a JSON object'],
    [{ model: 'nope', prompt: 'x' }, 'Unknown model'],
    [{ model: 'lyria', prompt: '  ' }, 'A prompt is required'],
    [{ model: 'lyria', prompt: 'x', duration: 8 }, 'takes no duration'],
    [{ model: 'veo-fast', prompt: 'x', duration: 5 }, 'Duration must be one of: 4, 6, 8'],
    [{ model: 'veo-fast', prompt: 'x', aspect_ratio: '4:3' }, 'aspect_ratio'],
    [{ model: 'veo-fast', prompt: 'x', audio: 'yes' }, 'audio must be a boolean'],
    [{ model: 'gemini-voice', prompt: 'a'.repeat(4001) }, 'longer than 4000'],
  ])('refuses %j', (body, message) => {
    const r = parseMediaRequest(body);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain(message);
  });
});
