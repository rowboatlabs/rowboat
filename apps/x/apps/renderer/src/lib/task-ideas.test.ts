import { afterEach, describe, expect, it } from 'vitest'
import { TASK_IDEAS, say } from './task-ideas'

// The new-task ideas fill a field, whose value the translation layer does
// not see: they ask it for the person's language (Baarali, 02/10/2026).

type Hooked = { __baaraliText?: (text: string) => string }

afterEach(() => { delete (window as Hooked).__baaraliText })

describe('task ideas', () => {
  it('keeps the English when no translation is loaded', () => {
    expect(say(TASK_IDEAS[0].prompt)).toBe(TASK_IDEAS[0].prompt)
  })

  it('asks the translation layer when it is there', () => {
    ;(window as Hooked).__baaraliText = (t) => (t === TASK_IDEAS[0].prompt ? 'Chaque matin à 7 h…' : t)
    expect(say(TASK_IDEAS[0].prompt)).toBe('Chaque matin à 7 h…')
  })

  it('has six ideas, each with a title, a when and a prompt', () => {
    expect(TASK_IDEAS).toHaveLength(6)
    for (const i of TASK_IDEAS) expect(i.title && i.when && i.prompt.length > 40).toBeTruthy()
  })
})
