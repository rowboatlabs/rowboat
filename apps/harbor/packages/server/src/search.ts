import { mapMentionTokens, type Member } from '@rowboat/spaces-protocol';

// Space search internals: query parsing (with query-time mention expansion),
// asset text extraction, and snippet windows. The INDEX stores only immutable
// facts — message bodies verbatim (mention ids included, as tokens) and
// extracted asset text. Everything mutable (display names, paths, topic
// titles' relation to threads) is resolved at query time, so renames and
// reorganizations never stale it.

/**
 * What the index holds for a body or a title (messages.search_text,
 * topics.search_text — migration 017): every mention token collapses to its
 * bare key (the member id, or "here" / "rowboat"), everything else stays
 * verbatim. So neither a token's label nor the word "member" is ever indexed,
 * and a name query reaches a mention only through the rename-safe id
 * expansion below. App-computed, written in the same transaction as the
 * text, never a fallback: a write path that forgets it fails the NOT NULL.
 */
export function searchTextFor(text: string): string {
  return mapMentionTokens(text, (ref) => (ref.kind === 'member' || ref.kind === 'space' ? ref.id : ref.kind));
}

/**
 * One parsed query term: the typed word plus its alternatives — the ids of
 * members whose display name matches it. A term is satisfied by the word OR
 * any alternative; terms are AND-ed. The word prefix-matches ("dep" finds
 * "deploy"); an alternative is a whole id.
 */
export interface SearchTerm {
  text: string;
  alts: string[];
}

/**
 * The terms one whitespace-separated chunk of the query produced. `whole` is
 * the chunk as typed when it split into more than one word ("github.com/a/b",
 * "file.ts"): Postgres's parser keeps URLs, hosts and file names as single
 * lexemes, which the split words never reach, so the group also matches the
 * chunk as Postgres parses it (2026-11-03: a pasted URL found nothing).
 */
export interface SearchGroup {
  whole: string | null;
  terms: SearchTerm[];
}

/** What `has:` can ask of a message body. */
export type HasKind = 'link' | 'image' | 'file';

/**
 * The filter grammar (2026-11-06, "search" in Main): `from:`, `mentions:`,
 * `in:` and `has:` narrow message hits in the store, not on a page the client
 * already holds, so a filter never silently misses older messages and a query
 * of filters alone ("from:me has:link") is a search of its own. `from` and
 * `mentions` are one list of candidate member ids per filter: any candidate
 * satisfies it, every filter must be satisfied. An empty list matches nothing.
 */
export interface SearchFilters {
  from: string[][];
  mentions: string[][];
  /** Fragments of the thread's title: its discussion's, or its session's. */
  in: string[];
  has: HasKind[];
}

export interface SearchQuery {
  terms: SearchTerm[];
  groups: SearchGroup[];
  filters: SearchFilters;
  /** Any filter present: the query is about messages only. */
  filtered: boolean;
}

/**
 * Tokenize one chunk the same way to_tsvector('simple') tokenizes bodies
 * (split on non-alphanumerics, lowercase), so a term always compares against
 * lexemes that actually exist in the index. "@harsh" and "harsh" are the same
 * query; punctuation never produces phantom AND terms.
 */
function tokenize(chunk: string): string[] {
  return chunk
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((t) => t.length > 0);
}

/** AND-ing more words than this only ever yields nothing. */
const MAX_TERMS = 8;

/** A filter token: `from:harsh`, `has:link`. The value is one chunk, no spaces. */
const FILTER_RE = /^(from|mentions|in|has):(.+)$/i;
const HAS_KINDS = new Set<string>(['link', 'image', 'file']);

/**
 * The members a `from:` or `mentions:` value names: `me` is the searcher, an
 * id names that member, anything else prefix-matches a word of a display name
 * (the same rule as mention expansion below, so "from:harsh" and a search for
 * "harsh" agree on who Harsh is).
 */
