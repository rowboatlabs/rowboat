import type { Member } from '@rowboat/spaces-protocol';

// Space search internals: query parsing (with query-time mention expansion),
// asset text extraction, and snippet windows. The INDEX stores only immutable
// facts — message bodies verbatim (mention ids included, as tokens) and
// extracted asset text. Everything mutable (display names, paths, topic
// titles' relation to threads) is resolved at query time, so renames and
// reorganizations never stale it.

/**
 * One parsed query term: the typed word plus its alternatives — the ids of
 * members whose display name matches it. A term is satisfied by the word OR
 * any alternative; terms are AND-ed. `prefix` marks the final term (live
 * typing: "dep" should match "deploy").
 */
export interface SearchTerm {
  text: string;
  alts: string[];
  prefix: boolean;
}

export interface SearchQuery {
  terms: SearchTerm[];
}

/**
 * Tokenize the raw query the same way to_tsvector('simple') tokenizes bodies
 * (split on non-alphanumerics, lowercase), so a term always compares against
 * lexemes that actually exist in the index. "@harsh" and "harsh" are the same
 * query; punctuation never produces phantom AND terms.
 */
function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((t) => t.length > 0)
    .slice(0, 8); // AND-ing more words than this only ever yields nothing
}

/**
 * Query-time mention expansion: a term that matches a word of a member's
 * display name (prefix match, case-insensitive) gains that member's id as an
 * alternative. Bodies store mentions as "@<memberId>" and the simple
 * tokenizer keeps the id as one lexeme, so the id is already in the index —
 * this is purely a read-side rewrite. Names resolve fresh on every query:
 * renames are correct instantly, and a name shared by two members ORs in both.
 */
export function parseSearchQuery(raw: string, members: readonly Member[]): SearchQuery {
  const words = tokenize(raw);
  const terms = words.map((text, i) => {
    const alts: string[] = [];
    for (const m of members) {
      const nameWords = m.displayName.toLowerCase().split(/\s+/);
      if (nameWords.some((w) => w.startsWith(text))) alts.push(m.id.toLowerCase());
    }
    return { text, alts, prefix: i === words.length - 1 };
  });
  return { terms };
}

/** A lexeme quoted for to_tsquery: single-quoted, internal quotes doubled. */
function lexeme(text: string, prefix: boolean): string {
  return `'${text.replace(/'/g, "''")}'${prefix ? ':*' : ''}`;
}

/**
 * The pg form: "('harsh' | '01j8kq…') & 'deploy':*" for to_tsquery('simple').
 * Everything is quoted, so no user text ever reaches tsquery syntax.
 */
export function toTsQueryString(q: SearchQuery): string {
  return q.terms
    .map((t) => {
      const branches = [lexeme(t.text, t.prefix), ...t.alts.map((a) => lexeme(a, false))];
      return branches.length > 1 ? `(${branches.join(' | ')})` : branches[0];
    })
    .join(' & ');
}

/** ILIKE patterns for path matching (one per term), LIKE metacharacters escaped. */
export function toPathPatterns(q: SearchQuery): string[] {
  return q.terms.map((t) => `%${t.text.replace(/([\\%_])/g, '\\$1')}%`);
}

/**
 * Plain-TS matcher — the memory store's search and the snippet locator share
 * it. Word-boundary semantics approximate the tsvector's: a term matches at
 * the start of an alphanumeric run (so "deploy" hits "deploying" via prefix
 * but "ploy" never hits "deploy").
 */
export function matchesTerm(haystackLower: string, term: SearchTerm): boolean {
  const candidates = [term.text, ...term.alts];
  return candidates.some((c) => {
    let idx = haystackLower.indexOf(c);
    while (idx !== -1) {
      const before = idx === 0 ? '' : haystackLower[idx - 1]!;
      const boundaryBefore = !/[\p{L}\p{N}_]/u.test(before);
      const after = haystackLower[idx + c.length] ?? '';
      const boundaryAfter = term.prefix || c !== term.text || !/[\p{L}\p{N}_]/u.test(after);
      if (boundaryBefore && boundaryAfter) return true;
      idx = haystackLower.indexOf(c, idx + 1);
    }
    return false;
  });
}

export function matchesAllTerms(haystack: string, q: SearchQuery): boolean {
  const lower = haystack.toLowerCase();
  return q.terms.every((t) => matchesTerm(lower, t));
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
