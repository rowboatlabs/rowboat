import { describe, expect, it } from 'vitest';
import { markdownToDocsRequests, parseInline } from './markdown-to-docs.js';

describe('parseInline', () => {
  it('extracts bold, italic and link ranges with offsets relative to the plain text', () => {
    expect(parseInline('a **b** c')).toEqual({
      text: 'a b c',
      ranges: [{ start: 2, end: 3, bold: true }],
    });
    expect(parseInline('see [docs](https://x.dev) now')).toEqual({
      text: 'see docs now',
      ranges: [{ start: 4, end: 8, link: 'https://x.dev' }],
    });
    expect(parseInline('_em_')).toEqual({
      text: 'em',
      ranges: [{ start: 0, end: 2, italic: true }],
    });
  });

  it('keeps inline code text without styling', () => {
    expect(parseInline('run `npm test`')).toEqual({ text: 'run npm test', ranges: [] });
  });
});

describe('markdownToDocsRequests', () => {
  it('returns no requests for an empty body', () => {
    expect(markdownToDocsRequests('   \n\n')).toEqual([]);
  });

  it('inserts the full text first, then layers styles at the right indices', () => {
    const reqs = markdownToDocsRequests('# Hello\n\nworld **bold**');

    // First request inserts all paragraph text at index 1.
    expect(reqs[0]).toEqual({
      insertText: { location: { index: 1 }, text: 'Hello\n\nworld bold\n' },
    });

    // Heading 1 applied to "Hello\n" → [1, 7).
    expect(reqs).toContainEqual({
      updateParagraphStyle: {
        range: { startIndex: 1, endIndex: 7 },
        paragraphStyle: { namedStyleType: 'HEADING_1' },
        fields: 'namedStyleType',
      },
    });

    // "bold" sits at [14, 18) in the inserted text.
    expect(reqs).toContainEqual({
      updateTextStyle: {
        range: { startIndex: 14, endIndex: 18 },
        textStyle: { bold: true },
        fields: 'bold',
      },
    });
  });

  it('maps bullet and numbered lists to the right bullet presets', () => {
    const bullets = markdownToDocsRequests('- one\n- two');
    const bulletReqs = bullets.filter((r) => 'createParagraphBullets' in r);
    expect(bulletReqs).toHaveLength(2);
    expect(bulletReqs[0]).toMatchObject({
      createParagraphBullets: { bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE' },
    });

    const numbered = markdownToDocsRequests('1. first\n2. second');
    const numberedReqs = numbered.filter((r) => 'createParagraphBullets' in r);
    expect(numberedReqs).toHaveLength(2);
    expect(numberedReqs[0]).toMatchObject({
      createParagraphBullets: { bulletPreset: 'NUMBERED_DECIMAL_ALPHA_ROMAN' },
    });
  });

  it('emits a link textStyle request', () => {
    const reqs = markdownToDocsRequests('see [docs](https://x.dev)');
    expect(reqs).toContainEqual({
      updateTextStyle: {
        range: { startIndex: 5, endIndex: 9 },
        textStyle: { link: { url: 'https://x.dev' } },
        fields: 'link',
      },
    });
  });
});
