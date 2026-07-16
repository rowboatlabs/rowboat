// Deterministic accent/pattern assignment shared by the "My apps" grid and
// the catalog grid, so both render the same card visual language.

export type CardTheme = { accent: string; glow: string }

const THEMES: CardTheme[] = [
  { accent: '#FF4D8D', glow: 'rgba(255,77,141,0.45)' }, // Pink
  { accent: '#EF4444', glow: 'rgba(239,68,68,0.45)' }, // Red
  { accent: '#22C55E', glow: 'rgba(34,197,94,0.40)' }, // Emerald
  { accent: '#F59E0B', glow: 'rgba(245,158,11,0.42)' }, // Amber
  { accent: '#14B8A6', glow: 'rgba(20,184,166,0.40)' }, // Teal
  { accent: '#EC4899', glow: 'rgba(236,72,153,0.42)' }, // Rose
]
const PATTERNS = ['dots', 'grid', 'diagonal', 'radial', 'waves', 'mesh', 'cross', 'rings', 'zigzag', 'plus', 'checker', 'beams']

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export const themeForIndex = (i: number): CardTheme => THEMES[i % THEMES.length]
export const patternFor = (id: string): string => PATTERNS[hash(id + '·pat') % PATTERNS.length]
