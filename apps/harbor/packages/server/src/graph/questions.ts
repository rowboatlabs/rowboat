import type { GraphEdge, GraphRelation, GraphThreadKind, GraphTopicCategory } from '@rowboat/spaces-protocol';
import type { JevAnswer, JevQuestion, Json } from '../jev.js';
import { codeIn, plainText, referencesIn, topicPattern } from './text.js';

// What the space graph asks Jev (spec §8 Space graph, 2026-11-12). Built the
// System One way, as the desktop's route_questions.ts is: code assembles the
// state and a bounded candidate set, Jev answers narrow typed questions, and
// code turns the probabilities into edges. Jev never sees a member id or a
// message id; option keys map back here. Pure, so it is tested without the
// network; core/graph.ts wires it to the client and the store. The wording
// and the multipliers are the ones the 2026-11-12 experiment ran on one
// space: starting points, to be tuned against hand-labelled edges.

export interface GraphMessage {
  id: string;
  memberId: string;
  body: string;
  postedAt: string;
}

export interface GraphThreadInput {
  rootMessageId: string;
  /** The discussion's title, when the thread has one. */
  title?: string;
  /** Live messages only, oldest first. */
  messages: GraphMessage[];
}

export interface GraphTopic {
  key: string;
  /** The label, then every alias. */
  labels: string[];
}

export interface ThreadCandidates {
  topics: GraphTopic[];
  code: string[];
  references: string[];
  /** The authors asked about, busiest first. */
  members: string[];
}

export interface MemberLabel {
  name: string;
  agent: boolean;
}

export type StoredEdge = Omit<GraphEdge, 'rootMessageId'>;

export interface ThreadJudgment {
  kind: GraphThreadKind;
  kindProbability: number;
  resolved: number;
  decision: number;
  importance: number;
  edges: StoredEdge[];
}

export const MAX_TOPICS = 14;
export const MAX_CODE = 8;
export const MAX_REFERENCES = 12;
export const MAX_MEMBERS = 6;
// A long thread keeps its opening and its ending, where the ask and the outcome are.
const STATE_CHARS = 56_000;
const MESSAGE_CHARS = 2_500;
const HEAD_MESSAGES = 8;

const KINDS: Record<GraphThreadKind, string> = {
  bug: 'Something is broken: a defect is reported, investigated or fixed',
  feature: 'A new capability or change is requested, designed or built',
  question: 'Someone asks how something works or asks for information, and gets an explanation',
  decision: 'A product or technical choice is debated or made',
  review: 'Feedback on a pull request or on finished work',
  ops: 'Deploys, releases, infrastructure, accounts, access, billing or incidents',
  routine: 'A recurring ritual or automated report: standup, triage digest, scheduled job output',
  idea: 'Open-ended brainstorming, research or an experiment',
  chatter: 'A greeting, a test message, a link share or social talk with no work in it',
};
const REFERENCE_ROLES = {
  produced: 'This pull request or issue was opened as the result of the work done in this conversation',
  subject: 'It already existed and the conversation is about it: reviewing, debugging, merging or discussing it',
  context: 'It is only mentioned in passing, as background or a pointer',
} as const;
const MEMBER_ROLES = {
  requester: 'Asked for the work or asked the question',
  doer: 'Did the work or gave the answer',
  decider: 'Made the call: chose between options, approved or rejected',
  reviewer: "Gave feedback or corrections on someone else's work",
  bystander: 'Barely took part: was only mentioned, or added a passing remark',
} as const;
const IMPORTANCE = [
  'Trivial: a greeting, a test, or noise',
  'Routine: a small question or a recurring report',
  'Ordinary work: one bug fixed or one small change made',
  'Notable: a feature shipped, or a decision that changes how something works',
  "Major: a release, an incident, or a decision that reshapes the product or the team's direction",
];

// How much of an edge's activity counts, by what Jev said the edge is.
const MEMBER_STRENGTH: Record<keyof typeof MEMBER_ROLES, number> = { doer: 1, decider: 1, requester: 0.9, reviewer: 0.8, bystander: 0.2 };
const REFERENCE_STRENGTH: Record<keyof typeof REFERENCE_ROLES, number> = { produced: 1, subject: 0.8, context: 0.25 };
const UNASKED_MEMBER_STRENGTH = 0.3;
const SOLO_MEMBER_STRENGTH = 0.9;
const UNASKED_REFERENCE_STRENGTH = 0.15;
/** A topic or identifier Jev is this sure is not the subject leaves no edge. */
const MIN_SUBJECT = 0.05;

