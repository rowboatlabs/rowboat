import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// A preview grants access to one selected file, never to an arbitrary URL path.
const previews = new Map<string, { owner: number; path: string }>();
export async function createFilePreview(owner: number, filePath: string) {
  const realPath = await fs.realpath(filePath);
  const stat = await fs.stat(realPath);
  if (!stat.isFile()) throw new Error('Only files can be previewed.');
  const token = randomUUID();
  previews.set(token, { owner, path: realPath });
  return { url: `app://file-preview/${token}`, path: realPath, name: path.basename(realPath), size: stat.size, mtimeMs: stat.mtimeMs };
}
export function resolveFilePreview(url: string): string | undefined {
  const parsed = new URL(url);
  return parsed.host === 'file-preview' ? previews.get(parsed.pathname.slice(1))?.path : undefined;
}
export function releaseFilePreview(owner: number, url: string) {
  const token = new URL(url).pathname.slice(1);
  if (previews.get(token)?.owner === owner) previews.delete(token);
}
export function releaseFilePreviews(owner: number) {
  for (const [token, entry] of previews) if (entry.owner === owner) previews.delete(token);
}
