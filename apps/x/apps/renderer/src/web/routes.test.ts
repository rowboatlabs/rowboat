import { describe, expect, it } from 'vitest'
import type { RailSelection } from '@/lib/spaces-selection'
import { parseRoute, routePath } from './routes'

describe('web routes', () => {
    const rails: RailSelection[] = [
        { kind: 'general' },
        { kind: 'discussions' },
        { kind: 'files' },
        { kind: 'thread', rootMessageId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
        { kind: 'file', assetId: '01ARZ3NDEKTSV4RRFFQ69G5FAW' },
        { kind: 'whiteboard', assetId: '01ARZ3NDEKTSV4RRFFQ69G5FAX' },
    ]

    it('round-trips every rail inside a space', () => {
        for (const rail of rails) {
            const path = routePath('acme', { spaceId: 'S1', rail })
            expect(parseRoute(path)).toEqual({ orgKey: 'acme', spaceId: 'S1', rail })
        }
    })

    it('uses the shapes of Harbor’s own links under the org', () => {
        expect(routePath('acme', { spaceId: 'S1' })).toBe('/acme/s/S1')
        expect(routePath('acme', { spaceId: 'S1', rail: { kind: 'file', assetId: 'A1' } })).toBe('/acme/s/S1/a/A1')
    })

    it('names org-level surfaces and the org alone', () => {
        expect(routePath('acme', { view: 'activity' })).toBe('/acme/activity')
        expect(parseRoute('/acme/browse')).toEqual({ orgKey: 'acme', view: 'browse', rail: { kind: 'general' } })
        expect(parseRoute('/acme')).toEqual({ orgKey: 'acme', rail: { kind: 'general' } })
        expect(parseRoute('/')).toEqual({ rail: { kind: 'general' } })
    })

    it('has no address for a previewed attachment: it lands on the space', () => {
        expect(routePath('acme', { spaceId: 'S1', rail: { kind: 'attachment', src: 'app://space-blob/o/s/h' } })).toBe('/acme/s/S1')
    })

    it('reads an unknown tail as the stream, never as a selection', () => {
        expect(parseRoute('/acme/s/S1/nope/x')).toEqual({ orgKey: 'acme', spaceId: 'S1', rail: { kind: 'general' } })
        expect(parseRoute('/acme/s/S1/t')).toEqual({ orgKey: 'acme', spaceId: 'S1', rail: { kind: 'general' } })
    })

    it('escapes an org address that is not a slug', () => {
        const path = routePath('chat.example.com:8443', { spaceId: 'S1' })
        expect(parseRoute(path).orgKey).toBe('chat.example.com:8443')
    })
})
