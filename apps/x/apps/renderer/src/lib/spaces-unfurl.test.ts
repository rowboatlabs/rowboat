import { describe, expect, it } from 'vitest'
import { previewUrls } from './spaces-unfurl'

describe('previewUrls', () => {
    it('finds bare links and trims trailing punctuation', () => {
        expect(previewUrls('see https://example.com/a.')).toEqual(['https://example.com/a'])
    })

    it('finds markdown link targets', () => {
        expect(previewUrls('read [the docs](https://example.com/docs)')).toEqual(['https://example.com/docs'])
    })

    it('skips links inside code fences and inline code', () => {
        expect(previewUrls('```\nhttps://example.com/fence\n```\nand `https://example.com/inline`')).toEqual([])
    })

    it('skips image embeds and direct image links', () => {
        expect(previewUrls('![shot](https://example.com/shot.png) and https://example.com/pic.jpg')).toEqual([])
    })

    it('skips org links — those are chips, and the hand-off page is not a preview', () => {
        const body = 'see https://acme.rowboat.space/s/01ARZ3NDEKTSV4RRFFQ69G5FAV and https://acme.rowboat.space/u/harsh and https://acme.rowboat.space/s/01ARZ3NDEKTSV4RRFFQ69G5FAV/m/01ARZ3NDEKTSV4RRFFQ69G5FC0 then https://example.com/post'
        expect(previewUrls(body)).toEqual(['https://example.com/post'])
    })

    it('dedupes and caps at three', () => {
        const body = 'https://a.com https://a.com https://b.com https://c.com https://d.com'
        expect(previewUrls(body)).toEqual(['https://a.com', 'https://b.com', 'https://c.com'])
    })

    it('previews ordinary homepages while skipping known org roots', () => {
        const body = 'https://example.com/ https://acme.rowboat.space https://custom.example:8443/?from=chat#top https://acme.rowboat.space.example/'
        expect(previewUrls(body, ['acme.rowboat.space', 'custom.example:8443'])).toEqual([
            'https://example.com/',
            'https://acme.rowboat.space.example/',
        ])
    })

    it('ignores plain-http and non-links', () => {
        expect(previewUrls('http://insecure.example.com and nothing else')).toEqual([])
    })
})
