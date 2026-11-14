import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkDir } from '../config/config.js';

export async function moveToTrash(filePath: string): Promise<string> {
  const trashDir = path.join(WorkDir, '.trash');
  await fs.mkdir(trashDir, { recursive: true });
  // 2026-11-09: reserve a directory atomically so concurrent removals through
  // either API cannot overwrite an item with the same timestamp and name.
  const reserved = await fs.mkdtemp(path.join(trashDir, `${Date.now()}-`));
  const destination = path.join(reserved, path.basename(filePath));
  try {
    await fs.rename(filePath, destination);
  } catch (error) {
    await fs.rmdir(reserved).catch(() => {});
    throw error;
  }
  return destination;
}
