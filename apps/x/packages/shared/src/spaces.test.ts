import { describe, expect, it } from 'vitest';
import { containsHereAddress, containsRowboatAddress, mentionsMember, stripNonAddressRegions } from './spaces.js';

const arjun = { id: '01M0F8S2MC8HYMF4MYWM61MR7B', displayName: 'Arjun Kumar' };

describe('stripNonAddressRegions', () => {
  it('drops code fences, inline code and quoted lines', () => {
    expect(stripNonAddressRegions('a ```@arjun``` b')).not.toContain('@arjun');
    expect(stripNonAddressRegions('a `@arjun` b')).not.toContain('@arjun');
    expect(stripNonAddressRegions('> @arjun said this')).not.toContain('@arjun');
  });
});

describe('mentionsMember', () => {
  it('matches the display name — what the composer inserts', () => {
    expect(mentionsMember('@Arjun Kumar can you review this?', arjun)).toBe(true);
    expect(mentionsMember('ping @arjun kumar.', arjun)).toBe(true); // case + trailing punctuation
    expect(mentionsMember('(@Arjun Kumar) heads up', arjun)).toBe(true);
  });

  it('still matches the opaque id (agent-written and older messages)', () => {
    expect(mentionsMember('@01M0F8S2MC8HYMF4MYWM61MR7B take a look', arjun)).toBe(true);
  });

  it('does not match a longer name, a cite, or an email', () => {
    expect(mentionsMember('@Arjun Kumaraswamy shipped it', arjun)).toBe(false);
    expect(mentionsMember('> @Arjun Kumar said no', arjun)).toBe(false);
    expect(mentionsMember('mail arjun@rowboat.com', arjun)).toBe(false);
    expect(mentionsMember('Arjun Kumar without the at-sign', arjun)).toBe(false);
  });

  it('falls back to the id when the member has no display name', () => {
    expect(mentionsMember('@01M0F8S2MC8HYMF4MYWM61MR7B hi', { id: '01M0F8S2MC8HYMF4MYWM61MR7B' })).toBe(true);
  });

  it('leaves @rowboat alone', () => {
    expect(containsRowboatAddress('@rowboat summarise this')).toBe(true);
    expect(containsRowboatAddress('email@rowboat.com')).toBe(false);
  });
});

describe('containsHereAddress', () => {
  it('matches a genuine @here address, any case', () => {
    expect(containsHereAddress('@here standup in 5')).toBe(true);
    expect(containsHereAddress('heads up @HERE.')).toBe(true);
    expect(containsHereAddress('(@here) deploy going out')).toBe(true);
  });

  it('ignores longer handles, cites, code, and emails', () => {
    expect(containsHereAddress('@hereabouts is a word')).toBe(false);
    expect(containsHereAddress('> @here said someone else')).toBe(false);
    expect(containsHereAddress('use `@here` sparingly')).toBe(false);
    expect(containsHereAddress('mail me@here.com')).toBe(false);
    expect(containsHereAddress('come here now')).toBe(false);
  });
});
