// Blob mime policy. No upload allowlist and no deny-list — safety comes from
// how bytes are SERVED, never from refusing to store them: only sniffed-image
// types render inline; everything else is forced `attachment` + nosniff, so a
// stored HTML/SVG file can never execute in a browsing context (Buzz's
// stored-XSS posture, adopted). The mime recorded at upload is authoritative
// everywhere; a client's declared content-type is a fallback, not a fact.

const SNIFFS: Array<{ mime: string; test: (b: Uint8Array) => boolean }> = [
  { mime: 'image/jpeg', test: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  { mime: 'image/png', test: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { mime: 'image/gif', test: (b) => startsWith(b, [0x47, 0x49, 0x46, 0x38]) },
  {
    mime: 'image/webp',
    test: (b) => startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b.subarray(8), [0x57, 0x45, 0x42, 0x50]),
  },
  { mime: 'application/pdf', test: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]) },
];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((m, i) => bytes[i] === m);
}

/** Magic-byte sniff for the handful of types whose identity matters (inline rendering). */
export function sniffMime(bytes: Uint8Array): string | undefined {
  return SNIFFS.find((s) => s.test(bytes))?.mime;
}

const MIME_RE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;

/** A declared content-type, kept only if it parses as a bare mime (parameters stripped). */
export function sanitizeDeclaredMime(declared: string | undefined): string | undefined {
  const bare = declared?.split(';')[0]?.trim().toLowerCase();
  return bare && bare.length <= 255 && MIME_RE.test(bare) ? bare : undefined;
}

/** The stored verdict: sniff wins, declaration fills in, octet-stream otherwise. */
export function resolveMime(bytes: Uint8Array, declared: string | undefined): string {
  return sniffMime(bytes) ?? sanitizeDeclaredMime(declared) ?? 'application/octet-stream';
}

/** Inline only for image/* — and stored mimes are sniff-first, so a declared-only "image/png" that is really HTML still ships image/* headers + nosniff and cannot execute. */
export function servesInline(mime: string): boolean {
  return mime.startsWith('image/');
}

/**
 * Content-Disposition for a blob response. `name` is display-only (the client
 * passes it from the asset path or the link label); quotes/control chars and
 * path separators are stripped so it can never break the header or the save
 * path.
 */
export function dispositionFor(mime: string, name?: string): string {
  const base = servesInline(mime) ? 'inline' : 'attachment';
  const clean = name
    ?.replace(/[/\\]/g, '-')
    .replace(/[\x00-\x1f\x7f"%;]/g, '')
    .trim()
    .slice(0, 255);
  return clean ? `${base}; filename="${clean}"` : base;
}
