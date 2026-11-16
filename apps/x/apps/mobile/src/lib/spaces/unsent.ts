import { loadValue, peekValue, removeValue, saveValue } from '@/lib/spaces/cache';

// Unsent messages survive leaving the chat (2026-11-03). The composer clears
// the box the moment you tap send; if the send then failed after you had left
// the screen, the draft lived only in the unmounted composer and was gone —
// "what I posted from mobile has vanished". Now a send is saved on the phone
// under its chat first and removed only when the server confirms it; the next
// open of that chat puts it back in the box as "Not sent". Same rule as
// Slack/WhatsApp drafts. Stored in the spaces cache, so sign-out wipes it.

export interface UnsentDraft {
  /** Which send wrote this slot: a send that confirms late clears only its own. */
  id: string;
  text: string;
  picked: [string, { label: string; id: string }][];
  attachments: { key: string; uri: string; md: string; video: boolean; file?: string }[];
}

const slot = (chat: string) => `unsent:${chat}`;

/** Sends still waiting on the server, by chat — a reopened chat waits for them before restoring. */
const inFlight = new Map<string, Promise<unknown>>();

export function newUnsentId(): string {
  return `${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function saveUnsent(chat: string, draft: UnsentDraft): void {
  saveValue(slot(chat), draft);
}

/** Clears only if the writer with this id still owns the slot. */
export function clearUnsent(chat: string, id: string): void {
  if (peekValue<UnsentDraft>(slot(chat))?.id !== id) return;
  removeValue(slot(chat));
}

export function trackSend(chat: string, settled: Promise<unknown>): void {
  inFlight.set(chat, settled);
  const done = () => {
    if (inFlight.get(chat) === settled) inFlight.delete(chat);
  };
  settled.then(done, done);
}

export async function loadUnsent(chat: string): Promise<UnsentDraft | undefined> {
  await inFlight.get(chat)?.catch(() => {});
  return loadValue<UnsentDraft>(slot(chat));
}
