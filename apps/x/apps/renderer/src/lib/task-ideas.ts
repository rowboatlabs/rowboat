// Ready-made ideas for a new scheduled task (Baarali, 02/10/2026). Each one
// fills the description field; the person adjusts it and Baarali sets up the
// rest. They only use what the app can reach: email, calendar, meeting
// notes, the web and the to-do list. Enriched 03/10/2026: each one says
// when, from where, in what shape, and what never to do (send).

import { CalendarCheck, FileText, Handshake, Mail, Receipt, Sun, Telescope, TrendingUp, type LucideIcon } from 'lucide-react'

export type TaskIdea = { title: string; when: string; prompt: string; icon: LucideIcon }

export const TASK_IDEAS: TaskIdea[] = [
  {
    title: "Morning summary",
    icon: Sun,
    when: "Every day \u00b7 Email, calendar",
    prompt: "Every morning at 7, send me a short brief of my day. Start with today's meetings: the time, who will be there and what it is about. Then the unread emails that need me, from clients, suppliers and partners first, each in one line with what is expected of me. End with the three things I should do first, in order. Leave out newsletters and notifications. Keep it under fifteen lines.",
  },
  {
    title: "Prepare my meetings",
    icon: CalendarCheck,
    when: "Every evening \u00b7 Calendar",
    prompt: "Every evening at 6, prepare tomorrow's meetings. For each one: the time and the people attending, what we said or decided the last time (from my notes and emails), what is still open between us, and three questions I should ask. If a document should be read beforehand, tell me which one. Skip reminders and blocked time slots.",
  },
  {
    title: "Meeting minutes",
    icon: FileText,
    when: "After each meeting",
    prompt: "When a meeting's notes are ready, write the minutes. At the top, in two sentences, what the meeting was for and how it ended. Then the decisions taken, then the actions: who does what, and by when. Put my own actions first so I can add them to my list. Do not send anything to the participants: I read it first.",
  },
  {
    title: "Important emails",
    icon: Mail,
    when: "Each email \u00b7 Email",
    prompt: "When a client, a supplier or a partner writes to me, sum up their message in two lines: what they want and by when. Then prepare a draft reply in my tone, polite and short, that answers each of their questions. If something is missing to reply, such as a price, a date or a document, tell me what. Never send the reply: leave it as a draft.",
  },
  {
    title: "Chase unpaid invoices",
    icon: Receipt,
    when: "Every Monday \u00b7 Email",
    prompt: "Every Monday at 8, look in my emails for the invoices and quotes I sent that have had no answer or payment for more than 7 days. List them with the client, the amount and the date sent. For each one, prepare a polite reminder as a draft, firmer if it is the second reminder. Never send anything yourself.",
  },
  {
    title: "Keep in touch with clients",
    icon: Handshake,
    when: "Every week \u00b7 Email",
    prompt: "Every Wednesday at 10, find in my emails the clients I have not written to for more than a month after an order or a quote. For each one, suggest a short message to keep in touch, such as news, a new product or a thank-you, as a draft. Five clients at most.",
  },
  {
    title: "Keep watch on a topic",
    icon: Telescope,
    when: "Every week \u00b7 Web",
    prompt: "Every Friday at 9, search the web for what was said this week about [my sector, my competitors, my city]. Keep only what can change my business: new prices, new rules, new competitors, opportunities and calls for tenders. Sum it up in five points at most, each with its source and its date. If nothing important happened, say so in one line.",
  },
  {
    title: "Weekly review",
    icon: TrendingUp,
    when: "Every Friday \u00b7 To-do",
    prompt: "Every Friday at 5 pm, review my week. What got done, from my to-do list and my sent emails. What is left on the list, and what has been waiting for more than a week. Who I promised something to and have not answered yet. End with the three priorities I should set for next week.",
  },
]

export { say } from './say'
