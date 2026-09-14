// Mentions (2026-09-10). One grammar, one parser, shared by the org and every
// client: a mention is a markdown link token whose href carries the KEY and
// whose label is a display hint —
//
//   [@Ramnique Singh](#member:01J8KQ4T3M9V2B7XCH0RDQ5AEF)
//   [@here](#here)          [@rowboat](#rowboat)
//
// The href is what everything keys on; the label is re-resolved from the
// roster at render and never parsed. The fixed addresses are tokens too
// (Slack's <!here>, Zulip's @**all**): an address is something a composer
// emitted deliberately, never a word that happened to be in prose. Tokens
// inside code regions are cites, not addresses. Nothing anywhere reads a
// mention out of a name — the org stamps `Message.mentions` from these tokens
// alone, and every consumer (unread, Activity, push, chips) reads the stamp.

export type MentionRef =
  | { kind: 'member'; id: string; label: string }
  | { kind: 'here' }
  | { kind: 'rowboat' };

/** What the org stamps on a message from its tokens (core.ts Message). */
export interface MentionStamps {
  members: string[];
  here: boolean;
  rowboat: boolean;
}

export function noMentions(): MentionStamps {
  return { members: [], here: false, rowboat: false };
}

export function stampsEqual(a: MentionStamps, b: MentionStamps): boolean {
  return (
    a.here === b.here &&
    a.rowboat === b.rowboat &&
    a.members.length === b.members.length &&
    a.members.every((id, i) => id === b.members[i])
  );
}

/** Fenced and inline code — a mention inside one is a cite, not an address. */
const CODE_REGIONS = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g;

/** One token: label = anything but "]" or a newline; member id = anything but ")" or whitespace. */
export const MENTION_TOKEN_RE = /\[@([^\]\n]*)\]\(#(?:member:([^)\s]+)|(here)|(rowboat))\)/g;

/** The wire form of one mention. A label may not contain brackets or newlines; the id stands in for an empty one. */
export function mentionToken(ref: MentionRef): string {
  if (ref.kind === 'member') {
    const label = ref.label.replace(/[[\]\n]/g, ' ').trim() || ref.id;
    return `[@${label}](#member:${ref.id})`;
  }
  return `[@${ref.kind}](#${ref.kind})`;
}

function refOf(label: string, id: string | undefined, here: string | undefined): MentionRef {
  if (id !== undefined) return { kind: 'member', id, label };
  return here !== undefined ? { kind: 'here' } : { kind: 'rowboat' };
}

/** Rewrite every token outside code regions through `fn` (return `raw` to keep one as is). */
export function mapMentionTokens(body: string, fn: (ref: MentionRef, raw: string) => string): string {
  return body
    .split(CODE_REGIONS)
    .map((part, i) => {
      if (i % 2 === 1) return part; // a code region — cite, not address
      return part.replace(MENTION_TOKEN_RE, (raw: string, label: string, id?: string, here?: string) => fn(refOf(label, id, here), raw));
    })
    .join('');
}

/** The addresses in a body: member ids (deduped, in order of first appearance) and the two fixed addresses. */
export function parseMentions(body: string): MentionStamps {
  const members: string[] = [];
  const seen = new Set<string>();
  let here = false;
  let rowboat = false;
  mapMentionTokens(body, (ref, raw) => {
    if (ref.kind === 'member') {
      if (!seen.has(ref.id)) {
        seen.add(ref.id);
        members.push(ref.id);
      }
    } else if (ref.kind === 'here') here = true;
    else rowboat = true;
    return raw;
  });
  return { members, here, rowboat };
}

/** True when the body deliberately addresses @rowboat (a token, never the word). */
export function addressesRowboat(body: string): boolean {
  return parseMentions(body).rowboat;
}

/**
 * Re-resolve every member token's label from the roster — what the agent face
 * does before a body reaches a model, and what an export does. A token whose
 * id the roster no longer knows keeps its label (a departed member still reads
 * as a person, not a ULID).
 */
export function relabelMentions(body: string, names: ReadonlyMap<string, string>): string {
  return mapMentionTokens(body, (ref, raw) => {
    if (ref.kind !== 'member') return raw;
    const name = names.get(ref.id);
    return name === undefined || name === ref.label ? raw : mentionToken({ ...ref, label: name });
  });
}

/**
 * Tokens → plain "@Name" text, for surfaces that are not markdown: titles,
 * crumbs, quotes, notification bodies, copied text. Ids resolve through the
 * roster; an unknown id falls back to the token's label.
 */
export function mentionsAsText(body: string, names: ReadonlyMap<string, string>): string {
  return mapMentionTokens(body, (ref) => {
    if (ref.kind !== 'member') return `@${ref.kind}`;
    return `@${names.get(ref.id) ?? ref.label}`;
  });
}

/** For tool descriptions: how an agent writes a mention. */
export const MENTION_GRAMMAR =
  'To mention someone, write a mention token — a markdown link whose href carries their member id: ' +
  '`[@Their Name](#member:<memberId>)` (ids come from list_members; the label is only a hint). ' +
  '`[@here](#here)` addresses everyone in the space and `[@rowboat](#rowboat)` addresses the ' +
  "reader's own agent. A bare name or a bare @word is prose, not a mention — it reaches nobody.";
