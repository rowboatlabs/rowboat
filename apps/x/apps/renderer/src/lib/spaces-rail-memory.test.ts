import { beforeEach, describe, expect, it } from 'vitest'
import { clearRailMemory, railForOpening, recallRail, rememberRail } from './spaces-rail-memory'

beforeEach(() => clearRailMemory())

describe('where a space was left', () => {
    it('gives a space back the discussion it was showing', () => {
        rememberRail('org', 'design', { kind: 'thread', rootMessageId: 'msg1' })
        expect(recallRail('org', 'design')).toEqual({ kind: 'thread', rootMessageId: 'msg1' })
    })

    it('keeps each space, and each server, to its own place', () => {
        rememberRail('org', 'design', { kind: 'thread', rootMessageId: 'msg1' })
        rememberRail('org', 'founders', { kind: 'file', assetId: 'asset1' })
        rememberRail('other', 'design', { kind: 'general' })
        expect(recallRail('org', 'founders')).toEqual({ kind: 'file', assetId: 'asset1' })
        expect(recallRail('other', 'design')).toEqual({ kind: 'general' })
        expect(recallRail('org', 'design')).toEqual({ kind: 'thread', rootMessageId: 'msg1' })
    })

    it('has nothing to say about a space this session never opened', () => {
        expect(recallRail('org', 'never')).toBeNull()
    })

    it('follows the reader back out to the stream', () => {
        rememberRail('org', 'design', { kind: 'thread', rootMessageId: 'msg1' })
        rememberRail('org', 'design', { kind: 'general' })
        expect(recallRail('org', 'design')).toEqual({ kind: 'general' })
    })
})

describe('opening a space', () => {
    it('reopens the discussion it was left on', () => {
        rememberRail('org', 'design', { kind: 'thread', rootMessageId: 'msg1' })
        expect(railForOpening('org', 'design')).toEqual({ kind: 'thread', rootMessageId: 'msg1' })
    })

    it('lands on the stream in a space this session has not been in', () => {
        expect(railForOpening('org', 'design')).toEqual({ kind: 'general' })
    })

    it('lets a caller that names its target win over the memory', () => {
        rememberRail('org', 'design', { kind: 'thread', rootMessageId: 'msg1' })
        expect(railForOpening('org', 'design', { kind: 'file', assetId: 'asset1' }))
            .toEqual({ kind: 'file', assetId: 'asset1' })
    })
})
