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

// ---------------------------------------------------------------------------
// Image dimensions — parsed from the header bytes of the four sniffed image
// types at upload, stored on the blob record, carried in BlobInfo. Clients
// reserve the exact box (aspect-ratio placeholders) before a byte of the
// image arrives, so late loads never shift layout. Parse failures are fine:
// dimensions are a display hint, never a gate.
// ---------------------------------------------------------------------------

export function imageDimensions(bytes: Uint8Array, mime: string): { width: number; height: number } | undefined {
  try {
    const dims =
      mime === 'image/png' ? pngDims(bytes)
      : mime === 'image/gif' ? gifDims(bytes)
      : mime === 'image/jpeg' ? jpegDims(bytes)
      : mime === 'image/webp' ? webpDims(bytes)
      : undefined;
    if (!dims || dims.width <= 0 || dims.height <= 0) return undefined;
    return dims;
  } catch {
    return undefined;
  }
}

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);

/** IHDR is mandatory-first: width/height are big-endian u32 at bytes 16/20. */
function pngDims(b: Uint8Array): { width: number; height: number } | undefined {
  if (b.length < 24) return undefined;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

/** Logical screen descriptor: little-endian u16 at bytes 6/8. */
function gifDims(b: Uint8Array): { width: number; height: number } | undefined {
  if (b.length < 10) return undefined;
  return { width: u16le(b, 6), height: u16le(b, 8) };
}

/** Walk the segment chain to the first SOFn frame header. */
function jpegDims(b: Uint8Array): { width: number; height: number } | undefined {
  let i = 2; // past FF D8
  // An SOF read touches b[i+8]; anything shorter can't carry dimensions.
  while (i + 8 < b.length) {
    if (b[i] !== 0xff) return undefined;
    const marker = b[i + 1]!;
    // Standalone markers (no length): padding/RSTn/TEM.
    if (marker === 0xff) { i += 1; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; }
    const len = u16be(b, i + 2);
    if (len < 2) return undefined;
    // SOF0–SOF15 carry the frame size — except DHT/JPG/DAC (C4, C8, CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    i += 2 + len;
  }
  return undefined;
}

/** RIFF….WEBP, then the first chunk decides the flavor (VP8 /VP8L/VP8X). */
function webpDims(b: Uint8Array): { width: number; height: number } | undefined {
  if (b.length < 16) return undefined;
  const fourcc = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (fourcc === 'VP8X' && b.length >= 30) {
    // Extended header: canvas size minus one, u24 little-endian at 24/27.
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  if (fourcc === 'VP8L' && b.length >= 25) {
    // Lossless: signature byte 0x2F, then 14-bit fields packed little-endian.
    if (b[20] !== 0x2f) return undefined;
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (fourcc === 'VP8 ' && b.length >= 30) {
    // Lossy: key-frame start code at 23, then u16le size fields (14 bits used).
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return undefined;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  return undefined;
}
