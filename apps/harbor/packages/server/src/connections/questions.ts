import type { JevAnswer, JevQuestion, Json } from '../jev.js';

// What a space connection asks Jev (spec §8 Space connections, 2026-11-28):
// one yes/no per event, "is this worth a post in this space". Built the way
// the graph's questions are (graph/questions.ts): code assembles the state,
// Jev answers a narrow typed question with a probability, and code applies
// the line. Jev never writes the post; that is the writer's (write.ts). Pure,
// so it is tested without the network.

export interface WorthInput {
  spaceName: string;
  /** What the space is about, when it keeps a graph: its topics' labels, busiest first. */
  topics: readonly string[];
  app: string;
  /** The trigger's name and what it fires on, in the app's own words. */
  trigger: { name: string; description: string };
  title?: string;
  /** The payload as a model reads it (payload.ts digest). */
  payload: Json;
  /** Whether the space already has a thread about the same thing: a follow-up to something it was told. */
  followsUp: boolean;
}

/** How many of the space's topics Jev is shown. */
export const WORTH_TOPICS = 40;

/**
 * At or above this an event is posted. The midpoint, as a start: it is tuned
 * in the rowboat space against what the skipped list shows (2026-11-28).
 */
export const WORTH_MIN = 0.5;

export function worthRequest(input: WorthInput): { state: Json; questions: Record<string, JevQuestion> } {
  const state: Json = {
    space: {
      name: input.spaceName,
      ...(input.topics.length > 0 ? { works_on: input.topics.slice(0, WORTH_TOPICS) } : {}),
    },
    update: {
      from: input.app,
      event: input.trigger.name,
      ...(input.trigger.description ? { event_means: input.trigger.description } : {}),
      ...(input.title ? { title: input.title } : {}),
      already_has_a_thread_here: input.followsUp,
      details: input.payload,
    },
  };
  return {
    state,
    questions: {
      worth: {
        type: 'noul',
        instructions:
          'A team chat space receives automatic updates from an app it connected. Should this update be posted in the space? ' +
          'Yes when a teammate would want to see it now: something new was opened or reported, work changed state in a way that matters ' +
          '(started, blocked, done, merged, closed, reopened, failed, assigned, due or escalated), someone said something of substance, ' +
          'or it touches what the space works on. No when it is routine churn nobody acts on: a label, order, estimate or formatting ' +
          'change, an edit that changes no meaning, an automated or bot-made update, or a repeat of what the space was already told.',
      },
    },
  };
}

/** Jev's probability that the event is worth a post. */
export function worthAnswer(answers: Readonly<Record<string, JevAnswer>>): number {
  const worth = answers.worth;
  if (worth?.type !== 'noul') throw new Error('the worth judgment is missing');
  return Math.round(worth.noul * 1000) / 1000;
}
