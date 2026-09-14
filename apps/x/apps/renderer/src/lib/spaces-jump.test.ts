import { describe, expect, it, vi } from 'vitest'
import { consumeJump, jumpFailureMessage, requestJump, resolveJumpOffset } from './spaces-jump'

// A jump names a row; the pane that owns the topic claims it once. The offset
// rides along when the producer already fetched the message, so a pane whose
// window lacks the row can load around it without asking again.

describe('spaces-jump', () => {
    it('round-trips the offset when given, and omits it otherwise', () => {
        requestJump({ topicId: 'root', messageId: 'm1', offset: 42 })
        expect(consumeJump('')).toBeNull()
        expect(consumeJump('root')).toEqual({ messageId: 'm1', offset: 42 })
        expect(consumeJump('root')).toBeNull()
        requestJump({ topicId: '', messageId: 'm2' })
        expect(consumeJump('')).toEqual({ messageId: 'm2' })
    })

    it('resolves the anchor from the offset it carries, else with one lookup', async () => {
        const invoke = vi.fn(async () => ({ message: { id: 'm3', offset: 7 } }))
        Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } })
        expect(await resolveJumpOffset('org', 'space', { messageId: 'm1', offset: 42 })).toBe(42)
        expect(invoke).not.toHaveBeenCalled()
        expect(await resolveJumpOffset('org', 'space', { messageId: 'm3' })).toBe(7)
        expect(invoke).toHaveBeenCalledWith('spaces:getMessage', { orgId: 'org', spaceId: 'space', messageId: 'm3' })
    })

    it('reads "gone" off the bare message an org error crosses IPC as', () => {
        expect(jumpFailureMessage(new Error('no such message'))).toBe('That message is no longer here')
        expect(jumpFailureMessage(new Error('request failed with 404'))).toBe('That message is no longer here')
        expect(jumpFailureMessage(new Error('ECONNREFUSED'))).toBe('Could not open the message')
    })
})
