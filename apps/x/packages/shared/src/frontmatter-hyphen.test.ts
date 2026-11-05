import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from './frontmatter.js';

describe('hyphenated frontmatter properties', () => {
  it('retains scalar keys containing hyphens', () => {
    expect(parseFrontmatter('---\nfavorite-color: blue\ncreated-at: today\nfavorite_color: green\n---\nbody')).toEqual({
      fields: { 'favorite-color': 'blue', 'created-at': 'today', favorite_color: 'green' }, body: 'body',
    });
  });
  it('assigns list items to the hyphenated key', () => {
    expect(parseFrontmatter('---\nfirst:\n  - one\nrelated-notes:\n  - two\n---\n').fields).toEqual({
      first: ['one'], 'related-notes': ['two'],
    });
  });
  it('preserves existing space and single-character keys', () => {
    expect(parseFrontmatter('---\na: yes\nfull name: Ada\n---\n').fields).toEqual({ a: 'yes', 'full name': 'Ada' });
  });
});
