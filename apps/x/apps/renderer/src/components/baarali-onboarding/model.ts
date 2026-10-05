// BAARALI(04/10/2026): Baarali's onboarding, from the mockup the founder
// validated: welcome, the space being prepared, who the person is, their
// tools, then a first request. Its logic lives here, without React.
//
// Joining the instance reloads every window (cloud-link), and so does a
// change of language: the step and the answers are kept in this window's
// storage so the onboarding picks up where it was.

export type Step = 0 | 1 | 2 | 3 | 4

export interface Profile {
  name: string
  sector: string | null
  role: string | null
}

export interface Saved {
  step: Step
  profile: Profile
  /** When the space started being prepared (ms), for its progress across a reload. */
  spaceSince: number | null
  /** « I already have an account »: once joined, straight to the app. */
  returning: boolean
}

export const STORAGE_KEY = 'baarali-onboarding'

export const EMPTY: Saved = { step: 0, profile: { name: '', sector: null, role: null }, spaceSince: null, returning: false }

const isStep = (v: unknown): v is Step => v === 0 || v === 1 || v === 2 || v === 3 || v === 4
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/** What a window kept, read leniently: anything unreadable starts over. */
export function readSaved(raw: string | null): Saved {
  try {
    const parsed = JSON.parse(raw ?? 'null') as Partial<Saved> | null
    if (!parsed || typeof parsed !== 'object') return EMPTY
    const p = (parsed.profile ?? {}) as Partial<Profile>
    return {
      step: isStep(parsed.step) ? parsed.step : 0,
      profile: {
        name: text(p.name, 60) ?? '',
        sector: SECTORS.includes(p.sector as string) ? (p.sector as string) : null,
        role: ROLES.includes(p.role as string) ? (p.role as string) : null,
      },
      spaceSince: typeof parsed.spaceSince === 'number' ? parsed.spaceSince : null,
      returning: parsed.returning === true,
    }
  } catch {
    return EMPTY
  }
}

export function loadSaved(): Saved {
  try {
    return readSaved(localStorage.getItem(STORAGE_KEY))
  } catch {
    return EMPTY
  }
}

export function storeSaved(saved: Saved): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
  } catch {
    // Storage refused: a reload starts over, nothing else breaks.
  }
}

export function clearSaved(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing kept to clear.
  }
}

/**
 * Whether the window opens the onboarding. An instance always says it was
 * done (instance seed.ts), so after joining it, the window's own record
 * keeps a new person's onboarding going; and without a Baarali session the
 * onboarding is where one signs in, after a sign-out too.
 */
export function shouldShow({ upstream, signedIn, saved }: { upstream: boolean; signedIn: boolean; saved: Saved }): boolean {
  return upstream || !signedIn || (saved.step >= 1 && !saved.returning)
}

/** The activities offered, in English: the app's French layer translates them. */
export const SECTORS = [
  'Retail and distribution', 'Import-export', 'Services and consulting', 'Accounting and finance',
  'Banking and microfinance', 'Legal', 'Real estate', 'Construction and crafts', 'Manufacturing',
  'Mining and energy', 'Restaurants and hotels', 'Tourism and events', 'Transport and logistics',
  'Farming and livestock', 'Health and pharmacy', 'Education and training', 'Tech and digital',
  'Communication and marketing', 'Fashion and beauty', 'Media and culture', 'Nonprofit or NGO',
  'Public administration', 'Other',
]

export const ROLES = ['Business owner or manager', 'Employee', 'Self-employed', 'Student']

export interface Idea {
  title: string
  detail: string
  /** What lands in the composer, for the person to read before sending. */
  prompt: string
}

