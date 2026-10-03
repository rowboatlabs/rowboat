import type { LucideIcon } from 'lucide-react'
import {
  Activity, BookOpen, CloudSun, Dumbbell, LayoutGrid, LineChart, Mic, Network, Newspaper, Telescope, Timer, Wallet,
} from 'lucide-react'

// Baarali (02/10/2026): what a person reads on an app's card. The registry
// only carries a package name and the publisher's own English sentence, so
// each app we list gets a plain name, what it is for, an icon and a shelf.
// The words are English like the rest of the interface; the French comes
// from the dictionary (apps/baarali/packages/desktop/src/i18n/fr.ts).
//
// An app without a fiche is not hidden: it waits under « other apps », as
// the registry wrote it, and a search still finds it.

export type Shelf = 'money' | 'work' | 'watch' | 'life'

export const SHELVES: { id: Shelf; label: string }[] = [
  { id: 'money', label: 'Money' },
  { id: 'work', label: 'Work' },
  { id: 'watch', label: 'Keeping watch' },
  { id: 'life', label: 'Everyday life' },
]

export type Fiche = {
  title: string
  summary: string
  icon: LucideIcon
  shelf: Shelf
  /** The manifest's capabilities and agents, read from each app's repository
   * on 02/10/2026. The card shows them before install; the install dialog
   * always reads the real manifest, so a newer version cannot hide behind
   * this copy. */
  capabilities: string[]
  agents: number
}

export const FICHES: Record<string, Fiche> = {
  'finance-tracker': {
    title: 'Money tracker',
    summary: 'Your spending and income, sorted by category, with a dashboard that shows where the money goes.',
    icon: Wallet, shelf: 'money', capabilities: [], agents: 0,
  },
  'stock-analyzer': {
    title: 'Stock watchlist',
    summary: 'The shares you follow, with their price and the latest headlines about them.',
    icon: LineChart, shelf: 'money', capabilities: [], agents: 0,
  },
  'time-tracker': {
    title: 'Time tracker',
    summary: 'What you work on and how long it takes you.',
    icon: Timer, shelf: 'work', capabilities: ['copilot'], agents: 1,
  },
  'mindspace': {
    title: 'Mind maps',
    summary: 'A quiet space for mind maps, brainstorming and notes.',
    icon: Network, shelf: 'work', capabilities: [], agents: 0,
  },
  'competitor-intel': {
    title: 'Competitor watch',
    summary: 'The latest news about your competitors, gathered in one place.',
    icon: Telescope, shelf: 'watch', capabilities: [], agents: 0,
  },
  'news-aggregator': {
    title: 'News',
    summary: 'The most read stories on Hacker News and Reddit, one tab each.',
    icon: Newspaper, shelf: 'watch', capabilities: ['reddit'], agents: 0,
  },
  'arxiv-papers': {
    title: 'Research papers',
    summary: 'Find scientific papers on a topic and read their summaries.',
    icon: BookOpen, shelf: 'watch', capabilities: [], agents: 0,
  },
  'podcast-generator': {
    title: 'Podcast on demand',
    summary: 'Give it a topic, a link or a document: Baarali makes a two-voice episode you listen to right here.',
    icon: Mic, shelf: 'life', capabilities: ['copilot'], agents: 0,
  },
  'weather-dashboard': {
    title: 'Weather',
    summary: 'The weather today and for the next five days, in the city you choose.',
    icon: CloudSun, shelf: 'life', capabilities: [], agents: 0,
  },
  'exercise-tracker': {
    title: 'Workout log',
    summary: 'Your exercises of the day, with sets, reps and weights.',
    icon: Dumbbell, shelf: 'life', capabilities: [], agents: 0,
  },
  'protracker': {
    title: 'Training coach',
    summary: 'Tell it what is not working in your training: it asks what a coach would, plans your week and checks in on you.',
    icon: Activity, shelf: 'life', capabilities: ['llm'], agents: 2,
  },
}

export const fallbackIcon: LucideIcon = LayoutGrid

/** The connected-account toolkits an app can declare, by their usual name. */
const TOOLKITS: Record<string, string> = {
  github: 'GitHub', gmail: 'Gmail', googlecalendar: 'Google Calendar', googledrive: 'Google Drive',
  linear: 'Linear', notion: 'Notion', reddit: 'Reddit', slack: 'Slack',
}

export const toolkitName = (slug: string): string =>
  TOOLKITS[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1)

export type Access = { label: string; tone: 'plain' | 'account' | 'agent' }

/** The chips under a card: what the app reaches, said plainly. */
export function accessOf(capabilities: string[], agents: number): Access[] {
  const out: Access[] = []
  for (const cap of capabilities) {
    if (cap === 'llm') out.push({ label: 'Uses your AI', tone: 'plain' })
    else if (cap === 'copilot') out.push({ label: 'Acts through Baarali', tone: 'account' })
    else if (cap === 'voice') out.push({ label: 'Voice', tone: 'plain' })
    else out.push({ label: `Your ${toolkitName(cap)} account`, tone: 'account' })
  }
  if (agents > 0) out.push({ label: agents === 1 ? 'Agent included' : `${agents} agents included`, tone: 'agent' })
  if (out.length === 0) out.push({ label: 'No access to your accounts', tone: 'plain' })
  return out
}

/** One line per capability, for the install dialog. */
export function capabilityLine(cap: string): string {
  if (cap === 'llm') return 'Use your AI models (it counts against your plan)'
  if (cap === 'copilot') return 'Have Baarali act for you, with its tools and what it knows about you'
  if (cap === 'voice') return 'Speak and listen (text to speech and transcription)'
  return `Read and act on your ${toolkitName(cap)} account`
}
