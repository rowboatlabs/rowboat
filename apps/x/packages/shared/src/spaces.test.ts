import { describe, expect, it } from 'vitest';
import { containsRowboatAddress, decorateMentions, followUpAgentId, mentionToken, mentionsAnyone, resolveMentions } from './spaces.js';
import type { Invocation } from '@rowboat/spaces-protocol';

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

  it('a space token renders as #Name from the listing, or its label when the reader is not in that space', () => {
    const body = `see [#Old](#space:S1) and [#Hidden](#space:S2)`;
    const spaceNames = new Map([['S1', 'General']]);
    expect(decorateMentions(body, names, spaceNames)).toBe('see **#General** and **#Hidden**');
    expect(resolveMentions(body, names, spaceNames)).toBe('see #General and #Hidden');
    expect(resolveMentions(body, names)).toBe('see #Old and #Hidden');
  });

  it('a bare @name or @id is prose and renders as typed', () => {
    expect(decorateMentions('@Arjun Kumar and @01M0F8S2MC8HYMF4MYWM61MR7B', names)).toBe('@Arjun Kumar and @01M0F8S2MC8HYMF4MYWM61MR7B');
    expect(resolveMentions('mail arjun@rowboat.com', names)).toBe('mail arjun@rowboat.com');
  });
});

describe('thread follow-ups (Harbor spec §8, 2026-10-27)', () => {
  const inv = (id: string, agentId: string, authorId: string, createdAt: string, state: Invocation['state'] = 'done', threadRootId = 'root') =>
    ({
      id, agentId, state, depth: 0, createdAt, updatedAt: createdAt,
      conversation: { spaceId: 's', threadRootId },
      trigger: { messageId: id, authorId, body: '' },
      where: { spaceKind: 'shared', spaceName: 'S' },
    }) as Invocation;
  const members = new Map([['ro', { agentKind: 'jev' }], ['hermes', {}], ['codex', {}]]);

  it('is the agent this person invoked last in this thread', () => {
    const all = [inv('1', 'hermes', 'me', '2026-10-27T09:00:00Z'), inv('2', 'codex', 'me', '2026-10-27T09:05:00Z')];
    expect(followUpAgentId(all, 'root', 'me', members)).toBe('codex');
  });

  it('skips other people’s, other threads’, refused ones and Ro', () => {
    const all = [
      inv('1', 'hermes', 'me', '2026-10-27T09:00:00Z'),
      inv('2', 'codex', 'alex', '2026-10-27T09:01:00Z'),
      inv('3', 'codex', 'me', '2026-10-27T09:02:00Z', 'done', 'elsewhere'),
      inv('4', 'codex', 'me', '2026-10-27T09:03:00Z', 'refused'),
      inv('5', 'ro', 'me', '2026-10-27T09:04:00Z'),
    ];
    expect(followUpAgentId(all, 'root', 'me', members)).toBe('hermes');
    expect(followUpAgentId(all, 'root', 'sam', members)).toBeUndefined();
  });

  it('a mention of anyone, @here or Ro counts; a bare name does not', () => {
    expect(mentionsAnyone(`${tok(arjun.id, 'Arjun')} look`)).toBe(true);
    expect(mentionsAnyone('[@here](#here) heads up')).toBe(true);
    expect(mentionsAnyone('[@rowboat](#rowboat) do it')).toBe(true);
    expect(mentionsAnyone('Arjun, look')).toBe(false);
  });
});
