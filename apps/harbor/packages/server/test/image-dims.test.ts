import { describe, expect, it } from 'vitest';
import { imageDimensions } from '../src/mime.js';

// Header-byte dimension parsing for the four sniffed image types. Fixtures are
// handcrafted headers — the parser reads structure, never pixel data, and a
// malformed header must yield undefined (dimensions are a hint, not a gate).

function bytes(...parts: (number[] | string)[]): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'string') for (const ch of p) out.push(ch.charCodeAt(0));
    else out.push(...p);
  }
  return new Uint8Array(out);
}

const u32be = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16be = (n: number) => [(n >>> 8) & 0xff, n & 0xff];
const u16le = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
const u24le = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];

describe('imageDimensions', () => {
  it('png: IHDR width/height', () => {
    const png = bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a], u32be(13), 'IHDR', u32be(640), u32be(480));
    expect(imageDimensions(png, 'image/png')).toEqual({ width: 640, height: 480 });
  });

  it('gif: logical screen descriptor', () => {
    const gif = bytes('GIF89a', u16le(320), u16le(200));
    expect(imageDimensions(gif, 'image/gif')).toEqual({ width: 320, height: 200 });
  });

  it('jpeg: walks segments to the first SOF frame header', () => {
    const jpeg = bytes(
      [0xff, 0xd8], // SOI
      [0xff, 0xe0], u16be(16), new Array(14).fill(0), // APP0, 16-byte segment
      [0xff, 0xc0], u16be(17), [8], u16be(1080), u16be(1920), // SOF0: precision, height, width
    );
    expect(imageDimensions(jpeg, 'image/jpeg')).toEqual({ width: 1920, height: 1080 });
  });

  it('jpeg: skips DHT (C4) — it is not a frame header', () => {
    const jpeg = bytes(
      [0xff, 0xd8],
      [0xff, 0xc4], u16be(4), [0, 0], // DHT
      [0xff, 0xc2], u16be(17), [8], u16be(50), u16be(100), // progressive SOF2
    );
    expect(imageDimensions(jpeg, 'image/jpeg')).toEqual({ width: 100, height: 50 });
  });

  it('webp: VP8L (lossless) packed 14-bit fields', () => {
    const bits = (100 - 1) | ((50 - 1) << 14);
    const webp = bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8L', [0, 0, 0, 0], [0x2f], [
      bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff,
    ], new Array(4).fill(0));
    expect(imageDimensions(webp, 'image/webp')).toEqual({ width: 100, height: 50 });
  });

  it('webp: VP8X (extended) canvas size', () => {
    const webp = bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8X', [0, 0, 0, 0], [0], [0, 0, 0], u24le(799), u24le(599));
    expect(imageDimensions(webp, 'image/webp')).toEqual({ width: 800, height: 600 });
  });

  it('webp: VP8 (lossy) frame size after the key-frame start code', () => {
    const webp = bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8 ', [0, 0, 0, 0], [0, 0, 0], [0x9d, 0x01, 0x2a], u16le(240), u16le(180));
    expect(imageDimensions(webp, 'image/webp')).toEqual({ width: 240, height: 180 });
  });

  it('non-images, truncated headers, and garbage yield undefined', () => {
    expect(imageDimensions(bytes('%PDF-1.4'), 'application/pdf')).toBeUndefined();
    expect(imageDimensions(bytes([0x89], 'PNG'), 'image/png')).toBeUndefined();
    expect(imageDimensions(bytes([0xff, 0xd8], [0x00, 0x11]), 'image/jpeg')).toBeUndefined();
    expect(imageDimensions(bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'XXXX', new Array(20).fill(0)), 'image/webp')).toBeUndefined();
    expect(imageDimensions(new Uint8Array(0), 'image/gif')).toBeUndefined();
  });
});
