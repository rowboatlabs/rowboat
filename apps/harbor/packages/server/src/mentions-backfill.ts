import { mentionToken } from '@rowboat/spaces-protocol';

// The pre-token spelling → mention tokens (the one-time backfill behind
// service.migrateMentions, 2026-09-10). Before tokens, the composer wrote
// "@<memberId>" as bare text and "@here" / "@rowboat" as bare words; readers
// regex-matched them. Every reader now parses tokens only, so stored text
// gets rewritten once — through the ordinary edit path, as the author.

const CODE_REGIONS = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g;
/** The legacy address: "@" + id at a word boundary. "[" is deliberately not a boundary so a token's own "[@…" never re-matches. */
const LEGACY_RE = /(^|[\s({])@([A-Za-z0-9][\w.-]*)/g;

export function legacyToTokens(text: string, names: ReadonlyMap<string, string>): string {
  return text
    .split(CODE_REGIONS)
    .map((part, i) => {
      if (i % 2 === 1) return part; // a code region — cite, not address
      return part.replace(LEGACY_RE, (raw: string, pre: string, handle: string) => {
        // Trailing punctuation belongs to the sentence, not the id ("@harsh.").
        let id = handle;
        let tail = '';
        while (id.length > 0 && /[.-]$/.test(id) && !names.has(id)) {
          tail = id.slice(-1) + tail;
          id = id.slice(0, -1);
        }
        const lower = id.toLowerCase();
        if (lower === 'here') return `${pre}${mentionToken({ kind: 'here' })}${tail}`;
        if (lower === 'rowboat') return `${pre}${mentionToken({ kind: 'rowboat' })}${tail}`;
        const name = names.get(id);
        if (name === undefined) return raw;
        return `${pre}${mentionToken({ kind: 'member', id, label: name })}${tail}`;
      });
    })
    .join('');
}
