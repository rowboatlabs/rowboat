import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_THREADS_FILTER, getThreadsFilter, setThreadsFilter } from './spaces-threads-filter'

// The Threads view's remembered filter (2026-10-25): per space, per install.

beforeEach(() => {
    window.localStorage.clear()
    setThreadsFilter('org', 'main', DEFAULT_THREADS_FILTER)
    setThreadsFilter('org', 'dm', DEFAULT_THREADS_FILTER)
})

describe('threads filter', () => {
    it('keeps each space its own, and writes nothing while nothing is filtered', () => {
        setThreadsFilter('org', 'main', { tab: 'mine', participants: ['ana'] })
        expect(getThreadsFilter('org', 'main')).toEqual({ tab: 'mine', participants: ['ana'] })
        expect(getThreadsFilter('org', 'dm')).toEqual(DEFAULT_THREADS_FILTER)
        expect(window.localStorage.getItem('spaces:threads-filter:org/dm')).toBeNull()
        setThreadsFilter('org', 'main', DEFAULT_THREADS_FILTER)
        expect(window.localStorage.getItem('spaces:threads-filter:org/main')).toBeNull()
    })

    it('reads a stored filter back, and treats a damaged one as no filter', () => {
        window.localStorage.setItem('spaces:threads-filter:org/other', JSON.stringify({ tab: 'named', participants: ['bo', 7] }))
        expect(getThreadsFilter('org', 'other')).toEqual({ tab: 'named', participants: ['bo'] })
        window.localStorage.setItem('spaces:threads-filter:org/broken', '{nope')
        expect(getThreadsFilter('org', 'broken')).toEqual(DEFAULT_THREADS_FILTER)
        window.localStorage.setItem('spaces:threads-filter:org/odd', JSON.stringify({ tab: 'everything' }))
        expect(getThreadsFilter('org', 'odd')).toEqual(DEFAULT_THREADS_FILTER)
    })
})
