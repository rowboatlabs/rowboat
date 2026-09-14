import { describe, expect, it } from 'vitest'
import type { spaces } from '@x/shared'
import { filterAttachable } from './spaces-documents'

const entry = (path: string, state?: 'deleted'): spaces.SpacesAssetEntry => ({ path, version: 1, updatedAt: '2026-09-11T00:00:00Z', ...(state ? { state } : {}) })

describe('filterAttachable', () => {
    const entries = [entry('roadmap.md'), entry('briefs/launch.md'), entry('briefs/faq.md'), entry('old/plan.md', 'deleted'), entry('whiteboards/arch.excalidraw')]

    it('lists live files A–Z, never the trash', () => {
        expect(filterAttachable(entries, '').map((e) => e.path)).toEqual([
            'briefs/faq.md', 'briefs/launch.md', 'roadmap.md', 'whiteboards/arch.excalidraw',
        ])
    })

    it('every term must match somewhere in the path, case-insensitively', () => {
        expect(filterAttachable(entries, 'BRIEFS launch').map((e) => e.path)).toEqual(['briefs/launch.md'])
        expect(filterAttachable(entries, 'briefs nope')).toEqual([])
    })

    it('the currently linked file floats to the top', () => {
        expect(filterAttachable(entries, '', 'roadmap.md')[0]!.path).toBe('roadmap.md')
        expect(filterAttachable(entries, 'briefs', 'roadmap.md').map((e) => e.path)).toEqual(['briefs/faq.md', 'briefs/launch.md'])
    })
})
