import { describe, expect, it } from 'vitest'
import { containsRowboatAddress } from './spaces-mentions'

describe('containsRowboatAddress', () => {
    it('is the token the composer emits, anywhere outside code', () => {
        expect(containsRowboatAddress('[@rowboat](#rowboat) move SSO to P1')).toBe(true)
        expect(containsRowboatAddress('yes — [@rowboat](#rowboat) move SSO to P1')).toBe(true)
        expect(containsRowboatAddress('([@rowboat](#rowboat) can you tidy this?)')).toBe(true)
    })

    it('never the bare word — that is prose, not an address', () => {
        expect(containsRowboatAddress('@rowboat move SSO to P1')).toBe(false)
        expect(containsRowboatAddress('we should ship spaces this week')).toBe(false)
        expect(containsRowboatAddress('the rowboat brand is growing on me')).toBe(false)
        expect(containsRowboatAddress('mail me at team@rowboat.com')).toBe(false)
    })

    it('code is citation, not address', () => {
        expect(containsRowboatAddress('the trigger is `[@rowboat](#rowboat)` in a message')).toBe(false)
        expect(containsRowboatAddress('```\n[@rowboat](#rowboat) do the thing\n```')).toBe(false)
        expect(containsRowboatAddress('```ts\nsend("[@rowboat](#rowboat) hi")')).toBe(false) // unterminated fence
    })
})
