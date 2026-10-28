// Notes are Rowboat knowledge files, not chat messages (2026-10-28): they
// carry YAML frontmatter, [[wiki links]] between notes, task checkboxes and
// meeting ```transcript blocks. The mobile renderer is plain markdown, so these
// are rewritten into what it understands before rendering. The file itself is
// never changed by this; editing works on the raw text.

/** Prefix for links that open another note (handled by the note screen). */
export const NOTE_LINK = 'rowboat-note:';

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

/** Split a note into its frontmatter (kept verbatim on save) and body. */
export function splitFrontmatter(markdown: string): { frontmatter: string; body: string } {
  const match = FRONTMATTER.exec(markdown);
  return match ? { frontmatter: match[0], body: markdown.slice(match[0].length) } : { frontmatter: '', body: markdown };
}

/** Workspace path for a [[wiki link]] target, which is relative to knowledge/. */
export function wikiTargetPath(target: string): string {
  const clean = target.split('#')[0].trim();
  return `knowledge/${clean.endsWith('.md') ? clean : `${clean}.md`}`;
}

/** Split text on ``` fences so rewrites leave code alone. Odd indexes are fenced. */
function splitFences(markdown: string): string[] {
  return markdown.split(/(^```[^\n]*\n[\s\S]*?^```[ \t]*$)/m);
}

/** Task list items: the renderer has no checkboxes, so draw them as glyphs. */
function taskGlyphs(text: string): string {
  return text.replace(/^(\s*[-*+]\s+)\[ \]\s/gm, '$1☐︎ ').replace(/^(\s*[-*+]\s+)\[[xX]\]\s/gm, '$1☑︎ ');
}

/** A space file (plain markdown, no wiki links): checkboxes only, code left alone. */
export function documentToRenderable(markdown: string): string {
  return splitFences(markdown)
    .map((part, i) => (i % 2 === 1 ? part : taskGlyphs(part)))
    .join('');
}

function rewriteProse(text: string): string {
  // [[Path|Alias]] and [[Path]] → a link that opens the note. Embeds (![[…]]) included.
  const linked = text.replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => {
    const label = (alias ?? target.split('/').pop() ?? target).replace(/\.md$/, '').trim();
    return `[${label.replace(/[[\]]/g, '')}](${NOTE_LINK}${encodeURIComponent(wikiTargetPath(target))})`;
  });
  return taskGlyphs(linked);
}

function rewriteFence(block: string): string {
  // Meeting notes keep the transcript as {"transcript": "..."} in a fence.
  const m = /^```transcript[^\n]*\n([\s\S]*?)\n?```[ \t]*$/m.exec(block);
  if (!m) return block;
  try {
    const parsed = JSON.parse(m[1]) as { transcript?: unknown };
    if (typeof parsed.transcript === 'string' && parsed.transcript.trim()) {
      return `#### Transcript\n\n${parsed.transcript.trim()}\n`;
    }
  } catch {
    // Not JSON: show the block as it is.
  }
  return block;
}

/** The note body, ready for the markdown renderer. */
export function noteToRenderable(body: string): string {
  return splitFences(body)
    .map((part, i) => (i % 2 === 1 ? rewriteFence(part) : rewriteProse(part)))
    .join('');
}
