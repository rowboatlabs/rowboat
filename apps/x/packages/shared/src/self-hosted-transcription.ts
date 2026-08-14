export const SELF_HOSTED_TRANSCRIPTION_PROTOCOL = 'transcribe-stream-v1' as const;

export function normalizeSelfHostedTranscriptionUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Self-hosted transcription URL is invalid');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Self-hosted transcription URL cannot contain credentials, query parameters, or fragments');
  }
  const loopback = url.hostname === '127.0.0.1'
    || url.hostname === 'localhost'
    || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Self-hosted transcription requires HTTPS or an HTTP loopback URL');
  }
  return value;
}

export function validateSelfHostedTranscriptionToken(raw: string): string {
  const token = raw.trim();
  if (token.length < 32 || token.length > 512 || /\s/.test(token)) {
    throw new Error('Self-hosted transcription token must be 32-512 non-whitespace characters');
  }
  return token;
}

export function validateSelfHostedTranscriptionLanguage(raw: unknown): string {
  if (raw === undefined) return 'en';
  if (typeof raw !== 'string' || !/^(auto|[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?)$/.test(raw)) {
    throw new Error('Self-hosted transcription language is invalid');
  }
  return raw;
}
