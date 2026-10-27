import { afterEach, describe, expect, it } from 'vitest'
import { getStreamView, setStreamView } from './spaces-stream-view'

afterEach(() => {
    setStreamView('org', 'a', 'threads')
    setStreamView('org', 'b', 'threads')
    window.localStorage.clear()
})

describe('replies inline, per space (2026-10-25)', () => {
    it('is per space, kept on this device, and threads by default', () => {
        expect(getStreamView('org', 'a')).toBe('threads')
        setStreamView('org', 'a', 'inline')
        expect(getStreamView('org', 'a')).toBe('inline')
        expect(getStreamView('org', 'b')).toBe('threads')
        expect(window.localStorage.getItem('spaces:streamView:org/a')).toBe('inline')
        setStreamView('org', 'a', 'threads')
        expect(window.localStorage.getItem('spaces:streamView:org/a')).toBeNull()
    })
})
