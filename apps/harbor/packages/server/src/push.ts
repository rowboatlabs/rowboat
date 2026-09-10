import { mentionsAsText, type Message, type Space } from '@rowboat/spaces-protocol';
import type { PushLevel, Store } from './store.js';

// Push notifications (PUSH_PLAN.md): the decision + the send, hooked onto the
// message write path. Slack's tree, cut to v1: per-member level, per-device
// Expo tokens, classification mention > dm > message, fire-and-forget batches
// to Expo's push API, dead tokens pruned via tickets and a delayed receipts
// check. "Mention" is read off the message's STAMPED addresses (protocol
// mentions.ts, stamped by the org at post) — this module parses no text.

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
/** Expo recommends ~15 min before receipts are reliably available. */
const RECEIPT_DELAY_MS = 15 * 60_000;
const BATCH = 100;
const EXCERPT_MAX = 140;

/** Members never registered a level — Slack's default: DMs + mentions. */
export const DEFAULT_PUSH_LEVEL: PushLevel = 'dms';

export type PushKind = 'mention' | 'dm' | 'message';

/** Does this message address the member — a token naming them, or @here? Read off the stamp. */
export function addressesRecipient(message: Message, memberId: string): boolean {
  return message.mentionsHere || message.mentions.includes(memberId);
}

export function classifyFor(memberId: string, space: Space, message: Message): PushKind {
  if (addressesRecipient(message, memberId)) return 'mention';
  if (space.kind === 'direct') return 'dm';
  return 'message';
}

export function levelAllows(level: PushLevel, kind: PushKind): boolean {
  if (level === 'off') return false;
  if (level === 'mentions') return kind === 'mention';
  if (level === 'dms') return kind === 'mention' || kind === 'dm';
  return true; // 'all'
}

function excerpt(body: string, names: ReadonlyMap<string, string>): string {
  const flat = mentionsAsText(body, names).replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT_MAX ? `${flat.slice(0, EXCERPT_MAX - 1)}…` : flat;
}

export function buildPushText(input: {
  kind: PushKind;
  space: Space;
  authorName: string;
  /** The DM label: a direct space's name is a placeholder, the person is the name. */
  direct: boolean;
  body: string;
  names: ReadonlyMap<string, string>;
}): { title: string; body: string } {
  const title = input.direct
    ? input.kind === 'mention'
      ? `${input.authorName} mentioned you`
      : input.authorName
    : input.kind === 'mention'
      ? `${input.authorName} mentioned you · ${input.space.name}`
      : `${input.authorName} · ${input.space.name}`;
  return { title, body: excerpt(input.body, input.names) };
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
   * Decide and send for one appended message. Called OUTSIDE the space lock,
   * fire-and-forget — the write path never waits on Expo, and failures only
   * log. The author's own devices are never pushed.
   */
  async onMessage(space: Space, message: Message): Promise<void> {
    try {
      const memberships = await this.store.listMemberships(space.id);
      const names = new Map<string, string>();
      const sends: { to: string; title: string; body: string }[] = [];
      for (const m of memberships) {
        const member = await this.store.getMember(m.memberId);
        if (member) names.set(member.id, member.displayName);
      }
      for (const m of memberships) {
        if (m.memberId === message.author.memberId) continue;
        const level = (await this.store.getPushLevel(m.memberId)) ?? DEFAULT_PUSH_LEVEL;
        const kind = classifyFor(m.memberId, space, message);
        if (!levelAllows(level, kind)) continue;
        const tokens = await this.store.listPushTokens(m.memberId);
        if (tokens.length === 0) continue;
        const text = buildPushText({
          kind,
          space,
          direct: space.kind === 'direct',
          authorName: names.get(message.author.memberId) ?? message.author.memberId,
          body: message.body,
          names,
        });
        for (const token of tokens) sends.push({ to: token, ...text });
      }
      if (sends.length === 0) return;
      await this.deliver(space, message, sends);
    } catch (err) {
      console.error('[push] onMessage failed:', err);
    }
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