const round = (n: number): number => Math.round(n * 100) / 100;

/** Everything the parsers find in a thread, bounded: the set Jev is asked about. */
export function threadCandidates(
  thread: GraphThreadInput,
  topics: readonly (GraphTopic & { threads: number })[],
  context: { threadCount: number; mainRepo: string | undefined; sharedCode: ReadonlySet<string> },
): ThreadCandidates {
  const text = thread.messages.map((m) => m.body).join('\n');
  const scored: { topic: GraphTopic; weight: number }[] = [];
  for (const topic of topics) {
    const hits = text.match(topicPattern(topic.labels))?.length ?? 0;
    // Rare across the space and frequent here: the usual measure of "about".
    if (hits > 0) scored.push({ topic, weight: hits * Math.log(context.threadCount / Math.max(1, topic.threads) + 1) });
  }
  scored.sort((a, b) => b.weight - a.weight || (a.topic.key < b.topic.key ? -1 : 1));
  const authored = new Map<string, number>();
  for (const m of thread.messages) authored.set(m.memberId, (authored.get(m.memberId) ?? 0) + 1);
  return {
    topics: scored.slice(0, MAX_TOPICS).map((s) => ({ key: s.topic.key, labels: s.topic.labels })),
    code: codeIn(text).filter((c) => context.sharedCode.has(c)).slice(0, MAX_CODE),
    references: referencesIn(text, context.mainRepo),
    members: [...authored.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([id]) => id),
  };
}

export function threadRequest(
  thread: GraphThreadInput,
  candidates: ThreadCandidates,
  members: ReadonlyMap<string, MemberLabel>,
): { state: Json; questions: Record<string, JevQuestion> } {
  const rows = thread.messages.map((m, i) => {
    const who = members.get(m.memberId);
    return { n: i + 1, from: `${who?.name ?? 'A former member'} (${who?.agent ? 'AI agent' : 'person'})`, text: plainText(m.body).slice(0, MESSAGE_CHARS) };
  });
  let budget = STATE_CHARS;
  const head = rows.slice(0, HEAD_MESSAGES);
  for (const row of head) budget -= row.text.length;
  const tail: typeof rows = [];
  for (const row of rows.slice(HEAD_MESSAGES).reverse()) {
    if (budget - row.text.length < 0) break;
    tail.unshift(row);
    budget -= row.text.length;
  }
  const omitted = rows.length - head.length - tail.length;
  const state: Json = {
    conversation: 'One thread from a team chat where people and AI agents work together.',
    ...(thread.title ? { title: thread.title } : {}),
    messages: omitted > 0 ? [...head, { note: `${omitted} messages omitted here` }, ...tail] : [...head, ...tail],
  };
  const questions: Record<string, JevQuestion> = {
    kind: { type: 'choice', instructions: 'What kind of conversation is this thread?', criteria: KINDS },
    resolved: { type: 'noul', instructions: 'By its last message, is the matter of this thread settled: the question answered, the bug fixed, the change merged or the decision made, with nothing left waiting on anyone?' },
    decision: { type: 'noul', instructions: 'Does someone in this thread make an explicit decision: choosing between options, approving or rejecting a proposal, or setting a rule going forward?' },
    importance: { type: 'score', instructions: "How much does this thread matter to the team's work?", criteria: IMPORTANCE },
  };
  candidates.topics.forEach((topic, i) => {
    questions[`topic_${i}`] = { type: 'noul', instructions: { question: 'Is this a main subject of the thread: what the conversation is actually about, rather than something mentioned in passing or in boilerplate?', subject: topic.labels[0] ?? topic.key } };
  });
  candidates.code.forEach((code, i) => {
    questions[`code_${i}`] = { type: 'noul', instructions: { question: 'Is this code identifier, file or command central to the thread: the thing being changed, debugged or explained, rather than an incidental mention?', identifier: code } };
  });
  candidates.references.slice(0, MAX_REFERENCES).forEach((ref, i) => {
    questions[`reference_${i}`] = { type: 'choice', instructions: { question: 'What is this pull request or issue to the thread?', reference: ref }, criteria: REFERENCE_ROLES };
  });
  if (thread.messages.length > 1) {
    candidates.members.slice(0, MAX_MEMBERS).forEach((id, i) => {
      questions[`member_${i}`] = { type: 'choice', instructions: { question: 'What part does this member play in the thread?', member: members.get(id)?.name ?? 'A former member' }, criteria: MEMBER_ROLES };
    });
  }
  return { state, questions };
}

