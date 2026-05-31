import type { docs_v1 } from 'googleapis';

/**
 * Convert a Markdown note body into Google Docs API batchUpdate requests that
 * recreate the content with structure preserved — headings, bold/italic,
 * bullet & numbered lists, and links — instead of flattening everything to
 * plain text.
 *
 * Strategy: the doc body is cleared first (see syncLinkedGoogleDocFromMarkdown),
 * then we insert all paragraph text in one shot at `insertIndex` and layer
 * paragraph/text styling on top using ranges computed against the inserted
 * text. Style requests do not shift indices, so a single insertText followed by
 * style updates stays index-stable within one batchUpdate.
 *
 * Out of scope (degrade to plain paragraphs): tables, images, code fences,
 * blockquotes, nested lists.
 */

type InlineRange = {
  start: number;
  end: number;
  bold?: boolean;
  italic?: boolean;
  link?: string;
};

type Block = {
  text: string;
  ranges: InlineRange[];
  paragraph: 'normal' | 'heading';
  headingLevel?: number;
  list?: 'bullet' | 'number';
};

const HEADING_NAMED_STYLE: Record<number, string> = {
  1: 'HEADING_1',
  2: 'HEADING_2',
  3: 'HEADING_3',
  4: 'HEADING_4',
  5: 'HEADING_5',
  6: 'HEADING_6',
};

/**
 * Parse a single line's inline Markdown (bold, italic, code, links) into plain
 * text plus the style ranges that apply to it. Offsets are relative to the
 * returned text. Nested emphasis is not handled; inner markers are kept as-is.
 */
export function parseInline(raw: string): { text: string; ranges: InlineRange[] } {
  let text = '';
  const ranges: InlineRange[] = [];
  let i = 0;

  while (i < raw.length) {
    const rest = raw.slice(i);

    // Link: [label](url)
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      const start = text.length;
      text += link[1];
      ranges.push({ start, end: text.length, link: link[2] });
      i += link[0].length;
      continue;
    }

    // Bold: **text** or __text__
    const bold = /^(\*\*|__)(.+?)\1/.exec(rest);
    if (bold) {
      const start = text.length;
      text += bold[2];
      ranges.push({ start, end: text.length, bold: true });
      i += bold[0].length;
      continue;
    }

    // Italic: *text* or _text_
    const italic = /^(\*|_)([^*_]+?)\1/.exec(rest);
    if (italic) {
      const start = text.length;
      text += italic[2];
      ranges.push({ start, end: text.length, italic: true });
      i += italic[0].length;
      continue;
    }

    // Inline code: `text` — kept as text, no monospace styling applied.
    const code = /^`([^`]+)`/.exec(rest);
    if (code) {
      text += code[1];
      i += code[0].length;
      continue;
    }

    text += raw[i];
    i += 1;
  }

  return { text, ranges };
}

function parseBlock(line: string): Block {
  const heading = /^(#{1,6})\s+(.*)$/.exec(line);
  if (heading) {
    const { text, ranges } = parseInline(heading[2]);
    return { text, ranges, paragraph: 'heading', headingLevel: heading[1].length };
  }

  const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
  if (bullet) {
    const { text, ranges } = parseInline(bullet[1]);
    return { text, ranges, paragraph: 'normal', list: 'bullet' };
  }

  const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
  if (numbered) {
    const { text, ranges } = parseInline(numbered[1]);
    return { text, ranges, paragraph: 'normal', list: 'number' };
  }

  const { text, ranges } = parseInline(line);
  return { text, ranges, paragraph: 'normal' };
}

/**
 * Build the batchUpdate requests for the given Markdown body. Each line becomes
 * one paragraph (blank lines included, to preserve spacing).
 */
export function markdownToDocsRequests(
  body: string,
  insertIndex = 1,
): docs_v1.Schema$Request[] {
  const trimmed = body.replace(/\s+$/, '');
  if (!trimmed) return [];

  const blocks = trimmed.split('\n').map(parseBlock);

  // Concatenate every block's text, each terminated by a newline that ends its
  // paragraph. Track where each block starts in the inserted text.
  let fullText = '';
  const starts: number[] = [];
  for (const block of blocks) {
    starts.push(insertIndex + fullText.length);
    fullText += `${block.text}\n`;
  }

  const requests: docs_v1.Schema$Request[] = [
    { insertText: { location: { index: insertIndex }, text: fullText } },
  ];

  blocks.forEach((block, idx) => {
    const start = starts[idx];
    const textEnd = start + block.text.length;
    const paraEnd = textEnd + 1; // include the trailing newline

    if (block.paragraph === 'heading' && block.headingLevel) {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: start, endIndex: paraEnd },
          paragraphStyle: { namedStyleType: HEADING_NAMED_STYLE[block.headingLevel] },
          fields: 'namedStyleType',
        },
      });
    }

    if (block.list && block.text.length > 0) {
      requests.push({
        createParagraphBullets: {
          range: { startIndex: start, endIndex: paraEnd },
          bulletPreset: block.list === 'number'
            ? 'NUMBERED_DECIMAL_ALPHA_ROMAN'
            : 'BULLET_DISC_CIRCLE_SQUARE',
        },
      });
    }

    for (const r of block.ranges) {
      if (r.end <= r.start) continue;
      const range = { startIndex: start + r.start, endIndex: start + r.end };
      if (r.bold) {
        requests.push({ updateTextStyle: { range, textStyle: { bold: true }, fields: 'bold' } });
      }
      if (r.italic) {
        requests.push({ updateTextStyle: { range, textStyle: { italic: true }, fields: 'italic' } });
      }
      if (r.link) {
        requests.push({
          updateTextStyle: { range, textStyle: { link: { url: r.link } }, fields: 'link' },
        });
      }
    }
  });

  return requests;
}
