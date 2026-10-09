// Turn transport failures into something a person can read. Offline shows up
// as a fetch TypeError ("Network request failed") or a timeout/abort; server
// errors keep their own message.

const NETWORK = /network request failed|internet connection appears to be offline|offline|timed? ?out|aborted|failed to fetch|could not connect/i;

export function isNetworkError(err: unknown): boolean {
  // The shared client (2026-10-09) wraps a failed fetch as code 'unreachable'.
  if ((err as { code?: unknown } | null)?.code === 'unreachable') return true;
  const message = err instanceof Error ? err.message : String(err ?? '');
  return NETWORK.test(message);
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? '');
}

/** One line for a banner: offline → a calm sentence, anything else → the server's words. */
export function friendlyError(err: unknown, offline = "You're offline. Showing what's saved on this phone."): string {
  if (isNetworkError(err)) return offline;
  const text = errorText(err).trim();
  return text || 'Something went wrong. Pull down to try again.';
}
