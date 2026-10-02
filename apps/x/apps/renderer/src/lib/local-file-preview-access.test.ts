// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFilePreview, releaseFilePreview, releaseFilePreviews, resolveFilePreview } from '../../../main/src/file-previews';

let directory: string;
afterEach(async () => {
  releaseFilePreviews(1);
  releaseFilePreviews(2);
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

it('grants access to one file and only lets its owner release it', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rowboat-preview-'));
  const file = path.join(directory, 'report.pdf');
  await fs.writeFile(file, 'preview');
  const preview = await createFilePreview(1, file);
  expect(resolveFilePreview(preview.url)).toBe(await fs.realpath(file));
  expect(resolveFilePreview('app://file-preview/unknown')).toBeUndefined();
  expect(resolveFilePreview(`${preview.url}/report.pdf`)).toBeUndefined();
  releaseFilePreview(2, preview.url);
  expect(resolveFilePreview(preview.url)).toBeDefined();
  releaseFilePreview(1, preview.url);
  expect(resolveFilePreview(preview.url)).toBeUndefined();
});

it('releases a window’s previews without revoking another window’s files', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rowboat-preview-'));
  const file = path.join(directory, 'report.pdf');
  await fs.writeFile(file, 'preview');
  const first = await createFilePreview(1, file);
  const second = await createFilePreview(2, file);
  releaseFilePreviews(1);
  expect(resolveFilePreview(first.url)).toBeUndefined();
  expect(resolveFilePreview(second.url)).toBeDefined();
  await expect(createFilePreview(1, directory)).rejects.toThrow('Only files');
  await expect(createFilePreview(1, path.join(directory, 'missing'))).rejects.toThrow();
});
