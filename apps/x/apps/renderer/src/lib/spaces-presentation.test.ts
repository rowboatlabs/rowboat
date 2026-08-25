import { describe, expect, it } from 'vitest'
import type { spaces } from '@x/shared'
import {
    blobAppUrl,
    blobWireUrl,
    buildFileTree,
    decorateMentions,
    encodeMentions,
    encodeSpaceLinkTarget,
    formatBytes,
    formatFeedTime,
    initials,
    isUnreadChange,
    orgMonogram,
    parseAssetWireUrl,
    parseBlobAppUrl,
    parseSpaceFileAppUrl,
    resolveMentions,
    resolveSpaceLink,
    rewriteBlobLinks,
    rewriteFileLinks,
    rewriteRelativeImages,
    spaceFileAppUrl,
    toggleTaskAt,
} from './spaces-presentation'

function cs(over: Partial<spaces.ChangeSet> & { id: string; committedAt: string }): spaces.ChangeSet {
    return {
        spaceId: 's1',
        assetPath: 'roadmap.md',
        baseVersion: 1,
        resultVersion: 2,
        attribution: { memberId: 'ramnique', actingMode: 'agent', agentName: 'Rowboat' },
        offset: 1,
        ...over,
    }
}

describe('initials / monograms', () => {
    it('derives two-letter initials', () => {
        expect(initials('Ramnique Sharma')).toBe('RS')
        expect(initials('arjun')).toBe('AR')
        expect(initials('')).toBe('?')
    })
    it('derives an org monogram from the address, falling back to the name', () => {
        expect(orgMonogram({ name: 'Rowboat Labs', address: 'rowboat.team' })).toBe('RT')
        expect(orgMonogram({ name: 'Rowboat Labs (dev)', address: 'localhost:4272' })).toBe('RL')
    })
})

describe('formatFeedTime', () => {
    const now = new Date('2026-08-19T15:00:00')
    it('shows clock time today, Yesterday for yesterday, a date otherwise', () => {
        expect(formatFeedTime('2026-08-19T09:04:00', now)).toBe('09:04')
        expect(formatFeedTime('2026-08-18T17:20:00', now)).toBe('Yesterday 17:20')
        expect(formatFeedTime('2026-08-12T10:00:00', now)).toMatch(/Aug/)
    })
})

describe('buildFileTree', () => {
    it('nests folders, README first, files before folders', () => {
        const tree = buildFileTree([
            { path: 'decisions/sso.md', version: 1, updatedAt: '' },
            { path: 'roadmap.md', version: 1, updatedAt: '' },
            { path: 'README.md', version: 1, updatedAt: '' },
            { path: 'decisions/migration.md', version: 1, updatedAt: '' },
            { path: 'briefs/onboarding.md', version: 1, updatedAt: '' },
        ])
        expect(tree.map((n) => n.name)).toEqual(['README.md', 'roadmap.md', 'briefs', 'decisions'])
        expect(tree[3]!.children.map((n) => n.name)).toEqual(['migration.md', 'sso.md'])
        expect(tree[3]!.children[0]!.path).toBe('decisions/migration.md')
    })
    it('adds draft folders as empty dirs, nested paths included, without duplicating real ones', () => {
        const tree = buildFileTree(
            [{ path: 'decisions/sso.md', version: 1, updatedAt: '' }],
            ['design/screens', 'decisions'],
        )
        expect(tree.map((n) => n.name)).toEqual(['decisions', 'design'])
        const design = tree[1]!
        expect(design.children.map((n) => n.name)).toEqual(['screens'])
        expect(design.children[0]!.kind).toBe('dir')
        expect(design.children[0]!.children).toEqual([])
        // "decisions" was already real — one node, file intact.
        expect(tree[0]!.children.map((n) => n.name)).toEqual(['sso.md'])
    })
})

