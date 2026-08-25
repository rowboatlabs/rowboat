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
   * Determined at upload: the org sniffs magic bytes for well-known types and
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
