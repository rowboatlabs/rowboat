import { describe, expect, it } from 'vitest';
import { STREAMABLE_HTTP_ACCEPT, streamableHttpRequestInit } from './streamable-http-request.js';

describe('streamableHttpRequestInit', () => {
  it('sets the MCP streamable HTTP Accept header', () => {
    expect(streamableHttpRequestInit()).toEqual({
      headers: {
        Accept: STREAMABLE_HTTP_ACCEPT,
      },
    });
  });

  it('merges configured headers without dropping Accept', () => {
    expect(streamableHttpRequestInit({ Authorization: 'Bearer token' })).toEqual({
      headers: {
        Authorization: 'Bearer token',
        Accept: STREAMABLE_HTTP_ACCEPT,
      },
    });
  });

  it('overrides a caller-provided Accept value with the required value', () => {
    expect(streamableHttpRequestInit({ Accept: 'application/json' })).toEqual({
      headers: {
        Accept: STREAMABLE_HTTP_ACCEPT,
      },
    });
  });
});
