import fs from 'node:fs';
import path from 'node:path';
import { WorkDir } from '../config/config.js';
import type { MentionHit } from './mention-watch.js';

// Phone push relay (v1: the Mac is the sender). Paired phones register an
// Expo push token + a notify level over RPC; mention-watch calls
// sendPhonePush beside its desktop notification, and each registered phone
// gets an Expo push if ITS level wants this hit. Hosted (org-side) sending
// is the eventual home — this rides the same watcher the desktop trusts.
//
// Levels (phone-side, global): 'off' nothing · 'mentions' @you/@here ·
// 'dms' mentions + direct messages · 'all' everything the watcher surfaces
// (kind 'message' hits exist only where the Mac's per-space level is 'all').

export type PhonePushLevel = 'off' | 'mentions' | 'dms' | 'all';

interface PhoneRegistration {
  token: string;
  level: PhonePushLevel;
  deviceName?: string;
  updatedAt: string;
}

const REG_FILE = path.join(WorkDir, 'config', 'phone_push.json');
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

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

function wants(level: PhonePushLevel, hit: MentionHit): boolean {
  if (level === 'off') return false;
  const mention = hit.kind === 'you' || hit.kind === 'here';
  if (level === 'mentions') return mention;
  if (level === 'dms') return mention || Boolean(hit.direct);
  return true; // 'all'
}

/** Fire-and-forget: push this hit to every registered phone whose level wants it. */
export async function sendPhonePush(hit: MentionHit, text: { title: string; body: string }): Promise<void> {
  const phones = load();
  const targets = Object.values(phones).filter((p) => wants(p.level, hit));
  if (targets.length === 0) return;
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        targets.map((p) => ({
          to: p.token,
          title: text.title,
          body: text.body,
          sound: 'default',
          data: { kind: 'space', orgId: hit.orgId, spaceId: hit.spaceId, threadRootId: hit.threadRootId },
        })),
      ),
    });
    const json = (await res.json().catch(() => null)) as { data?: { status: string; details?: { error?: string } }[] } | null;
    // A token whose device uninstalled the app is dead — drop it.
    const dead = new Set<string>();
    json?.data?.forEach((ticket, i) => {
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') dead.add(targets[i]!.token);
    });
    if (dead.size > 0) {
      const next = load();
      for (const t of dead) delete next[t];
      save(next);
    }
  } catch (err) {
    console.error('[phone-push] send failed:', err);
  }
}
