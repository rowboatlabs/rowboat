/**
 * Inline emphasis at the outline→runs boundary. Models return markdown
 * emphasis in slide text no matter how firmly the prompt forbids it, and
 * before this parser those markers landed on slides as literal asterisks.
 *
 * Deliberately tiny grammar — the only markers the deck pipeline documents:
 *
 *   **text**  → a bold segment
 *   *text*    → an italic segment
 *   `text`    → the text, backticks stripped, kept plain
 *
 * Matching rules (a marker that fails them stays literal text):
 *  - a span needs a closing marker on the same line and non-empty content;
 *  - content must not start or end with whitespace ("5 * 3 * 2" is
 *    multiplication, not emphasis);
 *  - spans do not nest: marker characters left inside a matched span are
 *    stripped, so styled text never shows asterisk syntax.
 *
 * A lone unmatched marker is ordinary text and survives verbatim.
 */

export interface EmphasisSegment {
  text: string
  bold?: boolean
  italic?: boolean
}

/** Emphasis-span content: non-empty and not whitespace-edged. */
function isSpanContent(content: string): boolean {
  return content.length > 0 && !/^\s/.test(content) && !/\s$/.test(content)
}

/** Marker characters inside a matched span degrade to nothing (never shown). */
function stripMarkers(s: string): string {
  return s.replace(/[*`]/g, '')
}

/**
 * Splits one line of outline text into styled segments. Concatenating the
 * segments' text yields the line with all matched markers removed; a line
 * with no valid markers comes back as a single plain segment.
 */
export function parseInlineEmphasis(line: string): EmphasisSegment[] {
  const out: EmphasisSegment[] = []
  let plain = ''
  const flush = (): void => {
    if (plain) {
      out.push({ text: plain })
      plain = ''
    }
  }

  let i = 0
  while (i < line.length) {
    const ch = line[i]

    if (ch === '`') {
      const close = line.indexOf('`', i + 1)
      if (close > i + 1) {
        // Code span: backticks stripped, content kept plain and verbatim.
        plain += line.slice(i + 1, close)
        i = close + 1
        continue
      }
      plain += ch
      i += 1
      continue
    }

    if (line.startsWith('**', i)) {
      const close = line.indexOf('**', i + 2)
      const content = close === -1 ? '' : line.slice(i + 2, close)
      if (close !== -1 && isSpanContent(content)) {
        flush()
        out.push({ text: stripMarkers(content), bold: true })
        i = close + 2
        continue
      }
      plain += '**'
      i += 2
      continue
    }

    if (ch === '*') {
      const close = line.indexOf('*', i + 1)
      const content = close === -1 ? '' : line.slice(i + 1, close)
      if (close !== -1 && isSpanContent(content)) {
        flush()
        out.push({ text: content, italic: true })
        i = close + 1
        continue
      }
      plain += '*'
      i += 1
      continue
    }

    plain += ch
    i += 1
  }
  flush()
  return out
}
