import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyChatMessage, messageClipboardHtml } from './chat-clipboard'

afterEach(() => vi.unstubAllGlobals())

describe('formatted response copying', () => {
  it('exports semantic tables, formatting, links and code without UI controls', () => {
    const html = messageClipboardHtml('| Item | Count |\n| --- | --- |\n| Apple | 3 |\n\n**Bold** [link](https://example.com)\n\n```python\nprint("hello")\n```')
    const dom = new DOMParser().parseFromString(html, 'text/html')
    expect(dom.querySelectorAll('tr')).toHaveLength(2)
    expect(dom.querySelector('strong')?.textContent).toBe('Bold')
    expect(dom.querySelector('a')?.href).toBe('https://example.com/')
    expect(dom.querySelector('pre code')?.textContent).toContain('print("hello")')
    expect(dom.querySelector('button')).toBeNull()
    expect(messageClipboardHtml('<script>alert(1)</script>')).not.toContain('<script>')
  })
  it('writes both clipboard representations', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn()
    const items: Record<string, Blob>[] = []
    vi.stubGlobal('ClipboardItem', class { constructor(data: Record<string, Blob>) { items.push(data) } })
    vi.stubGlobal('navigator', { userAgent: navigator.userAgent, platform: navigator.platform, clipboard: { write, writeText } })
    await copyChatMessage('**Hello**')
    expect(Object.keys(items[0])).toEqual(['text/html', 'text/plain'])
    expect(write).toHaveBeenCalledOnce()
    expect(writeText).not.toHaveBeenCalled()
  })
  it('falls back to text and propagates total clipboard failure', async () => {
    vi.stubGlobal('ClipboardItem', class {})
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { userAgent: navigator.userAgent, platform: navigator.platform, clipboard: { write: vi.fn().mockRejectedValue(new Error('Unsupported')), writeText } })
    await copyChatMessage('**Hello**')
    expect(writeText).toHaveBeenCalledWith('**Hello**')
    writeText.mockRejectedValue(new Error('Denied'))
    await expect(copyChatMessage('Hello')).rejects.toThrow('Denied')
  })
})