describe('file links — relative markdown resolves against the tree', () => {
    it('resolves plain, ./, ../ and root-anchored targets', () => {
        expect(resolveSpaceLink('sso.md', 'decisions')).toBe('decisions/sso.md')
        expect(resolveSpaceLink('./sso.md', 'decisions')).toBe('decisions/sso.md')
        expect(resolveSpaceLink('../roadmap.md', 'decisions')).toBe('roadmap.md')
        expect(resolveSpaceLink('/issues.md', 'decisions/deep')).toBe('issues.md')
        expect(resolveSpaceLink('screens/home.png', '')).toBe('screens/home.png')
    })
    it('decodes escapes and strips query/fragment', () => {
        expect(resolveSpaceLink('design%20notes.md', '')).toBe('design notes.md')
        expect(resolveSpaceLink('sso.md#approval', 'decisions')).toBe('decisions/sso.md')
        expect(resolveSpaceLink('sso.md?v=2', 'decisions')).toBe('decisions/sso.md')
    })
    it('leaves absolute URLs, anchors, mailto and root escapes alone', () => {
        expect(resolveSpaceLink('https://example.com/a.md', '')).toBeNull()
        expect(resolveSpaceLink('mailto:a@b.c', '')).toBeNull()
        expect(resolveSpaceLink('#heading', 'decisions')).toBeNull()
        expect(resolveSpaceLink('//cdn.example.com/x', '')).toBeNull()
        expect(resolveSpaceLink('../../escape.md', 'decisions')).toBeNull()
        expect(resolveSpaceLink('', 'decisions')).toBeNull()
        expect(resolveSpaceLink('/', 'decisions')).toBeNull()
    })
    it('encodeSpaceLinkTarget round-trips spaces and parens through resolveSpaceLink', () => {
        const path = 'design/screens (v2)/home page.png'
        const target = encodeSpaceLinkTarget(path)
        expect(target).not.toMatch(/[ ()]/)
        expect(resolveSpaceLink(target, '')).toBe(path)
    })
    it('space-file app URLs round-trip (the render form that survives Streamdown hardening)', () => {
        const refs = { orgId: 'o1', spaceId: 's1' }
        const url = spaceFileAppUrl(refs, 'design/notes (v2).md')
        expect(url.startsWith('app://space-file/o1/s1/')).toBe(true)
        expect(url).not.toMatch(/[ ()]/)
        expect(parseSpaceFileAppUrl(url)).toEqual({ orgId: 'o1', spaceId: 's1', path: 'design/notes (v2).md' })
        expect(parseSpaceFileAppUrl('app://space-blob/o1/s1/abc')).toBeNull()
        expect(parseSpaceFileAppUrl('https://x.com/a')).toBeNull()
    })
    it('rewriteFileLinks: relative links become app://space-file; images, absolute URLs, code stay', () => {
        const refs = { orgId: 'o1', spaceId: 's1' }
        expect(rewriteFileLinks('see [sso](decisions/sso.md)', refs))
            .toBe('see [sso](app://space-file/o1/s1/decisions/sso.md)')
        expect(rewriteFileLinks('see [n](design%20notes.md)', refs))
            .toBe('see [n](app://space-file/o1/s1/design%20notes.md)')
        const untouched = [
            '![img](shot.png)',
            '[ext](https://example.com/a)',
            '[m](mailto:a@b.c)',
            '`[c](a.md)`',
            '```\n[c](a.md)\n```',
        ]
        for (const body of untouched) expect(rewriteFileLinks(body, refs)).toBe(body)
    })
    it('parses the canonical asset URL for this space only', () => {
        const refs = { orgId: 'o1', orgAddress: 'rowboat.team', spaceId: '01HXAMPZESPACE00000000000A' }
        expect(parseAssetWireUrl('https://rowboat.team/s/01HXAMPZESPACE00000000000A/f/decisions/sso.md', refs)).toBe('decisions/sso.md')
        expect(parseAssetWireUrl('https://rowboat.team/s/01HXAMPZESPACE00000000000A/f/design%20notes.md', refs)).toBe('design notes.md')
        expect(parseAssetWireUrl('https://other.org/s/01HXAMPZESPACE00000000000A/f/a.md', refs)).toBeNull()
        expect(parseAssetWireUrl('https://rowboat.team/s/01HXAMPZESPACE00000000000B/f/a.md', refs)).toBeNull()
    })
})

