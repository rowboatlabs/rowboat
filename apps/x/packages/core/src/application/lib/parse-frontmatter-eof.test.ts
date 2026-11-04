import { describe, expect, it } from 'vitest';
import { splitFrontmatter, joinFrontmatter } from './parse-frontmatter.js';

describe('frontmatter closing fences', () => {
  it.each(['\n', '\r\n'])('accepts an EOF fence with %j line endings', (newline) => {
    expect(splitFrontmatter(['---', 'live: true', '---'].join(newline))).toEqual({ frontmatter: { live: true }, body: '' });
  });
  it('preserves body whitespace after a newline-terminated fence', () => {
    const body = '\n  content  \n\n';
    expect(splitFrontmatter(joinFrontmatter({ live: true }, body))).toEqual({ frontmatter: { live: true }, body });
  });
  it('does not recognize a fence prefix as a closing fence', () => {
    const content = '---\nlive: true\n---suffix';
    expect(splitFrontmatter(content)).toEqual({ frontmatter: {}, body: content });
  });
});
