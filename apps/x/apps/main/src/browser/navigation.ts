const SEARCH_ENGINE_BASE_URL = 'https://www.google.com/search?q=';

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

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return trimmed;
  }

  const looksLikeHost =
    trimmed.startsWith('localhost')
    || /^[\w.-]+\.[a-z]{2,}/i.test(trimmed)
    || /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:\/.*)?$/.test(trimmed);

  if (looksLikeHost && !/\s/.test(trimmed)) {
    return trimmed;
  }

  return `${SEARCH_ENGINE_BASE_URL}${encodeURIComponent(trimmed)}`;
}