describe('rewriteRelativeImages', () => {
    const srcFor = (p: string) => (p === 'screens/home.png' ? 'app://space-blob/o/s/hash' : null)
    it('rewrites references that resolve to a real image asset', () => {
        expect(rewriteRelativeImages('see ![home](home.png "the shot")', 'screens', srcFor))
            .toBe('see ![home](app://space-blob/o/s/hash "the shot")')
        expect(rewriteRelativeImages('![x](/screens/home.png)', 'docs', srcFor))
            .toBe('![x](app://space-blob/o/s/hash)')
    })
    it('leaves external URLs, unknown paths, and code regions literal', () => {
        expect(rewriteRelativeImages('![x](https://a.com/i.png)', '', srcFor)).toBe('![x](https://a.com/i.png)')
        expect(rewriteRelativeImages('![x](missing.png)', '', srcFor)).toBe('![x](missing.png)')
        const code = '```\n![x](home.png)\n```\nand `![x](home.png)`'
        expect(rewriteRelativeImages(code, 'screens', srcFor)).toBe(code)
    })
})

describe('toggleTaskAt', () => {
    const doc = [
        '# Plan',
        '- [ ] first',
        '',
        '```md',
        '- [ ] not a task (code)',
        '```',
        '- [x] second',
        '> - [ ] quoted third',
        '3. [ ] ordered fourth',
    ].join('\n')
    it('flips the Nth task in document order, skipping fenced code', () => {
        expect(toggleTaskAt(doc, 0)!.split('\n')[1]).toBe('- [x] first')
        expect(toggleTaskAt(doc, 1)!.split('\n')[6]).toBe('- [ ] second')
        expect(toggleTaskAt(doc, 2)!.split('\n')[7]).toBe('> - [x] quoted third')
        expect(toggleTaskAt(doc, 3)!.split('\n')[8]).toBe('3. [x] ordered fourth')
        // The fenced line never changes.
        expect(toggleTaskAt(doc, 1)!.split('\n')[4]).toBe('- [ ] not a task (code)')
    })
    it('returns null out of range', () => {
        expect(toggleTaskAt(doc, 4)).toBeNull()
        expect(toggleTaskAt('no tasks here', 0)).toBeNull()
    })
})

describe('mentions — compose names, wire ids', () => {
    const members = [
        { id: '01HXAMPLEULIDRAMNIQUE0000', displayName: 'Ramnique Singh' },
        { id: '01HXAMPLEULIDRAM00000000', displayName: 'Ramnique' },
        { id: '01HXAMPLEULIDHARSH000000', displayName: 'Harsh' },
    ]

    it('encodes display names to member-id addresses, longest name first', () => {
        expect(encodeMentions('@Ramnique Singh can you look?', members))
            .toBe('@01HXAMPLEULIDRAMNIQUE0000 can you look?')
        expect(encodeMentions('ping @Ramnique too', members))
            .toBe('ping @01HXAMPLEULIDRAM00000000 too')
    })

    it('matches case-insensitively, at boundaries, with trailing punctuation', () => {
        expect(encodeMentions('(@harsh)?', members)).toBe('(@01HXAMPLEULIDHARSH000000)?')
        expect(encodeMentions('email@Harsh.dev stays', members)).toBe('email@Harsh.dev stays')
    })

    it('leaves code regions, @rowboat, and unknown names alone', () => {
        expect(encodeMentions('`@Harsh` in code, @Harsh outside', members))
            .toBe('`@Harsh` in code, @01HXAMPLEULIDHARSH000000 outside')
        expect(encodeMentions('@rowboat summarise; @Nobody there', members))
            .toBe('@rowboat summarise; @Nobody there')
    })

    it('never lets a member named rowboat capture the agent address', () => {
        expect(encodeMentions('@rowboat go', [{ id: '01HIMPOSTOR', displayName: 'rowboat' }])).toBe('@rowboat go')
    })

    it('@here stays literal on the wire and decorates like a mention', () => {
        expect(encodeMentions('@here standup in 5', members)).toBe('@here standup in 5')
        expect(encodeMentions('@here go', [{ id: '01HIMPOSTOR', displayName: 'here' }])).toBe('@here go')
        const names = new Map(members.map((m) => [m.id, m.displayName]))
        expect(decorateMentions('@here standup in 5', names)).toBe('**@here** standup in 5')
        expect(resolveMentions('`@here` in code stays', names)).toBe('`@here` in code stays')
    })

    it('round-trips: encoded wire body decorates back to the name', () => {
        const names = new Map(members.map((m) => [m.id, m.displayName]))
        expect(decorateMentions(encodeMentions('hey @Ramnique Singh', members), names))
            .toBe('hey **@Ramnique Singh**')
    })

    it('resolveMentions renders names without markup — for titles, crumbs, reasons', () => {
        const names = new Map(members.map((m) => [m.id, m.displayName]))
        expect(resolveMentions('ask @01HXAMPLEULIDHARSH000000 about it', names))
            .toBe('ask @Harsh about it')
        expect(resolveMentions('`@01HXAMPLEULIDHARSH000000` in code, @unknown alone', names))
            .toBe('`@01HXAMPLEULIDHARSH000000` in code, @unknown alone')
        expect(resolveMentions('@rowboat plan this', names)).toBe('@rowboat plan this')
    })
})