function membersNamed(value: string, members: readonly Member[], selfId: string | undefined): string[] {
  const v = value.toLowerCase().replace(/^@/, '');
  if (v === 'me') return selfId ? [selfId] : [];
  const ids: string[] = [];
  for (const m of members) {
    if (m.id.toLowerCase() === v || m.displayName.toLowerCase().split(/\s+/).some((w) => w.startsWith(v))) ids.push(m.id);
  }
  return ids;
}

/**
 * Query-time mention expansion: a term that matches a word of a member's
 * display name (prefix match, case-insensitive) gains that member's id as an
 * alternative. The index text collapses every mention token to its member id
 * (searchTextFor) and the simple tokenizer keeps the id as one lexeme, so the
 * id is already in the index — this is purely a read-side rewrite. Names resolve fresh on every query:
 * renames are correct instantly, and a name shared by two members ORs in both.
 *
 * Every term prefix-matches (2026-11-06, "search" in Main): the 'simple'
 * index has no stemming, so with only the last term prefixed "deploy fail"
 * missed "deployment failed". A word still has to start a word: "ploy" finds
 * nothing.
 */
export function parseSearchQuery(raw: string, members: readonly Member[], selfId?: string): SearchQuery {
  const groups: SearchGroup[] = [];
  const filters: SearchFilters = { from: [], mentions: [], in: [], has: [] };
  let count = 0;
  for (const chunk of raw.split(/\s+/)) {
    const filter = FILTER_RE.exec(chunk);
    if (filter) {
      const key = filter[1]!.toLowerCase();
      const value = filter[2]!;
      if (key === 'from' || key === 'mentions') {
        filters[key].push(membersNamed(value, members, selfId));
        continue;
      }
      if (key === 'in') {
        filters.in.push(value);
        continue;
      }
      if (HAS_KINDS.has(value.toLowerCase())) {
        filters.has.push(value.toLowerCase() as HasKind);
        continue;
      }
      // An unknown has: kind is two ordinary words, as before the grammar.
    }
    const words = tokenize(chunk).slice(0, MAX_TERMS - count);
    if (words.length === 0) continue;
    count += words.length;
    const terms = words.map((text) => {
      const alts: string[] = [];
      for (const m of members) {
        const nameWords = m.displayName.toLowerCase().split(/\s+/);
        if (nameWords.some((w) => w.startsWith(text))) alts.push(m.id.toLowerCase());
      }
      return { text, alts };
    });
    groups.push({ whole: words.length > 1 ? chunk : null, terms });
  }
  const terms = groups.flatMap((g) => g.terms);
  const filtered = filters.from.length + filters.mentions.length + filters.in.length + filters.has.length > 0;
  return { terms, groups, filters, filtered };
}

/**
 * The body patterns `has:` matches (Postgres regular expressions over the raw
 * body): a web link, an inline image, a file link into the space's blobs.
 */
export const HAS_PATTERNS: Record<HasKind, string> = {
  link: 'https?://',
  image: '!\\[[^]]*\\]\\(',
  file: '(^|[^!])\\[[^]]*\\]\\([^)]*/b/',
};

/** A lexeme quoted for to_tsquery: single-quoted, internal quotes doubled. */
function lexeme(text: string, prefix: boolean): string {
  return `'${text.replace(/'/g, "''")}'${prefix ? ':*' : ''}`;
}

/**
 * The pg form, one entry per group: "('harsh':* | '01j8kq…') & 'deploy':*" for
 * to_tsquery('simple'), beside the group's `whole` ('' for none), which
 * TSQUERY_SQL parses with plainto_tsquery and ORs in. Everything is quoted or
 * parsed by Postgres, so no user text ever reaches tsquery syntax.
 */
export function toTsQueryParams(q: SearchQuery): { groups: string[]; wholes: string[] } {
  const groups = q.groups.map((g) => {
    const and = g.terms
      .map((t) => {
        const branches = [lexeme(t.text, true), ...t.alts.map((a) => lexeme(a, false))];
        return branches.length > 1 ? `(${branches.join(' | ')})` : branches[0];
      })
      .join(' & ');
    return g.terms.length > 1 ? `(${and})` : and;
  });
  return { groups, wholes: q.groups.map((g) => g.whole ?? '') };
}

