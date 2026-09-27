import { describe, expect, it } from 'vitest'
import { railKey, readRailSelection } from './spaces-selection'

describe('space collection navigation', () => {
    it.each(['files', 'discussions'] as const)('round-trips the %s destination through history', (kind) => {
        const restored = readRailSelection(JSON.parse(JSON.stringify({ kind })))
        expect(restored).toEqual({ kind })
        expect(railKey(restored)).toBe(kind)
        expect(railKey(restored)).not.toBe(railKey({ kind: 'general' }))
    })
    it('continues rejecting malformed asset selections', () => {
        expect(readRailSelection({ kind: 'file', path: 'README.md' })).toEqual({ kind: 'general' })
        expect(readRailSelection({ kind: 'whiteboard', assetId: '' })).toEqual({ kind: 'general' })
    })
})
