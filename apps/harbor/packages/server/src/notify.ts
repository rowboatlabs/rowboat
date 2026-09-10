import { mentionsAsText, type Message, type NotifyReason, type Space } from '@rowboat/spaces-protocol';
import type { SpaceHub } from './hub.js';
import type { PushSender } from './push.js';
import type { Store } from './store.js';

// Notifications (2026-09-10, the unread arc's delivery slice): the org
// decides ONCE who a message should reach and why, and the one decision is
// delivered twice — as a `notify` frame on each recipient's member channel
// (desktops, and any other live connection) and as a push to their phones
// (push.ts). Slack's shape: the server sends `desktop_notification`, the
// client only shows it. Mattermost, Discord and Zulip instead ship the facts
// and let each client apply its own preferences; we deliberately do not,
// because a phone and a desktop must agree, and the policy that will gate
// these rows later (levels, DND, presence) belongs to the org too.
//
// The decision reads the message's STAMP (protocol mentions.ts) and the
// thread's followers — never the text. Priority when several reasons hold:
// mention > here > dm > reply > message. "Message" is the plain case: no
// frame is sent for it, only the phone's `all` level wants it.
//
// Who is excluded: the author, for their own DIRECT post. An agent's post is
// the agent's act, not yours — the same symmetry read state keeps (an agent's
// post does not advance your mark), so your agent addressing you notifies you.

const EXCERPT_MAX = 140;

/** A frame reason, plus the plain case only push's `all` level consumes. */
export type NotifyKind = NotifyReason | 'message';

/** One recipient of one message: why, and the org's rendering of it. */
export interface Notification {
  memberId: string;
  kind: NotifyKind;
  title: string;
  body: string;
}

/** Does this message address the member — a token naming them, or @here? Read off the stamp. */
export function addressesRecipient(message: Message, memberId: string): boolean {
  return message.mentionsHere || message.mentions.includes(memberId);
}

export function classifyFor(memberId: string, space: Space, message: Message, followers: ReadonlySet<string>): NotifyKind {
  if (message.mentions.includes(memberId)) return 'mention';
  if (message.mentionsHere) return 'here';
  if (space.kind === 'direct') return 'dm';
  if (message.threadRoot !== undefined && followers.has(memberId)) return 'reply';
  return 'message';
}

export function excerpt(body: string, names: ReadonlyMap<string, string>): string {
  const flat = mentionsAsText(body, names).replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT_MAX ? `${flat.slice(0, EXCERPT_MAX - 1)}…` : flat;
}

/** The title every surface shows; the body is the excerpt with tokens flattened to names. */
export function buildNotifyText(input: {
  kind: NotifyKind;
  space: Space;
  authorName: string;
  body: string;
  names: ReadonlyMap<string, string>;
}): { title: string; body: string } {
  const { kind, authorName } = input;
  // A direct space's name is a placeholder: the person is the name.
  const direct = input.space.kind === 'direct';
  const where = direct ? '' : ` · ${input.space.name}`;
  const title =
    kind === 'mention'
      ? `${authorName} mentioned you${where}`
      : kind === 'reply'
        ? `${authorName} replied in a thread${where}`
        : `${authorName}${where}`;
  return { title, body: excerpt(input.body, input.names) };
}

/** Everyone this message reaches, with the reason and the text. Pure over the store's facts. */
export async function decideNotifications(store: Store, space: Space, message: Message): Promise<Notification[]> {
  const memberships = await store.listMemberships(space.id);
  const names = new Map<string, string>();
  for (const m of memberships) {
    const member = await store.getMember(m.memberId);
    if (member) names.set(member.id, member.displayName);
  }
  const followers = new Set<string>(
    message.threadRoot !== undefined ? await store.listThreadFollowers(space.id, message.threadRoot) : [],
  );
  const authorName = names.get(message.author.memberId) ?? message.author.memberId;
  const rows: Notification[] = [];
  for (const m of memberships) {
    if (m.memberId === message.author.memberId && message.author.actingMode === 'direct') continue;
    const kind = classifyFor(m.memberId, space, message, followers);
    const text = buildNotifyText({ kind, space, authorName, body: message.body, names });
    rows.push({ memberId: m.memberId, kind, ...text });
  }
  return rows;
}

/**
 * The write path's hook: decide, then deliver on both channels. Called
 * OUTSIDE the space lock, fire-and-forget — nothing here blocks the reply,
 * and a failure only logs. Frames go out before push so a phone's banner
 * never beats the desktop it is standing next to.
 */
export class Notifier {
  constructor(
    private readonly store: Store,
    private readonly hub: SpaceHub,
    /** Absent = no push on this org; frames still flow. */
    private readonly push?: PushSender,
  ) {}

  async onMessage(space: Space, message: Message): Promise<void> {
    try {
      const rows = await decideNotifications(this.store, space, message);
      const at = new Date().toISOString();
      for (const row of rows) {
        if (row.kind === 'message') continue;
        this.hub.publishToMember(row.memberId, {
          kind: 'notify',
          spaceId: space.id,
          ...(message.threadRoot !== undefined ? { threadRootId: message.threadRoot } : {}),
          messageId: message.id,
          reason: row.kind,
          author: message.author,
          title: row.title,
          body: row.body,
          at,
        });
      }
      if (this.push) await this.push.send(space, message, rows);
    } catch (err) {
      console.error('[notify] onMessage failed:', err);
    }
  }
}