const SELLING: Idea[] = [
  { title: 'Follow up on an unpaid invoice', detail: 'Baarali writes the reminder, you read it over', prompt: 'Help me write a polite reminder to a client about an unpaid invoice.' },
  { title: 'Prepare a quote', detail: 'From a few lines of description', prompt: 'Help me prepare a quote for a client. Here is what they need:' },
  { title: 'Review my emails of the week', detail: 'What needs an answer, what can wait', prompt: 'Go through my emails of the week: what needs an answer from me, and what can wait?' },
]
const ADVISING: Idea[] = [
  { title: 'Prepare a client meeting', detail: 'An agenda and the questions to ask', prompt: 'Help me prepare my next client meeting: an agenda and the questions to ask.' },
  { title: 'Write a proposal', detail: 'Clear, structured, ready to send', prompt: 'Help me write a proposal for a client. Here is the context:' },
  { title: 'Review my emails of the week', detail: 'What needs an answer, what can wait', prompt: 'Go through my emails of the week: what needs an answer from me, and what can wait?' },
]
const FIELD: Idea[] = [
  { title: 'Plan the week on site', detail: 'Who does what, and when', prompt: 'Help me plan the work of the week: who does what, and when.' },
  { title: 'Prepare a quote', detail: 'From a few lines of description', prompt: 'Help me prepare a quote for a client. Here is what they need:' },
  { title: 'Follow up on a supplier', detail: 'Baarali writes the message, you read it over', prompt: 'Help me write a message to follow up on a supplier who is late.' },
]
const CARING: Idea[] = [
  { title: 'Organize my week', detail: 'Appointments, priorities, reminders', prompt: 'Help me organize my week: appointments, priorities and reminders.' },
  { title: 'Write a clear notice', detail: 'For parents, patients or the team', prompt: 'Help me write a clear notice. Here is what it is about:' },
  { title: 'Summarize a document', detail: 'The essentials in a few lines', prompt: 'Summarize this document for me in a few lines:' },
]
const PUBLIC: Idea[] = [
  { title: 'Write an official letter', detail: 'The right tone, ready to sign', prompt: 'Help me write an official letter. Here is what it is about:' },
  { title: 'Draft a report', detail: 'From your notes, structured', prompt: 'Help me draft a report from these notes:' },
  { title: 'Prepare a meeting', detail: 'An agenda and the points to settle', prompt: 'Help me prepare a meeting: an agenda and the points to settle.' },
]
const ANYONE: Idea[] = [
  { title: 'Review my emails of the week', detail: 'What needs an answer, what can wait', prompt: 'Go through my emails of the week: what needs an answer from me, and what can wait?' },
  { title: 'Organize my week', detail: 'Appointments, priorities, reminders', prompt: 'Help me organize my week: appointments, priorities and reminders.' },
  { title: 'Write a professional message', detail: 'The right tone, in a minute', prompt: 'Help me write a professional message. Here is what I want to say:' },
]

const IDEAS_BY_SECTOR: Record<string, Idea[]> = {
  'Retail and distribution': SELLING, 'Import-export': SELLING, 'Restaurants and hotels': SELLING,
  'Tourism and events': SELLING, 'Fashion and beauty': SELLING,
  'Services and consulting': ADVISING, 'Accounting and finance': ADVISING, 'Banking and microfinance': ADVISING,
  'Legal': ADVISING, 'Real estate': ADVISING, 'Tech and digital': ADVISING,
  'Communication and marketing': ADVISING, 'Media and culture': ADVISING,
  'Construction and crafts': FIELD, 'Manufacturing': FIELD, 'Mining and energy': FIELD,
  'Transport and logistics': FIELD, 'Farming and livestock': FIELD,
  'Health and pharmacy': CARING, 'Education and training': CARING,
  'Nonprofit or NGO': PUBLIC, 'Public administration': PUBLIC,
}

/** Three first requests, picked for the activity chosen. */
export function ideasFor(sector: string | null): Idea[] {
  return (sector && IDEAS_BY_SECTOR[sector]) || ANYONE
}

/** The agent's notes on the person (core: knowledge/Agent Notes/user.md, in every chat). */
export const PROFILE_FILE = 'knowledge/Agent Notes/user.md'
const HEADING = '## Told at sign-up'
const LANGUAGE_NAMES: Record<string, string> = { fr: 'French', en: 'English' }
const START = '<!-- baarali:profile -->'
const END = '<!-- /baarali:profile -->'

/** The profile as the agent reads it; empty when nothing was told. */
export function profileBlock(profile: Profile, lang: string): string {
  const lines = [
    profile.name && `- First name: ${profile.name}`,
    profile.sector && `- Activity: ${profile.sector}`,
    profile.role && `- Role: ${profile.role}`,
  ].filter(Boolean)
  if (!lines.length) return ''
  lines.push(`- Language of the app: ${LANGUAGE_NAMES[lang] ?? LANGUAGE_NAMES.en}`)
  // For the agent, not shown: in English whatever the app's language.
  return [START, HEADING, ...lines, END].join('\n')
}

/** The notes with the profile in them: replaced if there, else first; the rest kept. */
export function mergeProfile(existing: string, block: string): string {
  const at = existing.indexOf(START)
  const end = at >= 0 ? existing.indexOf(END, at) : -1
  const rest = at >= 0 && end >= 0 ? (existing.slice(0, at) + existing.slice(end + END.length)).trim() : existing.trim()
  if (!block) return rest ? `${rest}\n` : ''
  return rest ? `${block}\n\n${rest}\n` : `${block}\n`
}

/** The preparation's progress (0–100): estimated until joined, then full. */
export function spaceProgress(since: number | null, now: number, joined: boolean): number {
  if (joined) return 100
  if (since === null) return 5
  // About a minute for a new space: the bar runs to 90% over it, then waits.
  return Math.round(Math.min(90, 5 + ((now - since) / 60_000) * 85))
}
