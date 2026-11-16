import { describe, expect, it } from 'vitest'
import { railKey, readRailSelection } from './spaces-selection'

describe('space collection navigation', () => {
    it.each(['files', 'discussions', 'settings', 'graph'] as const)('round-trips the %s destination through history', (kind) => {
        const restored = readRailSelection(JSON.parse(JSON.stringify({ kind })))
        expect(restored).toEqual({ kind })
        expect(railKey(restored)).toBe(kind)
        expect(railKey(restored)).not.toBe(railKey({ kind: 'general' }))
    })
    it('preserves the list and its selected thread in history', () => {
        const selected = { kind: 'discussions', rootMessageId: 'root-1' } as const
        expect(readRailSelection(JSON.parse(JSON.stringify(selected)))).toEqual(selected)
        expect(railKey(selected)).not.toBe(railKey({ kind: 'discussions' }))
        expect(railKey(selected)).not.toBe(railKey({ kind: 'discussions', rootMessageId: 'root-2' }))
        expect(readRailSelection({ kind: 'discussions', rootMessageId: 42 })).toEqual({ kind: 'discussions' })
    })
    it('continues rejecting malformed asset selections', () => {
        expect(readRailSelection({ kind: 'file', path: 'README.md' })).toEqual({ kind: 'general' })
        expect(readRailSelection({ kind: 'whiteboard', assetId: '' })).toEqual({ kind: 'general' })
    })
})
