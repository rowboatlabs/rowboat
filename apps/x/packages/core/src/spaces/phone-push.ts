import fs from 'node:fs';
import path from 'node:path';
import { WorkDir } from '../config/config.js';

// Phone push registration (the Mac side). Paired phones register an Expo
// push token + a notify level over RPC. The Mac used to RELAY pushes from its
// mention watcher as a stopgap; the watcher was removed 2026-09-09 (the
// client-side notification-level module is gone — notification policy is
// moving to the org, and Harbor already sends pushes itself, PUSH_PLAN.md),
// so this file now only keeps the registrations the phone sends. Whether
// they stay meaningful is a later-layer decision (push + phone).
//
// Levels (phone-side, global): 'off' nothing · 'mentions' @you/@here ·
// 'dms' mentions + direct messages · 'all' everything.

export type PhonePushLevel = 'off' | 'mentions' | 'dms' | 'all';

interface PhoneRegistration {
  token: string;
  level: PhonePushLevel;
  deviceName?: string;
  updatedAt: string;
}

const REG_FILE = path.join(WorkDir, 'config', 'phone_push.json');

function load(): Record<string, PhoneRegistration> {
  try {
    const parsed = JSON.parse(fs.readFileSync(REG_FILE, 'utf8')) as { version: 1; phones: Record<string, PhoneRegistration> };
    return parsed.phones ?? {};
  } catch {
    return {};
  }
}

function save(phones: Record<string, PhoneRegistration>): void {
  const tmp = `${REG_FILE}.tmp`;
  fs.mkdirSync(path.dirname(REG_FILE), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, phones }, null, 2));
  fs.renameSync(tmp, REG_FILE);
}

export function registerPhonePush(input: { token: string; level: PhonePushLevel; deviceName?: string }): void {
  const phones = load();
  phones[input.token] = { ...input, updatedAt: new Date().toISOString() };
  save(phones);
}