/** Every edge the thread has, with the events that touched it: one message is one unit, split across what it names and its author. */
export function threadJudgment(
  thread: GraphThreadInput,
  candidates: ThreadCandidates,
  answers: Readonly<Record<string, JevAnswer>>,
  mainRepo: string | undefined,
): ThreadJudgment {
  const noul = (key: string): number => { const a = answers[key]; return a?.type === 'noul' ? a.noul : 0; };
  const choice = (key: string): { choice: string; probability: number } | undefined => {
    const a = answers[key];
    return a?.type === 'choice' ? { choice: a.choice, probability: a.probabilities[a.choice] ?? 0 } : undefined;
  };
  const kind = choice('kind');
  const importance = answers.importance;
  if (!kind || importance?.type !== 'score') throw new Error('the thread judgments are missing');

  const edges = new Map<string, { relation: GraphRelation; probability: number | null; strength: number }>();
  const solo = candidates.members.length === 1 && thread.messages.length === 1;
  candidates.members.forEach((id, i) => {
    const role = choice(`member_${i}`);
    if (role) edges.set(`member:${id}`, { relation: role.choice as GraphRelation, probability: round(role.probability), strength: round(MEMBER_STRENGTH[role.choice as keyof typeof MEMBER_ROLES] * (0.5 + 0.5 * role.probability)) });
    else edges.set(`member:${id}`, solo ? { relation: 'requester', probability: null, strength: SOLO_MEMBER_STRENGTH } : { relation: 'participant', probability: null, strength: UNASKED_MEMBER_STRENGTH });
  });
  const matchers: { id: string; test: (body: string) => boolean }[] = [];
  candidates.topics.forEach((topic, i) => {
    const p = noul(`topic_${i}`);
    if (p < MIN_SUBJECT) return;
    edges.set(`topic:${topic.key}`, { relation: 'subject', probability: round(p), strength: round(p) });
    const pattern = topicPattern(topic.labels);
    matchers.push({ id: `topic:${topic.key}`, test: (body) => { pattern.lastIndex = 0; return pattern.test(body); } });
  });
  candidates.code.forEach((code, i) => {
    const p = noul(`code_${i}`);
    if (p < MIN_SUBJECT) return;
    edges.set(`code:${code}`, { relation: 'subject', probability: round(p), strength: round(p) });
    matchers.push({ id: `code:${code}`, test: (body) => body.includes(code) });
  });
  candidates.references.forEach((ref, i) => {
    const role = choice(`reference_${i}`);
    edges.set(`reference:${ref}`, role
      ? { relation: role.choice as GraphRelation, probability: round(role.probability), strength: round(REFERENCE_STRENGTH[role.choice as keyof typeof REFERENCE_ROLES] * (0.5 + 0.5 * role.probability)) }
      // Past the first twelve nothing was asked: the parser's word alone.
      : { relation: 'context', probability: null, strength: UNASKED_REFERENCE_STRENGTH });
    matchers.push({ id: `reference:${ref}`, test: (body) => referencesIn(body, mainRepo).includes(ref) });
  });

  const events = new Map<string, { at: string; share: number }[]>();
  for (const message of thread.messages) {
    const touched = [`member:${message.memberId}`, ...matchers.filter((m) => m.test(message.body)).map((m) => m.id)].filter((id) => edges.has(id));
    for (const id of touched) {
      const list = events.get(id) ?? [];
      list.push({ at: message.postedAt, share: round(Math.max(0.01, 1 / touched.length)) });
      events.set(id, list);
    }
  }
  const start = thread.messages[0]?.postedAt ?? new Date(0).toISOString();
  return {
    kind: kind.choice as GraphThreadKind,
    kindProbability: round(kind.probability),
    resolved: round(noul('resolved')),
    decision: round(noul('decision')),
    importance: round(Math.min(4, Math.max(0, importance.score))),
    // Jev linked it but no single message names it (a wording split across lines): credit the thread's start, lightly.
    edges: [...edges.entries()].map(([entityId, edge]) => ({ entityId, ...edge, events: events.get(entityId) ?? [{ at: start, share: 0.25 }] })),
  };
}

