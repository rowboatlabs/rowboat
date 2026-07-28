import { describe, expect, it } from 'vitest'
import { rewriteWikiLinksForRenamedFileInMarkdown as rewrite } from './wiki-links'

const FROM = 'knowledge/Topics/Old Name.md'
const TO = 'knowledge/Topics/New Name.md'

describe('rewriteWikiLinksForRenamedFileInMarkdown', () => {
  it('rewrites a full-path link', () => {
    expect(rewrite('see [[Topics/Old Name]]', FROM, TO)).toBe('see [[Topics/New Name]]')
  })

  it('rewrites a bare-name link to the new bare name', () => {
    expect(rewrite('see [[Old Name]]', FROM, TO)).toBe('see [[New Name]]')
  })

  it('preserves the knowledge/ prefix when the link had one', () => {
    expect(rewrite('[[knowledge/Topics/Old Name]]', FROM, TO)).toBe('[[knowledge/Topics/New Name]]')
  })

  it('preserves an explicit .md extension', () => {
    expect(rewrite('[[Topics/Old Name.md]]', FROM, TO)).toBe('[[Topics/New Name.md]]')
  })

  it('preserves alias and anchor suffixes', () => {
    expect(rewrite('[[Topics/Old Name#Section|the label]]', FROM, TO))
      .toBe('[[Topics/New Name#Section|the label]]')
  })

  it('leaves unrelated links alone', () => {
    const md = 'see [[Topics/Something Else]] and [[People/Ada]]'
    expect(rewrite(md, FROM, TO)).toBe(md)
  })

  it('rewrites every occurrence, not just the first', () => {
    expect(rewrite('[[Old Name]] then [[Old Name]]', FROM, TO))
      .toBe('[[New Name]] then [[New Name]]')
  })

  it('is a no-op when either path is outside knowledge/ or is not markdown', () => {
    const md = '[[Topics/Old Name]]'
    expect(rewrite(md, 'other/Topics/Old Name.md', TO)).toBe(md)
    expect(rewrite(md, FROM, 'knowledge/Topics/New Name.txt')).toBe(md)
  })

  it('matches the source path case-insensitively', () => {
    expect(rewrite('[[topics/old name]]', FROM, TO)).toBe('[[Topics/New Name]]')
  })
})
