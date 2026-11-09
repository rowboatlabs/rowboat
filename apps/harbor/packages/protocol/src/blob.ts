import { z } from 'zod';
import { BlobHash } from './ids.js';

// Spec §6: binary and large assets are content-addressed bytes held beside the
// database; version rows, change-sets, and messages carry {hash, size, mime} —
// never the bytes. Upload is a two-phase act: put the bytes (uploadBlob),
// then reference the hash (a message body's blob link, or proposeChange's
// blob variant). An unreferenced upload is an orphan awaiting GC (§12).

export const BlobInfo = z.object({
  hash: BlobHash,
  size: z.number().int().nonnegative(),
  /**
   * Determined at upload: the server sniffs magic bytes for well-known types and
   * falls back to the declared content-type. The stored value is authoritative
   * everywhere (serving headers, inline-vs-attachment) — never the client's
   * claim at read time, never the object store's metadata.
   */
  mime: z.string().min(1).max(255),
  /**
   * Pixel dimensions, parsed from the header bytes of sniffed images at
   * upload. A display hint for clients (reserve the exact box before the
   * bytes arrive — no layout shift), never a gate: absent for non-images,
   * unparseable headers, and blobs uploaded before this field existed.
   */
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type BlobInfo = z.infer<typeof BlobInfo>;

// Link labels can be prose; saves need a suffix from the stored MIME
// (2026-11-06). Preserve explicit extensions and unknown types.
const DOWNLOAD_EXTENSIONS: Readonly<Record<string, string>> = {
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'video/x-matroska': 'mkv', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
  'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/webm': 'webm',
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif',
  'application/pdf': 'pdf', 'application/zip': 'zip',
  'application/json': 'json', 'text/plain': 'txt', 'text/csv': 'csv',
  'text/markdown': 'md', 'text/html': 'html',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

export function blobDownloadName(name: string, mime: string): string {
  const trimmed = name.trim();
  const extension = DOWNLOAD_EXTENSIONS[mime.split(';')[0]!.trim().toLowerCase()];
  if (!extension || /\.[a-zA-Z0-9][^./\\\s]*$/.test(trimmed)) return trimmed;
  return `${trimmed.replace(/\.+$/, '') || 'download'}.${extension}`;
}