describe('blob links', () => {
    const HASH = 'a'.repeat(64)
    // A valid Crockford ULID — no I/L/O/U (the rewrite matches real ids only).
    const SPACE = '01HXAMPZESPACE00000000000A'
    const refs = { orgId: 'org-1', orgAddress: 'rowboat.spaces.example.com', spaceId: SPACE }

    it('wire and app URL forms round-trip through the rewrite', () => {
        const wire = blobWireUrl(refs, HASH, 'design doc.pdf')
        expect(wire).toBe(`https://rowboat.spaces.example.com/s/${SPACE}/b/${HASH}?name=design%20doc.pdf`)
        const body = `see this: ![shot](${blobWireUrl(refs, HASH)}) and [doc](${wire})`
        const rewritten = rewriteBlobLinks(body, refs)
        expect(rewritten).toContain(`![shot](app://space-blob/org-1/${SPACE}/${HASH})`)
        // The ?name= query survives the rewrite (it trails the matched prefix).
        expect(rewritten).toContain(`[doc](app://space-blob/org-1/${SPACE}/${HASH}?name=design%20doc.pdf)`)
    })

    it('rewrites only this org, leaves code regions and foreign hosts alone', () => {
        const foreign = `![x](https://other.org/s/${SPACE}/b/${HASH})`
        expect(rewriteBlobLinks(foreign, refs)).toBe(foreign)
        const code = `\`https://rowboat.spaces.example.com/s/${SPACE}/b/${HASH}\``
        expect(rewriteBlobLinks(code, refs)).toBe(code)
    })

    it('parseBlobAppUrl inverts blobAppUrl', () => {
        const url = blobAppUrl({ orgId: 'org-1', spaceId: SPACE }, HASH, { thumb: 320 })
        expect(url).toBe(`app://space-blob/org-1/${SPACE}/${HASH}?thumb=320`)
        expect(parseBlobAppUrl(url)).toEqual({ orgId: 'org-1', spaceId: SPACE, hash: HASH })
        expect(parseBlobAppUrl('app://space-blob/org-1/only-two-parts')).toBeNull()
    })

    it('formatBytes reads like a file card', () => {
        expect(formatBytes(532)).toBe('532 B')
        expect(formatBytes(1536)).toBe('1.5 KB')
        expect(formatBytes(1_258_291)).toBe('1.2 MB')
        expect(formatBytes(104_857_600)).toBe('100 MB')
    })
})

describe('unread changes', () => {
    it('marks a change unread when it landed after the mark and was not my own direct edit', () => {
        const theirs = cs({ id: 'c2', committedAt: '2026-08-19T18:04:00Z' })
        const mine = cs({ id: 'self', committedAt: '2026-08-19T17:00:00Z', attribution: { memberId: 'me', actingMode: 'direct' } })
        const myAgent = cs({ id: 'agent', committedAt: '2026-08-19T17:30:00Z', attribution: { memberId: 'me', actingMode: 'agent', agentName: 'Rowboat' } })
        expect(isUnreadChange(theirs, '2026-08-18T17:20:00Z', 'me')).toBe(true)
        expect(isUnreadChange(theirs, '2026-08-19T18:04:00Z', 'me')).toBe(false)
        expect(isUnreadChange(mine, null, 'me')).toBe(false)
        expect(isUnreadChange(myAgent, null, 'me')).toBe(true)
    })
})
