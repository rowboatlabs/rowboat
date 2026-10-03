import { CalendarClock, Clapperboard, FileText, Image, Mail, Megaphone, Mic, Share2, type LucideIcon } from 'lucide-react'
import raw from './prompt-library.json?raw'

// The Prompts page (Baarali, 03/10/2026, validated mockup): ready-made
// requests for a small business, and the workshop that improves one's own,
// after the prompt studio of the first Baarali. The content lives in
// prompt-library.json, in both languages: it is content, not interface, so
// the translation layer and its check leave it alone.

export type Lang = 'fr' | 'en'
type Words = Record<Lang, string>

/** The app's language, as src/i18n/index.ts set it on <html>. */
export function appLang(): Lang {
  return typeof document !== 'undefined' && document.documentElement.lang === 'fr' ? 'fr' : 'en'
}

export interface PromptCategory { id: string; name: Words; icon: LucideIcon }
export interface LibraryPrompt { id: string; category: string; name: Words; text: Words }
export interface Genre { id: string; name: Words; hint: Words; guide: string }
export interface Level { id: string; name: Words; hint: Words; minRank: number; depth: string }

interface Data {
  categories: { id: string; name: Words; icon: string }[]
  library: LibraryPrompt[]
  genres: Genre[]
  levels: Level[]
  architect: { intro: string; kind: string; cover: string; depth: string; rules: string; format: string[]; fr: string; en: string }
}

const DATA = JSON.parse(raw) as Data

const ICONS: Record<string, LucideIcon> = { Mail, Megaphone, Share2, Image, Clapperboard, Mic, FileText, CalendarClock }

export const PROMPT_CATEGORIES: PromptCategory[] = DATA.categories.map((c) => ({ ...c, icon: ICONS[c.icon] ?? FileText }))
export const LIBRARY: LibraryPrompt[] = DATA.library
export const GENRES: Genre[] = DATA.genres
export const LEVELS: Level[] = DATA.levels

/** Plans in order (control catalog.ts): a level opens from its rank. */
export function planRank(planId: string | null | undefined): number {
  if (!planId || planId === 'decouverte') return 0
  if (planId === 'semaine') return 1
  if (planId === 'essentiel') return 2
  return planId.startsWith('pro') ? 3 : 0
}

/** The workshop's instructions to the model, for one genre and level. */
export function architectSystem(genre: Genre, level: Level, lang: Lang): string {
  const a = DATA.architect
  return [
    a.intro,
    a.kind.replace('{genre}', genre.name.fr).replace('{level}', level.name.fr),
    a.cover.replace('{guide}', genre.guide),
    a.depth.replace('{depth}', level.depth),
    a.rules,
    ...a.format,
    lang === 'fr' ? a.fr : a.en,
  ].join('\n')
}

export interface ArchitectAnswer { prompt: string; why: string[]; variants: string[]; tip: string }

/** The four parts of the model's answer; the whole text as the prompt when they are missing. */
export function parseArchitect(text: string): ArchitectAnswer {
  const part = (name: string) => {
    const m = new RegExp(`(?:^|\\n)\\s*\\**${name}\\**\\s*:\\s*\\**\\s*\\n?([\\s\\S]*?)(?=\\n\\s*\\**(?:PROMPT|POURQUOI|VARIANTES|ASTUCE)\\**\\s*:|$)`, 'i').exec(text)
    return m ? m[1].trim() : ''
  }
  const lines = (s: string) => s.split('\n').map((l) => l.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean)
  const prompt = part('PROMPT').replace(/^```\w*\n?|```$/g, '').trim()
  if (!prompt) return { prompt: text.trim(), why: [], variants: [], tip: '' }
  return { prompt, why: lines(part('POURQUOI')), variants: lines(part('VARIANTES')), tip: part('ASTUCE') }
}

/** A prompt the person kept: from the library, the workshop, or written by hand. */
export interface SavedPrompt { id: string; name: string; text: string; category: string | null; at: number }

export interface PromptStore { favorites: string[]; saved: SavedPrompt[] }

/** Kept in the workspace, so it follows the person on every device of their account. */
export const PROMPT_STORE_PATH = 'config/baarali-prompts.json'

export function readStore(rawStore: string | null | undefined): PromptStore {
  try {
    const parsed = JSON.parse(rawStore ?? '') as Partial<PromptStore>
    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites.filter((f): f is string => typeof f === 'string') : [],
      saved: Array.isArray(parsed.saved) ? parsed.saved.filter((s): s is SavedPrompt => !!s && typeof s.text === 'string' && typeof s.id === 'string') : [],
    }
  } catch {
    return { favorites: [], saved: [] }
  }
}
