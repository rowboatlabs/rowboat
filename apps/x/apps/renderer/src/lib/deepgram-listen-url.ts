/**
 * Merge Deepgram query params onto a Rowboat WebSocket base URL from account config.
 */
export function buildDeepgramListenUrl(baseWsUrl: string, params: URLSearchParams): string {
  const url = new URL("/deepgram/v1/listen", baseWsUrl);
  for (const [key, value] of params) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
