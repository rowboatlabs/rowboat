// Mentions (2026-09-10). One grammar, one parser, shared by the org and every
// client: a mention is a markdown link token whose href carries the KEY and
// whose label is a display hint —
//
//   [@Ramnique Singh](#member:01J8KQ4T3M9V2B7XCH0RDQ5AEF)
//   [@here](#here)          [@rowboat](#rowboat)
//   [#general](#space:01J8KQ4T3M9V2B7XCH0RDQ5AEG)          (2026-09-14)
//
// The href is what everything keys on; the label is re-resolved from the
// roster (or the space listing) at render and never parsed. The fixed
// addresses are tokens too (Slack's <!here>, Zulip's @**all**): an address is
// something a composer emitted deliberately, never a word that happened to be
// in prose. Tokens inside code regions are cites, not addresses. Nothing
// anywhere reads a mention out of a name — the org stamps `Message.mentions`
// from these tokens alone, and every consumer (unread, Activity, push, chips)
// reads the stamp. A space token (Slack's <#C123>) is a REFERENCE, not an
// address: it renders as a chip that opens the space for readers who are in
// it, and it never stamps, follows, or notifies anyone.

export type MentionRef =
  | { kind: 'member'; id: string; label: string }
  | { kind: 'space'; id: string; label: string }
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

/**
 * One token: label = anything but "]" or a newline; an id = anything but ")"
 * or whitespace. Two spellings, told apart by the sigil AND the href kind —
 * `[@…](#member:…)` / `[@here](#here)` / `[@rowboat](#rowboat)` address;
 * `[#…](#space:…)` refers.
 */
export const MENTION_TOKEN_RE = /\[@([^\]\n]*)\]\(#(?:member:([^)\s]+)|(here)|(rowboat))\)|\[#([^\]\n]*)\]\(#space:([^)\s]+)\)/g;

/** The wire form of one mention. A label may not contain brackets or newlines; the id stands in for an empty one. */
export function mentionToken(ref: MentionRef): string {
  if (ref.kind === 'member' || ref.kind === 'space') {
    const label = ref.label.replace(/[[\]\n]/g, ' ').trim() || ref.id;
    return ref.kind === 'member' ? `[@${label}](#member:${ref.id})` : `[#${label}](#space:${ref.id})`;
  }
  return `[@${ref.kind}](#${ref.kind})`;
}

function refOf(label: string, id: string | undefined, here: string | undefined, spaceLabel: string | undefined, spaceId: string | undefined): MentionRef {
  if (spaceId !== undefined) return { kind: 'space', id: spaceId, label: spaceLabel ?? '' };
  if (id !== undefined) return { kind: 'member', id, label };
  return here !== undefined ? { kind: 'here' } : { kind: 'rowboat' };
}

/** Rewrite every token outside code regions through `fn` (return `raw` to keep one as is). */
export function mapMentionTokens(body: string, fn: (ref: MentionRef, raw: string) => string): string {
  return body
    .split(CODE_REGIONS)
    .map((part, i) => {
      if (i % 2 === 1) return part; // a code region — cite, not address
      return part.replace(MENTION_TOKEN_RE, (raw: string, label: string, id?: string, here?: string, _rowboat?: string, spaceLabel?: string, spaceId?: string) =>
        fn(refOf(label, id, here, spaceLabel, spaceId), raw),
      );
    })
    .join('');
}

/** The addresses in a body: member ids (deduped, in order of first appearance) and the two fixed addresses. Space tokens refer, never address. */
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
    else if (ref.kind === 'rowboat') rowboat = true;
    return raw;
  });
  return { members, here, rowboat };
}

/** True when the body deliberately addresses @rowboat (a token, never the word). */
export function addressesRowboat(body: string): boolean {
  return parseMentions(body).rowboat;
}

/**
 * Re-resolve every member token's label from the roster (and every space
 * token's from the listing, when given) — what the agent face does before a
 * body reaches a model, and what an export does. A token whose id the map
 * does not know keeps its label (a departed member still reads as a person,
 * a space the reader is not in still reads as a name, not a ULID).
 */
export function relabelMentions(body: string, names: ReadonlyMap<string, string>, spaceNames?: ReadonlyMap<string, string>): string {
  return mapMentionTokens(body, (ref, raw) => {
    if (ref.kind !== 'member' && ref.kind !== 'space') return raw;
    const name = (ref.kind === 'member' ? names : spaceNames)?.get(ref.id);
    return name === undefined || name === ref.label ? raw : mentionToken({ ...ref, label: name });
  });
}

/**
 * Tokens → plain "@Name" / "#Space" text, for surfaces that are not markdown:
 * titles, crumbs, quotes, notification bodies, copied text. Ids resolve
 * through the roster (and the space listing, when given); an unknown id falls
 * back to the token's label.
 */
export function mentionsAsText(body: string, names: ReadonlyMap<string, string>, spaceNames?: ReadonlyMap<string, string>): string {
  return mapMentionTokens(body, (ref) => {
    if (ref.kind === 'member') return `@${names.get(ref.id) ?? ref.label}`;
    if (ref.kind === 'space') return `#${spaceNames?.get(ref.id) ?? ref.label}`;
    return `@${ref.kind}`;
  });
}

/** For tool descriptions: how an agent writes a mention. */
export const MENTION_GRAMMAR =
  'To mention someone, write a mention token — a markdown link whose href carries their member id: ' +
  '`[@Their Name](#member:<memberId>)` (ids come from list_members; the label is only a hint). ' +
  '`[@here](#here)` addresses everyone in the space and `[@rowboat](#rowboat)` addresses the ' +
  "reader's own agent. To point at a space, write `[#Space Name](#space:<spaceId>)` (ids from " +
  'list_spaces) — a reference that opens the space for readers who are in it and notifies nobody. ' +
  'A bare name, a bare @word, or a bare #word is prose, not a mention — it reaches nobody.';
