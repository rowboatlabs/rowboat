import { describe, expect, it } from 'vitest'
import { containsRowboatAddress } from './spaces-mentions'

describe('containsRowboatAddress', () => {
    it('detects a plain address anywhere at a word boundary', () => {
        expect(containsRowboatAddress('@rowboat move SSO to P1')).toBe(true)
        expect(containsRowboatAddress('yes — @rowboat move SSO to P1')).toBe(true)
        expect(containsRowboatAddress('(@rowboat can you tidy this?)')).toBe(true)
        expect(containsRowboatAddress('@ROWBOAT do it')).toBe(true)
    })

    it('does not trigger on plain talk', () => {
        expect(containsRowboatAddress('we should ship spaces this week')).toBe(false)
        expect(containsRowboatAddress('the rowboat brand is growing on me')).toBe(false)
    })

    it('word boundaries: emails and longer handles are not addresses', () => {
        expect(containsRowboatAddress('mail me at team@rowboat.com')).toBe(false)
        expect(containsRowboatAddress('@rowboatlabs posted about it')).toBe(false)
        // "@rowboat.com" — boundary after "rowboat" matches, but the leading char is
        // part of an email-like token only when preceded by non-space; covered above.
    })

    it('code is citation, not address', () => {
        expect(containsRowboatAddress('the trigger is `@rowboat` in a message')).toBe(false)
        expect(containsRowboatAddress('```\n@rowboat do the thing\n```')).toBe(false)
        expect(containsRowboatAddress('```ts\nsend("@rowboat hi")')).toBe(false) // unterminated fence
    })

    it('quoted lines are citation, not address', () => {
        expect(containsRowboatAddress('> @rowboat move SSO to P1\nlove this idea')).toBe(false)
        expect(containsRowboatAddress('> @rowboat do X\n@rowboat actually do Y')).toBe(true)
    })
})
