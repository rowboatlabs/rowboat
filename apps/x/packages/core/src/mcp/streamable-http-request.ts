export const STREAMABLE_HTTP_ACCEPT = 'application/json, text/event-stream';

export function streamableHttpRequestInit(headers?: Record<string, string>): RequestInit {
  return {
    headers: {
      ...headers,
      Accept: STREAMABLE_HTTP_ACCEPT,
    },
  };
}