/**
 * The tsquery from toTsQueryParams' two arrays, at the given placeholders:
 * the groups AND-ed, each OR-ed with its whole chunk as Postgres parses it.
 * plainto_tsquery's text output is valid tsquery input; an empty parse (a
 * chunk of punctuation) leaves the group as it was.
 */
export function tsquerySql(groups: string, wholes: string): string {
  return `to_tsquery('simple', (
    select string_agg(
      case when numnode(plainto_tsquery('simple', w)) > 0
        then '(' || g || ' | (' || plainto_tsquery('simple', w)::text || '))'
        else g end,
      ' & ' order by i)
    from unnest(${groups}::text[], ${wholes}::text[]) with ordinality as x(g, w, i)))`;
}

/** ILIKE patterns for path matching (one per term), LIKE metacharacters escaped. */
export function toPathPatterns(q: SearchQuery): string[] {
  return q.terms.map((t) => `%${t.text.replace(/([\\%_])/g, '\\$1')}%`);
}

/**
 * Excerpt around the first occurrence of any term (or mention alternative) —
 * raw text, mention ids unresolved (clients render them like message bodies).
 */
export function snippetAround(body: string, q: SearchQuery): string {
  const lower = body.toLowerCase();
  let at = -1;
  for (const t of q.terms) {
    for (const c of [t.text, ...t.alts]) {
      const idx = lower.indexOf(c);
      if (idx !== -1 && (at === -1 || idx < at)) at = idx;
    }
  }
  if (at === -1) at = 0;
  const start = Math.max(0, at - 60);
  const end = Math.min(body.length, at + 160);
  const slice = body.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${slice}${end < body.length ? '…' : ''}`;
}

/** Extracted text is capped well under tsvector's limits; snippets never need more. */
const EXTRACT_CAP = 100_000;

/**
 * What of this file is SEARCHABLE — the one per-kind seam future asset types
 * plug into. Prose passes through; structured formats yield only the words a
 * person put there (an Excalidraw board is 99% geometry JSON wrapping the ten
 * words written on it — indexing it raw would match "strokeColor" everywhere).
 * Unknown JSON keeps its string leaves. Binaries contribute nothing (found by
 * filename via the path predicate instead).
 */
export function extractSearchText(path: string, content: string): string {
  const trimmed = content.trimStart();
  const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[');
  if (/\.excalidraw$/i.test(path) || (looksJson && trimmed.includes('"excalidraw"'))) {
    return extractFromJson(content, (obj) => {
      if (obj['type'] === 'text' && typeof obj['text'] === 'string') return [obj['text']]; // text elements
      if (obj['type'] === 'frame' && typeof obj['name'] === 'string') return [obj['name']]; // frame titles
      return [];
    });
  }
  if (/\.json$/i.test(path) || looksJson) {
    return extractFromJson(content, null);
  }
  return content.slice(0, EXTRACT_CAP);
}

/**
 * Walk parsed JSON collecting human text: `pick` chooses strings per object
 * (Excalidraw's text elements); null = every string leaf (generic JSON).
 */
function extractFromJson(content: string, pick: ((obj: Record<string, unknown>) => string[]) | null): string {
  let root: unknown;
  try {
    root = JSON.parse(content);
  } catch {
    return content.slice(0, EXTRACT_CAP); // not actually JSON — index as prose
  }
  const out: string[] = [];
  let size = 0;
  const walk = (node: unknown): void => {
    if (size >= EXTRACT_CAP || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (pick) {
      for (const s of pick(obj)) {
        out.push(s);
        size += s.length;
      }
    } else {
      for (const v of Object.values(obj)) {
        if (typeof v === 'string' && v.length > 1) {
          out.push(v);
          size += v.length;
        }
      }
    }
    for (const v of Object.values(obj)) walk(v);
  };
  walk(root);
  return out.join('\n').slice(0, EXTRACT_CAP);
}