// --- the vocabulary: which candidates are topics, and which are one topic ----------------

const VOCABULARY_STATE = 'Phrases pulled automatically from a team chat where people and AI agents work together. Each question shows one phrase with excerpts where it occurred.';
const CATEGORIES: Record<GraphTopicCategory, string> = {
  external_product: 'A product, company or service made by someone else',
  own_component: "A named part of the team's own product or codebase: a server, package, module, app or agent",
  feature: "A user-facing capability or UI element of the team's product",
  practice: 'A recurring team activity or process: standup, triage, release, review',
  technology: 'A general technology, protocol, language or format',
};
/** A candidate at least this likely to name a real thing becomes a topic. */
export const TOPIC_MIN = 0.6;
/** Two topics scoring at least this, on a 0 to 2 scale, are one. */
export const SAME_TOPIC_MIN = 1.6;

export function vocabularyRequest(batch: readonly { label: string; excerpts: string[] }[]): { state: Json; questions: Record<string, JevQuestion> } {
  const questions: Record<string, JevQuestion> = {};
  batch.forEach((candidate, i) => {
    const data = { phrase: candidate.label, excerpts: candidate.excerpts };
    questions[`real_${i}`] = { type: 'noul', instructions: { question: 'Is this phrase the name of a specific thing or work topic that a teammate might look up: a product, company, component, feature, technology or recurring activity? Answer no for a generic phrase, a sentence fragment, boilerplate wording, a file extension, a date, a timezone, a pronoun or a UI button label.', ...data } };
    questions[`category_${i}`] = { type: 'choice', instructions: { question: 'What kind of thing does this phrase name?', ...data }, criteria: CATEGORIES };
  });
  return { state: VOCABULARY_STATE, questions };
}

export function vocabularyAnswers(count: number, answers: Readonly<Record<string, JevAnswer>>): { real: number; category: GraphTopicCategory }[] {
  return Array.from({ length: count }, (_unused, i) => {
    const real = answers[`real_${i}`];
    const category = answers[`category_${i}`];
    if (real?.type !== 'noul' || category?.type !== 'choice') throw new Error('the vocabulary judgments are missing');
    return { real: round(real.noul), category: category.choice as GraphTopicCategory };
  });
}

// Words too common to make two phrases candidates for being one topic.
const GENERIC = new Set(['app', 'agent', 'message', 'file', 'view', 'page', 'api', 'full', 'suite', 'web', 'thread', 'model', 'key', 'link', 'count', 'daily', 'new']);

/** Whether two topic keys are worth asking Jev about: one contains the other, or they share every word of the shorter. */
export function mayBeSameTopic(a: string, b: string): boolean {
  const wordsA = a.split(' ');
  const wordsB = b.split(' ');
  const shared = wordsA.filter((w) => wordsB.includes(w));
  if (shared.length === 0) return false;
  if (!shared.some((w) => !GENERIC.has(w)) && shared.length < 2) return false;
  return a.includes(b) || b.includes(a) || shared.length >= Math.min(wordsA.length, wordsB.length);
}

export function sameTopicRequest(pairs: readonly { first: { label: string; excerpts: string[] }; second: { label: string; excerpts: string[] } }[]): { state: Json; questions: Record<string, JevQuestion> } {
  const questions: Record<string, JevQuestion> = {};
  pairs.forEach((pair, i) => {
    questions[`same_${i}`] = {
      type: 'score',
      instructions: { question: 'Do these two phrases from the same team chat name the same thing?', first: { phrase: pair.first.label, excerpts: pair.first.excerpts }, second: { phrase: pair.second.label, excerpts: pair.second.excerpts } },
      criteria: [
        'Different things that merely share a word or appear together',
        'Related but distinct: one is a part, a kind, a feature or a user of the other',
        'The same thing under two names, spellings or wordings: a teammate would file both under one heading',
      ],
    };
  });
  return { state: 'Pairs of phrases from a team chat where people and AI agents work together.', questions };
}
