// Ready-made ideas for a new scheduled task (Baarali, 02/10/2026). Each one
// fills the description field; the person adjusts it and Baarali sets up the
// rest. They only use what the app can reach: email, calendar, meeting
// notes, the web and the to-do list.

export type TaskIdea = { title: string; when: string; prompt: string }

export const TASK_IDEAS: TaskIdea[] = [
  {
    title: 'Morning summary',
    when: 'Every day · Email, calendar',
    prompt: 'Every morning at 7, sum up my unread emails and today\'s meetings in five lines, with what I should do first.',
  },
  {
    title: 'Prepare my meetings',
    when: 'Every evening · Calendar',
    prompt: 'Every evening at 6, prepare tomorrow\'s meetings: who will be there, what we said last time, and the questions to ask.',
  },
  {
    title: 'Meeting minutes',
    when: 'After each meeting',
    prompt: 'When a meeting\'s notes are ready, write short minutes: the decisions, who does what, and by when.',
  },
  {
    title: 'Important emails',
    when: 'Each email · Email',
    prompt: 'When a client or a partner writes to me, sum up the message and prepare a draft reply, without sending it.',
  },
  {
    title: 'Keep watch on a topic',
    when: 'Every week · Web',
    prompt: 'Every Friday at 9, search the web for what was said this week about [my sector, my competitors] and sum it up with the sources.',
  },
  {
    title: 'Weekly review',
    when: 'Every Friday · To-do',
    prompt: 'Every Friday at 5 pm, review my week: what got done, what is left on my to-do list, and what is stuck.',
  },
]

/** A text in the person's language, for a field's value, which the
 * translation layer does not see (apps/baarali desktop src/i18n/index.ts). */
export function say(text: string): string {
  const t = (window as { __baaraliText?: (text: string) => string }).__baaraliText
  return t ? t(text) : text
}
