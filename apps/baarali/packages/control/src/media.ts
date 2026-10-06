// Video, speech and music through Pixazo (architecture §3.5 "Les médias").
// A generation is paid from the account's media credits, bought in packs,
// not from the text quota (decided 01/10/2026): one video costs what hours
// of chat cost, and a quota sized for text would either refuse it or be
// emptied by it. It is charged before it is submitted, at its full price.
//
// Prices read on pixazo.ai model pages on 30/09/2026, the Chinese models on
// 06/10/2026. The list price is kept where a promotion runs (Seedance 2.0
// Mini): a promotion ends without notice, and the quota must never charge
// less than we pay.
//
// Chinese models first (decided 06/10/2026): the best of them for each kind,
// then the cheapest American ones. The order is the list's, so the agent
// reads them first.

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
  /** The one to prefer for its kind until the console says otherwise. */
  recommended?: boolean;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** French speech runs about 15 characters a second; 12 keeps us on the safe side. */
const SPEECH_CHARS_PER_SECOND = 12;

function veoDuration(req: MediaRequest, durations: number[]): number {
  return req.duration && durations.includes(req.duration) ? req.duration : durations[0];
}

/**
 * Seedance bills the seconds it outputs, rounded up, and a clip runs about
 * 0.1 s over what was asked: 5 s asked bills 6 (Pixazo, Seedance 2.0 Mini).
 */
const seedanceSeconds = (req: MediaRequest) => (req.duration ?? 5) + 1;

export const MEDIA_MODELS: MediaModel[] = [
  {
    id: 'hailuo-turbo',
    kind: 'video',
    displayName: 'Hailuo H3 Max Turbo (MiniMax)',
    durations: range(5, 15),
    maxPromptChars: 2000,
    submit: (req) => ({
      path: '/minimax-hailuo-h3-max-turbo/v1/text-to-video',
      body: { prompt: req.prompt, duration: req.duration ?? 5, resolution: '768P', aspect_ratio: req.aspectRatio ?? '16:9', prompt_expansion_mode: 'balanced' },
    }),
    // 0.04 $/s at 768P; no sound.
    costUsd: (req) => 0.04 * (req.duration ?? 5),
    recommended: true,
  },
  {
    id: 'seedance-2-5',
    kind: 'video',
    displayName: 'Seedance 2.5 (ByteDance)',
    durations: [5, ...range(4, 30).filter((d) => d !== 5)],
    maxPromptChars: 2000,
    submit: (req) => ({
      path: '/seedance-2-5/v1/text-to-video',
      body: {
        content: [{ type: 'text', text: req.prompt }],
        duration: req.duration ?? 5,
        resolution: '720p',
        ratio: req.aspectRatio ?? '16:9',
        generate_audio: req.audio ?? false,
      },
    }),
    // 0.231 $/s at 720p, sound included.
    costUsd: (req) => 0.231 * seedanceSeconds(req),
  },
  {
    id: 'kling-3',
    kind: 'video',
    displayName: 'Kling 3.0 (Kuaishou)',
    durations: [5, ...range(3, 15).filter((d) => d !== 5)],
    maxPromptChars: 2500,
    submit: (req) => ({
      path: '/kling-3-0-text-to-video-standard/v1/kling-3-0-text-to-video-standard-request',
      // Its sound speaks Chinese or English only: off unless asked.
      body: { prompt: req.prompt, duration: String(req.duration ?? 5), aspect_ratio: req.aspectRatio ?? '16:9', generate_audio: req.audio ?? false },
    }),
    // 0.14 $/s, sound included.
    costUsd: (req) => 0.14 * (req.duration ?? 5),
  },
  {
    id: 'wan-3',
    kind: 'video',
    displayName: 'Wan 3.0 (Alibaba)',
    durations: [5, ...range(2, 30).filter((d) => d !== 5)],
    maxPromptChars: 2000,
    submit: (req) => ({
      path: '/wan-3-0-video/v1/text-to-video',
      body: { prompt: req.prompt, duration: req.duration ?? 5, resolution: '720P', ratio: req.aspectRatio ?? '16:9', audio: req.audio ?? true },
    }),
    // 0.085 $/s at 720P, sound included.
    costUsd: (req) => 0.085 * (req.duration ?? 5),
  },
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
    costUsd: (req) => 0.0756 * seedanceSeconds(req),
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
    id: 'minimax-voice',
    kind: 'speech',
    displayName: 'MiniMax Speech 2.8 Turbo',
    maxPromptChars: 4000,
    submit: (req) => ({
      path: '/minimax-speech-2-8-turbo/v1/minimax-speech-2-8-turbo-request',
      body: { prompt: req.prompt, output_format: 'hex', voice_setting: { voice_id: 'Wise_Woman' }, language_boost: 'auto' },
    }),
    // 0.06 $ per 1,000 characters, counted by the started thousand.
    costUsd: (req) => 0.06 * Math.ceil(req.prompt.length / 1000),
    recommended: true,
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
    id: 'minimax-music',
    kind: 'music',
    displayName: 'MiniMax Music 3.0',
    maxPromptChars: 2000,
    // Instrumental: the jingles under a video; lyrics would come in any language.
    submit: (req) => ({ path: '/minimax-music-3-0/v1/text-to-music', body: { prompt: req.prompt, is_instrumental: true, format: 'mp3' } }),
    // 0.15 $ a track, whatever its length.
    costUsd: () => 0.15,
    recommended: true,
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

/**
 * One media credit is one cent of our cost (decided 01/10/2026): whole
 * numbers a person can read ("38 credits"), where the text quota's units
 * would show millions.
 */
export const MEDIA_CREDIT_USD = 0.01;

/** Credits for a cost in dollars, rounded up: never charge less than we pay. */
export function creditsForUsd(usd: number): number {
  // Rounded to a millionth first: 0.4 * 8 is 3.2000000000000006 in floating point.
  return Math.ceil(Math.round(usd * 1e6) / (MEDIA_CREDIT_USD * 1e6));
}

export function mediaCredits(model: MediaModel, req: MediaRequest): number {
  return creditsForUsd(model.costUsd(req));
}
