// One `Range: bytes=…` request against a blob of known size (2026-11-04): a
// video in a message plays inline, and seeking asks for the bytes it jumps
// to. Several ranges at once, or a header that doesn't parse, are ignored
// and the whole blob is served, as RFC 9110 §14.2 allows.

export type ByteRange = { start: number; end: number } | 'unsatisfiable';

/** The inclusive byte range a header asks for; null when it should be ignored. */
export function parseByteRange(header: string | null | undefined, size: number): ByteRange | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') {
    // A suffix: the last n bytes.
    const n = Number(m[2]);
    if (n === 0) return 'unsatisfiable';
    return size === 0 ? 'unsatisfiable' : { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size) return 'unsatisfiable';
  if (end < start) return null;
  return { start, end };
}

/** A blob's bytes as the Range header asks: 206 with the slice, 416, or the whole thing. */
export function rangedResponse(bytes: Uint8Array, rangeHeader: string | null, headers: Record<string, string>): Response {
  const size = bytes.byteLength;
  const range = parseByteRange(rangeHeader, size);
  const base = { ...headers, 'accept-ranges': 'bytes' };
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${size}` } });
  }
  if (!range) return new Response(new Uint8Array(bytes), { headers: { ...base, 'content-length': String(size) } });
  return new Response(bytes.slice(range.start, range.end + 1), {
    status: 206,
    headers: { ...base, 'content-range': `bytes ${range.start}-${range.end}/${size}`, 'content-length': String(range.end - range.start + 1) },
  });
}
