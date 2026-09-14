import { describe, expect, it } from 'vitest'
import { assistantLayoutReducer as reduce, initialAssistantLayout, restoreAssistantLayout, chatLocation, type AssistantLayout, type ChatLocation } from './assistant-layout'

const size = { width: 460, height: 600 }
const place = (state: AssistantLayout, id: string, location: ChatLocation, replacing?: string) => reduce(state, { type: 'place', id, location, replacing, size })

describe('assistant container ownership', () => {
  it('starts with one Assistant conversation and a hidden sidebar', () => {
    expect(initialAssistantLayout('draft')).toEqual({ assistant: 'draft', sidebar: null, floating: [], focused: 'draft' })
  })

  it('moves the same identity through every pair of locations without duplicates', () => {
    for (const source of ['assistant', 'sidebar', 'floating'] as const) {
      for (const target of ['assistant', 'sidebar', 'floating'] as const) {
        const result = place(place(initialAssistantLayout('a'), 'a', source), 'a', target)
        expect(chatLocation(result, 'a')).toBe(target)
        expect([result.assistant, result.sidebar, ...result.floating.map((entry) => entry.id)].filter((id) => id === 'a')).toHaveLength(1)
      }
    }
  })

  it('replaces an occupied sidebar and clears the source Assistant slot', () => {
    let state = place(initialAssistantLayout('a'), 'b', 'sidebar')
    state = place(state, 'a', 'sidebar')
    expect(state.sidebar).toBe('a')
    expect(state.assistant).toBeNull()
    expect(chatLocation(state, 'b')).toBeNull()
  })

  it('supports three independently expanded windows with stable tab order', () => {
    let state = initialAssistantLayout('a')
    for (const id of ['a', 'b', 'c']) { state = place(state, id, 'floating'); state = reduce(state, { type: 'minimize', id }) }
    for (const id of ['a', 'b', 'c']) state = reduce(state, { type: 'focus', id })
    expect(state.floating.map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
    expect(state.floating.every((entry) => !entry.minimized)).toBe(true)
    state = reduce(state, { type: 'focus', id: 'a' })
    expect(state.floating.map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
    expect(state.floating[0].layer).toBeGreaterThan(state.floating[2].layer)
  })

  it('keeps independent geometry through minimize and reopening', () => {
    let state = place(place(initialAssistantLayout('a'), 'a', 'floating'), 'b', 'floating')
    const changed = { width: 600, height: 400 }
    state = reduce(state, { type: 'resize', id: 'a', size: changed })
    state = reduce(state, { type: 'minimize', id: 'a' })
    state = reduce(state, { type: 'focus', id: 'a' })
    expect(state.floating[0]).toMatchObject(changed)
    expect(state.floating[1]).toMatchObject(size)
  })

  it('reorders a floating chat within the row, clamping the target slot', () => {
    let state = initialAssistantLayout('a')
    for (const id of ['a', 'b', 'c']) state = place(state, id, 'floating')
    state = reduce(state, { type: 'reorder', id: 'c', index: 0 })
    expect(state.floating.map((entry) => entry.id)).toEqual(['c', 'a', 'b'])
    state = reduce(state, { type: 'reorder', id: 'c', index: 99 })
    expect(state.floating.map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
    expect(reduce(state, { type: 'reorder', id: 'missing', index: 0 })).toBe(state)
  })

  it('replaces a floating conversation in the same tab position and size', () => {
    let state = place(place(initialAssistantLayout('a'), 'a', 'floating'), 'b', 'floating')
    state = reduce(state, { type: 'resize', id: 'a', size: { ...size, width: 700 } })
    state = place(state, 'c', 'floating', 'a')
    expect(state.floating.map((entry) => entry.id)).toEqual(['c', 'b'])
    expect(state.floating[0].width).toBe(700)
  })

  it('restores valid locations and rejects duplicate, stale, or corrupt entries', () => {
    const saved = { assistant: 'a', sidebar: 'a', floating: [{ ...size, id: 'b', layer: 1, minimized: true }, { ...size, id: 'missing', layer: 2 }, { ...size, id: 'c', width: 'wrong', layer: 3 }] }
    const result = restoreAssistantLayout(JSON.stringify(saved), ['a', 'b', 'c'])
    expect(result.sidebar).toBeNull()
    expect(result.floating).toHaveLength(1)
    expect(result.floating[0]).toMatchObject({ id: 'b', minimized: true })
    expect(restoreAssistantLayout('{', ['a'])).toEqual(initialAssistantLayout('a'))
  })
})
