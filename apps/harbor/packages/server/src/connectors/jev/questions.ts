import type { Member } from '@rowboat/spaces-protocol';
import type { Json, NoulQuestion } from './api.js';

// Who a message needs (spec §8 Jev, 2026-10-07), built the System One way:
// code picks the candidates and assembles the state, Jev answers one yes/no
// question per candidate in one request, and code applies the threshold. Jev
// never sees a member id: `member_N` maps back to the candidate here. Pure, so
// it is testable without the network; connector.ts wires it up.

/** A tag notifies a person or starts an agent's turn, so the list Jev judges is short and the bar high. */
export const MAX_CANDIDATES = 15;
export const TAG_MIN_PROBABILITY = 0.7;
export const MAX_TAGS = 3;
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_THREAD_MESSAGES = 10;
export const MAX_THREAD_CHARS = 400;

/** What an agent is underneath, in words, for the kinds Harbor knows (core.ts AGENT_PAIRS). */
const AGENT_KINDS: Record<string, string> = {
  'claude-code': 'Claude Code, a coding agent',
  codex: 'Codex, a coding agent',
  cursor: 'Cursor, a coding agent',
  opencode: 'OpenCode, a coding agent',
  pi: 'Pi, a coding agent',
  'muse-code': 'Muse Code, a coding agent',
  hermes: 'Hermes, a general assistant agent',
  openclaw: 'OpenClaw, a general assistant agent',
};

export interface TagInput {
  spaceName: string;
  /** The message, its tokens written as plain "@Name" text. */
  message: { authorId: string; text: string };
  /** The thread before it, oldest first, the same way; empty for a new message in the stream. */
  thread: Array<{ authorId: string; text: string }>;
  /** The space's members. */
  members: readonly Member[];
  jevId: string;
  /** Who the message already tags. */
  mentioned: readonly string[];
  /** It addresses @here: every person is notified already. */
  here: boolean;
  /** Agents with a turn queued or running in this thread: a tag would only queue another. */
  busyAgents: ReadonlySet<string>;
  /** False past the hop limit: a tag could not start an agent's turn. */
  agentsAllowed: boolean;
}

function clip(text: string, max: number): string {
  const flat = text.trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function names(text: string, name: string): boolean {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.length > 0 && new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
}

/**
 * The members Jev is asked about, strongest first: those the message names,
 * then those who wrote in the thread, then the rest. Never the author, Jev,
 * anyone already tagged, an agent already at work in the thread, an agent
 * past the hop limit, or a person when @here already reached everyone.
 */
export function selectCandidates(input: TagInput): Member[] {
  const tagged = new Set(input.mentioned);
  const wrote = new Set(input.thread.map((m) => m.authorId));
  const eligible = input.members.filter((m) => {
    if (m.id === input.message.authorId || m.id === input.jevId || tagged.has(m.id)) return false;
    if (m.kind === 'agent') return input.agentsAllowed && !input.busyAgents.has(m.id);
    return !input.here;
  });
  const rank = (m: Member) => (names(input.message.text, m.displayName) ? 0 : wrote.has(m.id) ? 1 : 2);
  return eligible
    .map((m, i) => ({ m, i, r: rank(m) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, MAX_CANDIDATES)
    .map(({ m }) => m);
}

const CONTEXT =
  'This is a team chat where people and agents work together. A tag notifies a person, and starts an agent working on the message. `thread` is the conversation the message replies in, oldest first.';
const YES_WHEN =
  'The message is addressed to them by name or by role, asks them a question, hands them work, or answers or follows up on something they asked or did in `thread`';
// Agents get one more sentence (2026-10-07, Arjun in Spaces): unlike a person,
// an agent does not follow a thread it wrote in. It sees only messages that tag
// it, so an untagged follow-up meant for it never reaches it, and Ro must tag it.
const AGENT_CONTEXT =
  'Unlike a person, an agent sees only messages that tag it, even in a thread it has already written in: a message meant for it that does not tag it never reaches it.';

const memberKey = (index: number) => `member_${index + 1}`;

export function buildQuestions(input: TagInput, candidates: readonly Member[]): { state: Json; questions: Record<string, NoulQuestion> } {
  const byId = new Map(input.members.map((m) => [m.id, m]));
  const who = (id: string) => byId.get(id)?.displayName ?? 'someone who left';
  const author = byId.get(input.message.authorId);
  const wrote = new Set(input.thread.map((m) => m.authorId));
  const state: Record<string, Json> = {
    space: input.spaceName,
    message: {
      author: who(input.message.authorId),
      author_is: author?.kind === 'agent' ? 'an agent' : 'a person',
      text: clip(input.message.text, MAX_MESSAGE_CHARS),
    },
    members: candidates.map((m, i) => {
      const entry: Record<string, Json> = { id: memberKey(i), name: m.displayName, is: m.kind === 'agent' ? 'an agent' : 'a person' };
      const kind = m.kind === 'agent' ? AGENT_KINDS[m.agentKind ?? ''] : undefined;
      if (kind) entry.agent = kind;
      if (wrote.has(m.id)) entry.wrote_in_thread = true;
      return entry;
    }),
  };
  if (input.thread.length > 0) {
    state.thread = input.thread.slice(-MAX_THREAD_MESSAGES).map((m) => ({ author: who(m.authorId), text: clip(m.text, MAX_THREAD_CHARS) }));
  }
  const questions: Record<string, NoulQuestion> = {};
  candidates.forEach((m, i) => {
    questions[memberKey(i)] = {
      type: 'noul',
      instructions: {
        question: `Should \`message\` tag \`members[${i}]\` so that they see it and act on it?`,
        context: m.kind === 'agent' ? `${CONTEXT} ${AGENT_CONTEXT}` : CONTEXT,
        yes_when: m.kind === 'agent' ? `${YES_WHEN}, including a follow-up meant for them in a thread they already wrote in` : YES_WHEN,
        not_when:
          'Their name only comes up in passing, they are merely in the space, the message is meant for someone else, or the message is a remark that needs no one',
      },
      criteria: { true: 'The author meant them to see it and act', false: 'Tagging them would be noise' },
    };
  });
  return { state, questions };
}

/** Code's half: the candidates over the bar, strongest first, at most MAX_TAGS. */
export function decideTags(answers: Record<string, number>, candidates: readonly Member[]): Member[] {
  return candidates
    .map((m, i) => ({ m, p: answers[memberKey(i)] ?? 0 }))
    .filter((x) => x.p >= TAG_MIN_PROBABILITY)
    .sort((a, b) => b.p - a.p)
    .slice(0, MAX_TAGS)
    .map(({ m }) => m);
}
