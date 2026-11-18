import { describe, expect, it } from 'vitest'
import type { RailSelection } from '@/lib/spaces-selection'
import { parseRoute, routePath } from './routes'

describe('web routes', () => {
    const rails: RailSelection[] = [
        { kind: 'general' },
        { kind: 'settings' },
        { kind: 'discussions' },
        { kind: 'discussions', rootMessageId: 'thread/with spaces' },
        { kind: 'files' },
        { kind: 'graph' },
        { kind: 'thread', rootMessageId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
        { kind: 'file', assetId: '01ARZ3NDEKTSV4RRFFQ69G5FAW' },
        { kind: 'whiteboard', assetId: '01ARZ3NDEKTSV4RRFFQ69G5FAX' },
    ]

    it('round-trips every rail inside a space', () => {
        for (const rail of rails) {
            const path = routePath({ spaceId: 'S1', rail })
            expect(parseRoute(path)).toEqual({ spaceId: 'S1', rail })
        }
    })

    it('uses the shapes of Harbor’s own links, with nothing in front (one server, 2026-11-09)', () => {
        expect(routePath({ spaceId: 'S1' })).toBe('/s/S1')
        expect(routePath({ spaceId: 'S1', rail: { kind: 'file', assetId: 'A1' } })).toBe('/s/S1/a/A1')
    })

    it('names the server-level surfaces and the root alone', () => {
        expect(routePath({ view: 'activity' })).toBe('/activity')
        expect(parseRoute('/threads')).toEqual({ view: 'threads', rail: { kind: 'general' } })
        expect(parseRoute('/')).toEqual({ rail: { kind: 'general' } })
    })

    it('has no address for a previewed attachment: it lands on the space', () => {
        expect(routePath({ spaceId: 'S1', rail: { kind: 'attachment', src: 'app://space-blob/o/s/h' } })).toBe('/s/S1')
    })

    it('reads an unknown tail as the stream, never as a selection', () => {
        expect(parseRoute('/s/S1/nope/x')).toEqual({ spaceId: 'S1', rail: { kind: 'general' } })
        expect(parseRoute('/s/S1/t')).toEqual({ spaceId: 'S1', rail: { kind: 'general' } })
    })

    it('reads a path from before the one-server release as the root', () => {
        expect(parseRoute('/acme/s/S1')).toEqual({ rail: { kind: 'general' } })
    })
})
