import { describe, expect, it } from 'vitest';
import { parseByteRange, rangedResponse } from './byte-range.js';

describe('parseByteRange', () => {
  it('reads closed, open and suffix ranges', () => {
    expect(parseByteRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
    expect(parseByteRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('ignores what it does not serve, and refuses a start past the end', () => {
    expect(parseByteRange(null, 1000)).toBeNull();
    expect(parseByteRange('bytes=0-1,5-9', 1000)).toBeNull();
    expect(parseByteRange('items=0-1', 1000)).toBeNull();
    expect(parseByteRange('bytes=9-1', 1000)).toBeNull();
    expect(parseByteRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=-0', 1000)).toBe('unsatisfiable');
  });
});

describe('rangedResponse', () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  it('serves the slice as 206', async () => {
    const res = rangedResponse(bytes, 'bytes=2-4', { 'content-type': 'video/mp4' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([2, 3, 4]);
  });

  it('serves everything, advertising ranges, when none is asked', async () => {
    const res = rangedResponse(bytes, null, {});
    expect(res.status).toBe(200);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect((await res.arrayBuffer()).byteLength).toBe(10);
  });

  it('answers 416 past the end', () => {
    const res = rangedResponse(bytes, 'bytes=10-', {});
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */10');
  });
});
