import { describe, expect, it } from 'vitest'
import { prepareEmailHtml, QUOTED_CLASS, splitPlainTextQuote, stripQuotedReplyText } from './email-quotes'

/** Visible text once the stylesheet hides the tagged nodes. */
function visible(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll(`.${QUOTED_CLASS}`).forEach((n) => n.remove())
  return (doc.body?.textContent || '').replace(/\s+/g, ' ').trim()
}

// The divider Outlook desktop emits: the header lives inside it, the quoted
// chain trails it as siblings.
const OUTLOOK_QUOTE = `
<div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0in 0in 0in">
  <p class="MsoNormal"><b>From:</b> Counsel &lt;c@firm.com&gt;<br>
  <b>Sent:</b> Tuesday, July 7, 2026 9:14 AM<br>
  <b>To:</b> Me &lt;me@co.com&gt;<br>
  <b>Subject:</b> Re: Series A docs</p>
</div>
<p class="MsoNormal">The indemnity clause needs revisiting.</p>`

describe('prepareEmailHtml — quote detection', () => {
  it('hides an Outlook quoted chain, including the siblings after the divider', () => {
    const { html, hasQuote } = prepareEmailHtml(
      `<p class="MsoNormal">Agreed, see below.</p>${OUTLOOK_QUOTE}`,
    )
    expect(hasQuote).toBe(true)
    expect(visible(html)).toBe('Agreed, see below.')
  })

  it('hides an Outlook quote nested beside a signature in an outer wrapper', () => {
    const { html, hasQuote } = prepareEmailHtml(
      `<div><p>Sounds good.</p><p>-- Jane, Partner</p><div>${OUTLOOK_QUOTE}</div></div>`,
    )
    expect(hasQuote).toBe(true)
    expect(visible(html)).toContain('Sounds good.')
    expect(visible(html)).toContain('-- Jane, Partner')
    expect(visible(html)).not.toContain('indemnity')
  })

  it('hides Outlook-on-the-web quoted chains via divRplyFwdMsg', () => {
    const { html, hasQuote } = prepareEmailHtml(
      `<div>Short reply.</div><div id="divRplyFwdMsg"><b>From:</b> C</div><div>Older content.</div>`,
    )
    expect(hasQuote).toBe(true)
    expect(visible(html)).toBe('Short reply.')
  })

  it('still hides Gmail wrapper quotes', () => {
    const { html, hasQuote } = prepareEmailHtml(
      `<div>Thanks!</div><div class="gmail_quote"><div class="gmail_attr">On Tue, X wrote:</div><blockquote>old</blockquote></div>`,
    )
    expect(hasQuote).toBe(true)
    expect(visible(html)).toBe('Thanks!')
  })

  it('leaves a border-top divider alone when it is a signature rule, not a quote header', () => {
    const html = `<p>Hi there.</p><div style="border-top:solid #E1E1E1 1.0pt"><p>Jane Doe | Acme | jane@acme.com</p></div>`
    const prepared = prepareEmailHtml(html)
    expect(prepared.hasQuote).toBe(false)
    expect(visible(prepared.html)).toContain('Jane Doe')
  })

  it('shows a forward in full rather than collapsing the whole body', () => {
    // Everything is quoted, so hiding would leave a blank message.
    const prepared = prepareEmailHtml(
      `<div class="gmail_quote"><div class="gmail_attr">---------- Forwarded message ---------</div><div>The actual content.</div></div>`,
    )
    expect(prepared.hasQuote).toBe(false)
    expect(visible(prepared.html)).toContain('The actual content.')
  })

  it('reports no quote for a plain message', () => {
    expect(prepareEmailHtml('<p>Just a note.</p>').hasQuote).toBe(false)
  })

  it('keeps a <style> block the parser would otherwise hoist into <head>', () => {
    const { html } = prepareEmailHtml('<style>.a{color:red}</style><p>Body</p>')
    expect(html).toContain('.a{color:red}')
  })

  it('ignores quoted content when deciding whether the email is styled', () => {
    // The table lives only in the quote, so the body should still adapt to theme.
    const { styled } = prepareEmailHtml(
      `<p>ok</p><div class="gmail_quote"><table><tr><td>old</td></tr></table></div>`,
    )
    expect(styled).toBe(false)
  })
})

describe('splitPlainTextQuote', () => {
  it('splits on an Outlook From:/Sent:/To:/Subject: header block', () => {
    const body = [
      'Agreed.',
      '',
      'From: Counsel <c@firm.com>',
      'Sent: Tuesday, July 7, 2026 9:14 AM',
      'To: Me <me@co.com>',
      'Subject: Re: Series A docs',
      '',
      'The indemnity clause needs revisiting.',
    ].join('\n')
    const { visible: head, quoted } = splitPlainTextQuote(body)
    expect(head).toBe('Agreed.')
    expect(quoted).toContain('The indemnity clause')
  })

  it('splits on "On … wrote:"', () => {
    const { visible: head, quoted } = splitPlainTextQuote('Thanks!\n\nOn Tue, Jul 7, X wrote:\n> old')
    expect(head).toBe('Thanks!')
    expect(quoted).toContain('> old')
  })

  it('splits on a forwarded-message separator', () => {
    const { visible: head, quoted } = splitPlainTextQuote('FYI\n\n---------- Forwarded message ---------\nbody')
    expect(head).toBe('FYI')
    expect(quoted).toContain('body')
  })

  it('returns no quote when there is no boundary', () => {
    expect(splitPlainTextQuote('Just a note.').quoted).toBeNull()
  })

  it('does not treat a bare "From:" line as a boundary', () => {
    expect(splitPlainTextQuote('From: the desk of Jane\n\nHello.').quoted).toBeNull()
  })
})

describe('stripQuotedReplyText', () => {
  it('drops an Outlook quoted tail', () => {
    const body = 'Agreed.\n\nFrom: C <c@f.com>\nSent: Tue\nTo: Me\nSubject: Re: x\n\nold'
    expect(stripQuotedReplyText(body)).toBe('Agreed.')
  })

  it('drops a ">" quoted tail', () => {
    expect(stripQuotedReplyText('Reply.\n\n> old line')).toBe('Reply.')
  })
})
