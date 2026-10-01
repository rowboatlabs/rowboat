import { CREDITS_PER_DOLLAR } from '@x/shared/dist/billing.js';

// Video, speech and music through Pixazo (architecture §3.5 "Les médias",
// decided 30/09/2026). A generation is charged to the same quota as text, at
// its price, before it is submitted: it costs at once what a long chat costs
// over hours, so it must fit in what is left, never overrun.
//
// Prices read on pixazo.ai model pages on 30/09/2026. The list price is kept
// where a promotion runs (Seedance 2.0 Mini): a promotion ends without
// notice, and the quota must never charge less than we pay.

export type MediaKind = 'video' | 'speech' | 'music';

/** What a person may ask; the model decides which fields it reads. */
export interface MediaRequest {
  model: string;
  prompt: string;
  /** Seconds, for video. */
  duration?: number;
  aspectRatio?: '16:9' | '9:16';
  /** Native sound on the video. */
  audio?: boolean;
}

export interface MediaModel {
  id: string;
  kind: MediaKind;
  displayName: string;
  /** Allowed durations in seconds, for video; the first is the default. */
  durations?: number[];
  maxPromptChars: number;
  /** Pixazo submit path and body. */
  submit(req: MediaRequest): { path: string; body: Record<string, unknown> };
  /** Our cost in dollars for this request, decided before submitting. */
  costUsd(req: MediaRequest): number;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** French speech runs about 15 characters a second; 12 keeps us on the safe side. */
const SPEECH_CHARS_PER_SECOND = 12;

function veoDuration(req: MediaRequest, durations: number[]): number {
  return req.duration && durations.includes(req.duration) ? req.duration : durations[0];
}

export const MEDIA_MODELS: MediaModel[] = [
  {
    id: 'seedance-mini',
    kind: 'video',
    displayName: 'Seedance 2.0 Mini',
    durations: [5, ...range(4, 30).filter((d) => d !== 5)],
    maxPromptChars: 2000,
    submit: (req) => ({
      path: '/seedance-2-0-mini/text-to-video',
      body: {
        content: [{ type: 'text', text: req.prompt }],
        duration: req.duration ?? 5,
        resolution: '720p',
        ratio: req.aspectRatio ?? '16:9',
        generate_audio: req.audio ?? false,
      },
    }),
    // 720p list price 0.0756 $/s (0.03024 during the promotion).
    costUsd: (req) => 0.0756 * (req.duration ?? 5),
  },
  {
    id: 'veo-fast',
    kind: 'video',
    displayName: 'Veo 3.1 Fast',
    durations: [8, 4, 6],
    maxPromptChars: 2000,
    submit: (req) => {
      const duration = veoDuration(req, [8, 4, 6]);
      return {
        path: '/veo31f/v1/veo-3.1-fast/generate',
        // 1080p exists only at 8 s; Pixazo refuses it shorter.
        body: { prompt: req.prompt, duration, resolution: duration === 8 ? '1080p' : '720p', aspect_ratio: req.aspectRatio ?? '16:9', generate_audio: req.audio ?? false },
      };
    },
    // 0.10 $/s without sound, 0.15 $/s with it.
    costUsd: (req) => (req.audio ? 0.15 : 0.1) * veoDuration(req, [8, 4, 6]),
  },
  {
    id: 'veo',
    kind: 'video',
    displayName: 'Veo 3.1',
    durations: [8, 4, 6],
    maxPromptChars: 2000,
    submit: (req) => ({
      path: '/veo/v1/text-to-video',
      // 720p only: 1080p costs half as much again for a phone screen.
      body: { prompt: req.prompt, duration: veoDuration(req, [8, 4, 6]), resolution: '720p', aspect_ratio: req.aspectRatio ?? '16:9', generate_audio: req.audio ?? true },
    }),
    // 0.40 $/s at 720p, sound included.
    costUsd: (req) => 0.4 * veoDuration(req, [8, 4, 6]),
  },
  {
    id: 'gemini-voice',
    kind: 'speech',
    displayName: 'Gemini 3.8 Flash TTS',
    maxPromptChars: 4000,
    submit: (req) => ({ path: '/gemini-3-8-flash-tts/v1/text-to-speech', body: { text: req.prompt } }),
    // 0.01728 $ a minute of speech, billed by the started minute.
    costUsd: (req) => 0.01728 * Math.ceil(req.prompt.length / SPEECH_CHARS_PER_SECOND / 60),
  },
  {
    id: 'lyria',
    kind: 'music',
    displayName: 'Lyria 3',
    maxPromptChars: 2000,
    submit: (req) => ({ path: '/lyria-3/v1/lyria-3/generate', body: { prompt: req.prompt } }),
    costUsd: () => 0.042,
  },
  {
    id: 'lyria-pro',
    kind: 'music',
    displayName: 'Lyria 3 Pro',
    maxPromptChars: 2000,
    submit: (req) => ({ path: '/lyria-3-pro/v1/lyria-3-pro/generate', body: { prompt: req.prompt } }),
    costUsd: () => 0.084,
  },
];

export function mediaModel(id: string): MediaModel | null {
  return MEDIA_MODELS.find((m) => m.id === id) ?? null;
}

export type ParsedRequest = { ok: true; model: MediaModel; req: MediaRequest } | { ok: false; message: string };

/** Validates a request body against the model it names. */
export function parseMediaRequest(raw: unknown): ParsedRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'Expected a JSON object' };
  const b = raw as Record<string, unknown>;
  const model = typeof b.model === 'string' ? mediaModel(b.model) : null;
  if (!model) return { ok: false, message: `Unknown model; one of: ${MEDIA_MODELS.map((m) => m.id).join(', ')}` };
  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
  if (!prompt) return { ok: false, message: 'A prompt is required' };
  if (prompt.length > model.maxPromptChars) return { ok: false, message: `Prompt longer than ${model.maxPromptChars} characters` };
  const req: MediaRequest = { model: model.id, prompt };
  if (b.duration !== undefined) {
    if (!model.durations) return { ok: false, message: `${model.id} takes no duration` };
    if (typeof b.duration !== 'number' || !model.durations.includes(b.duration)) {
      return { ok: false, message: `Duration must be one of: ${[...model.durations].sort((x, y) => x - y).join(', ')}` };
    }
    req.duration = b.duration;
  }
  if (b.aspect_ratio !== undefined) {
    if (b.aspect_ratio !== '16:9' && b.aspect_ratio !== '9:16') return { ok: false, message: 'aspect_ratio must be 16:9 or 9:16' };
    req.aspectRatio = b.aspect_ratio;
  }
  if (b.audio !== undefined) {
    if (typeof b.audio !== 'boolean') return { ok: false, message: 'audio must be a boolean' };
    req.audio = b.audio;
  }
  return { ok: true, model, req };
}

export function mediaCredits(model: MediaModel, req: MediaRequest): number {
  return Math.ceil(model.costUsd(req) * CREDITS_PER_DOLLAR);
}
