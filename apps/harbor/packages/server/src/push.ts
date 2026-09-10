import type { Message, Space } from '@rowboat/spaces-protocol';
import type { Notification, NotifyKind } from './notify.js';
import type { PushLevel, Store } from './store.js';

// Push notifications (PUSH_PLAN.md): the phone half of delivery. The
// DECISION lives in notify.ts (one per message, shared with the desktop's
// `notify` frame); this module gates each decided row on the member's
// per-member level, fans out to their Expo tokens in fire-and-forget batches,
// and prunes dead tokens via tickets and a delayed receipts check. It parses
// no text and classifies nothing.

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
/** Expo recommends ~15 min before receipts are reliably available. */
const RECEIPT_DELAY_MS = 15 * 60_000;
const BATCH = 100;

/** Members never registered a level — Slack's default: DMs + mentions. */
export const DEFAULT_PUSH_LEVEL: PushLevel = 'dms';

/**
 * Slack's tree, cut to v1. Being addressed (a mention, @here) or a reply in
 * a thread you follow passes every level but `off` — Slack's "replies to
 * threads I'm following" is a default-on toggle beside the level, not under
 * it. A DM needs `dms`; a plain message needs `all`.
 */
export function levelAllows(level: PushLevel, kind: NotifyKind): boolean {
  if (level === 'off') return false;
  if (kind === 'message') return level === 'all';
  if (kind === 'dm') return level === 'dms' || level === 'all';
  return true;
}

interface ExpoTicket {
  status: string;
  id?: string;
  details?: { error?: string };
}

export interface PushSenderOptions {
  fetchImpl?: typeof fetch;
  /** Test knob: 0 disables the delayed receipts check. */
  receiptDelayMs?: number;
}

export class PushSender {
  private readonly fetchImpl: typeof fetch;
  private readonly receiptDelayMs: number;

  constructor(
    private readonly store: Store,
    private readonly orgId: string,
    options: PushSenderOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.receiptDelayMs = options.receiptDelayMs ?? RECEIPT_DELAY_MS;
  }

  /**
   * Deliver the org's decided rows (notify.ts) to the recipients' phones,
   * each gated on that member's level. Throws on transport failure; the
   * Notifier catches and logs.
   */
  async send(space: Space, message: Message, rows: readonly Notification[]): Promise<void> {
    const sends: { to: string; title: string; body: string }[] = [];
    for (const row of rows) {
      const level = (await this.store.getPushLevel(row.memberId)) ?? DEFAULT_PUSH_LEVEL;
      if (!levelAllows(level, row.kind)) continue;
      const tokens = await this.store.listPushTokens(row.memberId);
      for (const token of tokens) sends.push({ to: token, title: row.title, body: row.body });
    }
    if (sends.length === 0) return;
    await this.deliver(space, message, sends);
  }

  private async deliver(space: Space, message: Message, sends: { to: string; title: string; body: string }[]): Promise<void> {
    const ticketIds: string[] = [];
    for (let i = 0; i < sends.length; i += BATCH) {
      const batch = sends.slice(i, i + BATCH);
      const res = await this.fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          batch.map((s) => ({
            to: s.to,
            title: s.title,
            body: s.body,
            sound: 'default',
            data: { kind: 'space', orgId: this.orgId, spaceId: space.id, threadRootId: message.threadRoot ?? message.id },
          })),
        ),
      });
      const json = (await res.json().catch(() => null)) as { data?: ExpoTicket[] } | null;
      json?.data?.forEach((ticket, j) => {
        if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
          void this.store.deletePushToken(batch[j]!.to);
        } else if (ticket.id) {
          ticketIds.push(ticket.id);
        }
      });
    }
    if (ticketIds.length > 0 && this.receiptDelayMs > 0) {
      const t = setTimeout(() => void this.checkReceipts(ticketIds, sends), this.receiptDelayMs);
      t.unref?.();
    }
  }

  /** The slow prune: receipts name dead devices tickets could not. */
  private async checkReceipts(ticketIds: string[], sends: { to: string }[]): Promise<void> {
    try {
      const res = await this.fetchImpl(EXPO_RECEIPTS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: ticketIds.slice(0, 1000) }),
      });
      const json = (await res.json().catch(() => null)) as {
        data?: Record<string, { status: string; details?: { error?: string; expoPushToken?: string } }>;
      } | null;
      for (const receipt of Object.values(json?.data ?? {})) {
        if (receipt.status === 'error' && receipt.details?.error === 'DeviceNotRegistered') {
          const token = receipt.details.expoPushToken;
          if (token) void this.store.deletePushToken(token);
        }
      }
    } catch {
      // receipts are best-effort; the ticket-level prune already ran
    }
  }
}
