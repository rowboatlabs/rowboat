const SEARCH_ENGINE_BASE_URL = 'https://www.google.com/search?q=';

const HAS_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const IPV4_HOST_RE = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:\/.*)?$/;
const LOCALHOST_RE = /^localhost(?::\d+)?(?:\/.*)?$/i;
const DOMAIN_LIKE_RE = /^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:\/.*)?$/i;

export function normalizeNavigationTarget(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) {
    throw new Error('Navigation target cannot be empty.');
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:')
    || lower.startsWith('file://')
    || lower.startsWith('chrome://')
    || lower.startsWith('chrome-extension://')
  ) {
    throw new Error('That URL scheme is not allowed in the embedded browser.');
  }

  if (HAS_SCHEME_RE.test(trimmed)) {
    return trimmed;
  }

  const looksLikeHost =
    LOCALHOST_RE.test(trimmed)
    || DOMAIN_LIKE_RE.test(trimmed)
    || IPV4_HOST_RE.test(trimmed);

  if (looksLikeHost && !/\s/.test(trimmed)) {
    const scheme = LOCALHOST_RE.test(trimmed) || IPV4_HOST_RE.test(trimmed)
      ? 'http://'
      : 'https://';
    return `${scheme}${trimmed}`;
  }

  return `${SEARCH_ENGINE_BASE_URL}${encodeURIComponent(trimmed)}`;
}
