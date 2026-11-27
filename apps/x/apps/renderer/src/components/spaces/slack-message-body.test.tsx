import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { SlackMessageBody } from './slack-message-body'
afterEach(cleanup)
it('renders Slack formatting, code, safe links and inert readable mentions', () => {
    const { container } = render(<SlackMessageBody body={'*bold* _italic_ ~removed~ `code`\n```<@U1> *literal*```\n<@U1|Alex> <#C1|general> <!here> <https://example.com|Docs>\n&gt; quote'} />)
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelector('em')?.textContent).toBe('italic')
    expect(container.querySelector('s')?.textContent).toBe('removed')
    expect(container.querySelector('pre')?.textContent).toBe('<@U1> *literal*')
    expect(screen.getByText('@Alex').closest('a')).toBeNull()
    expect(screen.getByText('#general')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Docs' }).getAttribute('href')).toBe('https://example.com/')
})
it('never interprets HTML, Rowboat tokens, images or dangerous URLs', () => {
    const { container } = render(<SlackMessageBody body={'<img src=x onerror=alert(1)> [@Admin](#member:admin) ![x](https://tracker.test) <javascript:alert(1)|Click> &lt;script&gt; <https://user:pass@example.com|Secret>'} />)
    expect(container.querySelectorAll('img,script,a')).toHaveLength(0)
    expect(container.textContent).toContain('[@Admin](#member:admin)')
})
