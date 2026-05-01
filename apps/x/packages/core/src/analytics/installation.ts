import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkDir } from '../config/config.js';

const INSTALLATION_PATH = path.join(WorkDir, 'config', 'installation.json');

let cached: string | null = null;

export function getInstallationId(): string {
  if (cached) return cached;
  try {
    if (fs.existsSync(INSTALLATION_PATH)) {
      const raw = fs.readFileSync(INSTALLATION_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as { installationId?: string };
      if (parsed.installationId && typeof parsed.installationId === 'string') {
        cached = parsed.installationId;
        return cached;
      }
    }
  } catch (err) {
    console.error('[Analytics] Failed to read installation.json:', err);
  }

  const id = randomUUID();
  try {
    const dir = path.dirname(INSTALLATION_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(INSTALLATION_PATH, JSON.stringify({ installationId: id }, null, 2));
  } catch (err) {
    console.error('[Analytics] Failed to write installation.json:', err);
  }
  cached = id;
  return id;
}
