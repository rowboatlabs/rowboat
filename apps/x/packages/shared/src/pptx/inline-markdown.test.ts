import { describe, expect, it } from 'vitest'
import { parseInlineEmphasis } from './inline-markdown.js'

// The contract at the outline→runs boundary: matched markers become styled
// segments, unmatched markers stay literal text, and styled text never shows
// asterisk syntax. Every consumer (authored patterns, placeholder edits,
// baked slides, the edit tool) inherits exactly these semantics.
describe('parseInlineEmphasis', () => {
  it('splits bold mid-sentence into three segments', () => {
    expect(parseInlineEmphasis('Growth **doubled** in Q3')).toEqual([
      { text: 'Growth ' },
      { text: 'doubled', bold: true },
      { text: ' in Q3' },
    ])
  })

  it('splits italic and keeps surrounding text', () => {
    expect(parseInlineEmphasis('the *only* option')).toEqual([
      { text: 'the ' },
      { text: 'only', italic: true },
      { text: ' option' },
    ])
  })

  it('strips backticks and keeps code content plain and verbatim', () => {
    expect(parseInlineEmphasis('run `npm test` first')).toEqual([
      { text: 'run npm test first' },
    ])
    // Asterisks inside a code span are code, not emphasis.
    expect(parseInlineEmphasis('`a*b`')).toEqual([{ text: 'a*b' }])
  })

  it('keeps a lone asterisk literal', () => {
    expect(parseInlineEmphasis('5 * 3 = 15')).toEqual([{ text: '5 * 3 = 15' }])
    expect(parseInlineEmphasis('rated *')).toEqual([{ text: 'rated *' }])
  })

  it('keeps whitespace-edged spans literal (multiplication, not emphasis)', () => {
    expect(parseInlineEmphasis('a * b * c')).toEqual([{ text: 'a * b * c' }])
    expect(parseInlineEmphasis('2 ** 3 ** 4')).toEqual([{ text: '2 ** 3 ** 4' }])
  })

  it('keeps an unmatched double marker literal', () => {
    expect(parseInlineEmphasis('**almost bold')).toEqual([{ text: '**almost bold' }])
    expect(parseInlineEmphasis('****')).toEqual([{ text: '****' }])
  })

  it('degrades nested markers without showing asterisks', () => {
    // The outer span holds; inner markers are stripped, never rendered.
    expect(parseInlineEmphasis('**a *b* c**')).toEqual([{ text: 'a b c', bold: true }])
  })

  it('handles several spans and whole-line emphasis', () => {
    expect(parseInlineEmphasis('**Bold** and *italic*')).toEqual([
      { text: 'Bold', bold: true },
      { text: ' and ' },
      { text: 'italic', italic: true },
    ])
    expect(parseInlineEmphasis('**everything**')).toEqual([{ text: 'everything', bold: true }])
  })

  it('returns a plain line untouched, and an empty line as no segments', () => {
    expect(parseInlineEmphasis('No markers here.')).toEqual([{ text: 'No markers here.' }])
    expect(parseInlineEmphasis('')).toEqual([])
  })

  it('concatenated segment text equals the line minus matched markers', () => {
    const line = 'Ship **fast**, learn *faster*, `iterate`'
    const joined = parseInlineEmphasis(line).map((s) => s.text).join('')
    expect(joined).toBe('Ship fast, learn faster, iterate')
  })
})
