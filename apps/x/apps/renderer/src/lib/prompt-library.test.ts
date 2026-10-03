import { describe, expect, it } from 'vitest'
import { GENRES, LEVELS, LIBRARY, PROMPT_CATEGORIES, architectSystem, parseArchitect, planRank, readStore } from './prompt-library'

// The Prompts page's content and rules (Baarali, 03/10/2026).

describe('the prompt library', () => {
  it('puts every prompt in a known category, in both languages', () => {
    const ids = new Set(PROMPT_CATEGORIES.map((c) => c.id))
    for (const p of LIBRARY) {
      expect(ids.has(p.category)).toBe(true)
      expect(p.text.fr.length > 40 && p.text.en.length > 40).toBe(true)
    }
    expect(new Set(LIBRARY.map((p) => p.id)).size).toBe(LIBRARY.length)
  })

  it('opens the workshop levels with the plan', () => {
    expect(planRank(null)).toBe(0)
    expect(planRank('decouverte')).toBe(0)
    expect(planRank('semaine')).toBe(1)
    expect(planRank('essentiel')).toBe(2)
    expect(planRank('pro-200')).toBe(3)
    expect(LEVELS.filter((l) => l.minRank <= planRank('semaine')).map((l) => l.id)).toEqual(['simple', 'intermediate'])
  })

  it('asks the model for the four parts, in the app language', () => {
    const fr = architectSystem(GENRES[1], LEVELS[0], 'fr')
    expect(fr).toContain('PROMPT:')
    expect(fr).toContain('Image')
    expect(architectSystem(GENRES[1], LEVELS[0], 'en')).toContain('Write everything in English')
  })

  it('reads the four parts of the answer', () => {
    const a = parseArchitect('PROMPT:\nAffiche A3 [boutique]\nPOURQUOI:\n- précis\n- format\nVARIANTES:\n- carrée\n- avec une cliente\nASTUCE:\nAjoutez le prix.')
    expect(a).toEqual({ prompt: 'Affiche A3 [boutique]', why: ['précis', 'format'], variants: ['carrée', 'avec une cliente'], tip: 'Ajoutez le prix.' })
    expect(parseArchitect('**PROMPT:**\nUn texte\n**ASTUCE:** Court.').tip).toBe('Court.')
  })

  it('keeps the whole answer as the prompt when the parts are missing', () => {
    expect(parseArchitect('Juste un prompt.')).toEqual({ prompt: 'Juste un prompt.', why: [], variants: [], tip: '' })
  })

  it('reads a stored file, and an empty or broken one as nothing', () => {
    expect(readStore('{"favorites":["quote"],"saved":[{"id":"p1","name":"A","text":"B","category":null,"at":1}]}').favorites).toEqual(['quote'])
    expect(readStore('')).toEqual({ favorites: [], saved: [] })
    expect(readStore('{oops')).toEqual({ favorites: [], saved: [] })
  })
})
