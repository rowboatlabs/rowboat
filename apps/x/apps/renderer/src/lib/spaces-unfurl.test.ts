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

    it('dedupes and caps at three', () => {
        const body = 'https://a.com https://a.com https://b.com https://c.com https://d.com'
        expect(previewUrls(body)).toEqual(['https://a.com', 'https://b.com', 'https://c.com'])
    })

    it('ignores plain-http and non-links', () => {
        expect(previewUrls('http://insecure.example.com and nothing else')).toEqual([])
    })
})
