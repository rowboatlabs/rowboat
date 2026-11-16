import fs from 'node:fs'
import path from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Streamdown } from './streamdown'

// Raw HTML in someone else's Markdown never becomes live markup (streamdown.tsx).

afterEach(cleanup)

const html = (markdown: string) => render(<Streamdown>{markdown}</Streamdown>).container

describe('Streamdown, sanitized', () => {
    it('drops a frame that would run script in the app', () => {
        const out = html('<iframe srcdoc="<script>parent.document.title=1</script>"></iframe> after')
        expect(out.querySelector('iframe')).toBeNull()
        expect(out.textContent).toContain('after')
    })

    it('drops scripts, styles and event handlers', () => {
        const out = html('<script>alert(1)</script><style>body{display:none}</style><img src="x.png" onerror="alert(1)"><div onclick="alert(1)">hi</div>')
        expect(out.querySelector('script')).toBeNull()
        expect(out.querySelector('style')).toBeNull()
        expect(out.querySelector('[onerror]')).toBeNull()
        expect(out.querySelector('[onclick]')).toBeNull()
        expect(out.textContent).toContain('hi')
    })

    it('keeps the HTML people use in Markdown', () => {
        const out = html('line one<br>line two\n\n<details><summary>More</summary>hidden</details>\n\nH<sub>2</sub>O')
        expect(out.querySelector('br')).not.toBeNull()
        expect(out.querySelector('details summary')?.textContent).toBe('More')
        expect(out.querySelector('sub')?.textContent).toBe('2')
    })

    // Code blocks and math load lazily (Suspense, KaTeX's CSS), which jsdom
    // cannot; they were checked in a browser.
    it('still renders Markdown', () => {
        const out = html('**bold** and a [link](https://example.com)')
        expect(out.querySelector('[data-streamdown="strong"]')?.textContent).toBe('bold')
        expect(out.querySelector('a')?.getAttribute('href')).toBe('https://example.com/')
    })
})

describe('Streamdown imports', () => {
    it('come from the sanitizing wrapper, never from streamdown itself', () => {
        const root = path.resolve(__dirname, '..')
        const offenders: string[] = []
        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name)
                if (entry.isDirectory()) walk(full)
                else if (/\.tsx?$/.test(entry.name) && !full.endsWith(path.join('components', 'streamdown.tsx'))) {
                    if (/import\s*\{[^}]*\bStreamdown\b[^}]*\}\s*from\s*['"]streamdown['"]/.test(fs.readFileSync(full, 'utf8'))) offenders.push(path.relative(root, full))
                }
            }
        }
        walk(root)
        expect(offenders).toEqual([])
    })
})
