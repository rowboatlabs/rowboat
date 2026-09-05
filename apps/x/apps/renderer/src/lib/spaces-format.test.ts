import { describe, expect, it } from 'vitest'
import { insertLink, toggleCodeBlock, toggleInline, toggleLinePrefix } from './spaces-format'

describe('toggleInline', () => {
    it('wraps a selection in the marker', () => {
        expect(toggleInline('hello world', 0, 5, '**')).toEqual({ next: '**hello** world', selStart: 2, selEnd: 7 })
    })

    it('drops the marker pair around a wrapped selection', () => {
        expect(toggleInline('**hello** world', 2, 7, '**')).toEqual({ next: 'hello world', selStart: 0, selEnd: 5 })
    })

    it('unwraps a selection that includes the markers', () => {
        expect(toggleInline('**hello** world', 0, 9, '**')).toEqual({ next: 'hello world', selStart: 0, selEnd: 5 })
    })

    it('parks an empty caret between fresh markers', () => {
        expect(toggleInline('', 0, 0, '*')).toEqual({ next: '**', selStart: 1, selEnd: 1 })
    })
})

describe('toggleLinePrefix', () => {
    it('bullets every selected line', () => {
        expect(toggleLinePrefix('one\ntwo', 0, 7, 'bullet').next).toBe('- one\n- two')
    })

    it('strips bullets when every line already has one', () => {
        expect(toggleLinePrefix('- one\n- two', 0, 11, 'bullet').next).toBe('one\ntwo')
    })

    it('renumbers an ordered list from 1', () => {
        expect(toggleLinePrefix('a\nb\nc', 0, 5, 'ordered').next).toBe('1. a\n2. b\n3. c')
    })

    it('converts one list kind to the other instead of stacking', () => {
        expect(toggleLinePrefix('- one\n- two', 0, 11, 'ordered').next).toBe('1. one\n2. two')
    })

    it('quotes the caret line and keeps the caret on it', () => {
        const r = toggleLinePrefix('hello\nworld', 8, 8, 'quote')
        expect(r.next).toBe('hello\n> world')
        expect(r.selStart).toBe(10)
        expect(r.selEnd).toBe(10)
    })

    it('passes blank lines through a multi-line toggle', () => {
        expect(toggleLinePrefix('one\n\ntwo', 0, 8, 'bullet').next).toBe('- one\n\n- two')
    })
})

describe('toggleCodeBlock', () => {
    it('fences a selection on its own lines', () => {
        const r = toggleCodeBlock('before\ncode here', 7, 16)
        expect(r.next).toBe('before\n```\ncode here\n```')
        expect(r.next.slice(r.selStart, r.selEnd)).toBe('code here')
    })

    it('unwraps a selected fence', () => {
        expect(toggleCodeBlock('```\ncode\n```', 0, 12)).toEqual({ next: 'code', selStart: 0, selEnd: 4 })
    })

    it('parks an empty caret inside a fresh fence', () => {
        const r = toggleCodeBlock('', 0, 0)
        expect(r.next).toBe('```\n\n```')
        expect(r.selStart).toBe(4)
        expect(r.selEnd).toBe(4)
    })
})

describe('insertLink', () => {
    it('links the selection', () => {
        expect(insertLink('see docs now', 4, 8, 'https://example.com').next).toBe('see [docs](https://example.com) now')
    })

    it('links the URL itself when nothing is selected', () => {
        expect(insertLink('', 0, 0, 'https://example.com').next).toBe('[https://example.com](https://example.com)')
    })

    it('prefers explicit text over the selection', () => {
        expect(insertLink('x', 0, 1, 'https://example.com', 'label').next).toBe('[label](https://example.com)')
    })
})
