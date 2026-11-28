import { describe, expect, it } from 'vitest'
import { railKey, readRailSelection } from './spaces-selection'

describe('space collection navigation', () => {
    it.each(['files', 'discussions', 'settings', 'graph', 'calendar'] as const)('round-trips the %s destination through history', (kind) => {
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
    it('keeps the event a calendar selection opens on, and drops one that is not an id', () => {
        const onEvent = { kind: 'calendar', entryId: 'entry-1' } as const
        expect(readRailSelection(JSON.parse(JSON.stringify(onEvent)))).toEqual(onEvent)
        expect(railKey(onEvent)).not.toBe(railKey({ kind: 'calendar' }))
        expect(readRailSelection({ kind: 'calendar', entryId: 42 })).toEqual({ kind: 'calendar' })
    })
    it('continues rejecting malformed asset selections', () => {
        expect(readRailSelection({ kind: 'file', path: 'README.md' })).toEqual({ kind: 'general' })
        expect(readRailSelection({ kind: 'whiteboard', assetId: '' })).toEqual({ kind: 'general' })
    })
})
