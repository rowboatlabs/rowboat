import { describe, expect, it } from 'vitest';
import { containsRowboatAddress, decorateMentions, mentionToken, resolveMentions } from './spaces.js';

// The app's faces over the protocol's mention grammar: a token carries the id,
// the roster supplies the name, and nothing is ever read out of a bare word.

const arjun = { id: '01M0F8S2MC8HYMF4MYWM61MR7B', displayName: 'Arjun Kumar' };
const names = new Map([[arjun.id, arjun.displayName]]);
const tok = (id: string, label: string) => mentionToken({ kind: 'member', id, label });

describe('containsRowboatAddress', () => {
  it('is the token, never the word', () => {
    expect(containsRowboatAddress('[@rowboat](#rowboat) move SSO to P1')).toBe(true);
    expect(containsRowboatAddress('yes — [@rowboat](#rowboat) do it')).toBe(true);
    expect(containsRowboatAddress('@rowboat move SSO to P1')).toBe(false);
    expect(containsRowboatAddress('the rowboat brand is growing on me')).toBe(false);
    expect(containsRowboatAddress('the trigger is `[@rowboat](#rowboat)` in a message')).toBe(false);
    expect(containsRowboatAddress('```\n[@rowboat](#rowboat) do the thing\n```')).toBe(false);
  });
});

describe('decorateMentions / resolveMentions', () => {
  it('render a token by its CURRENT name, keep an unknown id\'s label, and leave code alone', () => {
    const body = `ping ${tok(arjun.id, 'Old Name')} and ${tok('ghost', 'Ghost')} and [@here](#here) \`${tok(arjun.id, 'x')}\``;
    expect(decorateMentions(body, names)).toBe(`ping **@Arjun Kumar** and **@Ghost** and **@here** \`${tok(arjun.id, 'x')}\``);
    expect(resolveMentions(body, names)).toBe(`ping @Arjun Kumar and @Ghost and @here \`${tok(arjun.id, 'x')}\``);
  });

  it('a bare @name or @id is prose and renders as typed', () => {
    expect(decorateMentions('@Arjun Kumar and @01M0F8S2MC8HYMF4MYWM61MR7B', names)).toBe('@Arjun Kumar and @01M0F8S2MC8HYMF4MYWM61MR7B');
    expect(resolveMentions('mail arjun@rowboat.com', names)).toBe('mail arjun@rowboat.com');
  });
});
