import { describe, expect, it } from 'vitest';
import {
  sanitizeReplyBodyForGmailReply,
  stripGmailQuotedReplyHtml,
  stripGmailQuotedReplyText,
} from './sync_gmail.js';

describe('Gmail reply body sanitization', () => {
  it('strips Gmail quote attribution and older quoted text from plain text replies', () => {
    const body = [
      'Sounds good, thanks. I will send it over today.',
      '',
      'On Thu, 28 May 2026 at 23:45, PRAKHAR <prakhar9999pandey@gmail.com> wrote:',
      '> Can you share the final file?',
      '> Thanks',
    ].join('\n');

    expect(stripGmailQuotedReplyText(body)).toBe('Sounds good, thanks. I will send it over today.');
  });

  it('strips Gmail quote blocks from html replies', () => {
    const html = [
      '<p>Sounds good, thanks.</p>',
      '<div class="gmail_quote">',
      '<div dir="ltr" class="gmail_attr">On Thu, 28 May 2026 at 23:45, PRAKHAR wrote:<br></div>',
      '<blockquote>Older thread text</blockquote>',
      '</div>',
    ].join('');

    expect(stripGmailQuotedReplyHtml(html)).toBe('<p>Sounds good, thanks.</p>');
  });

  it('regenerates html from clean text if only the text boundary is detected', () => {
    const result = sanitizeReplyBodyForGmailReply(
      '<p>Sounds good, thanks.</p><p>Older thread text</p>',
      'Sounds good, thanks.\n\nOn Thu, 28 May 2026 at 23:45, PRAKHAR <prakhar9999pandey@gmail.com> wrote:\nOlder thread text',
    );

    expect(result.bodyText).toBe('Sounds good, thanks.');
    expect(result.bodyHtml).toBe('<p>Sounds good, thanks.</p>');
  });
});
