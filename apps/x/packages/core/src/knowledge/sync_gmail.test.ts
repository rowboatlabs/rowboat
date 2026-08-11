import { describe, expect, it } from 'vitest';
import {
  buildQuotedReplyTrailFromMessages,
  formatFromHeader,
  isEmailTooOldToNotify,
  NEW_EMAIL_MAX_AGE_MS,
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

describe('isEmailTooOldToNotify (stale backlog suppression)', () => {
  const now = 1_700_000_000_000;

  it('suppresses emails older than the freshness window', () => {
    const old = now - NEW_EMAIL_MAX_AGE_MS - 1;
    expect(isEmailTooOldToNotify(old, now)).toBe(true);
  });

  it('notifies for emails within the freshness window', () => {
    const recent = now - (NEW_EMAIL_MAX_AGE_MS - 1);
    expect(isEmailTooOldToNotify(recent, now)).toBe(false);
  });

  it('notifies for emails exactly at the window boundary', () => {
    expect(isEmailTooOldToNotify(now - NEW_EMAIL_MAX_AGE_MS, now)).toBe(false);
  });

  it('notifies when the email date is unknown (dateMs === 0)', () => {
    // 0 means snapshotDateMs could not parse a date; err toward notifying
    // rather than silently dropping genuinely-new mail.
    expect(isEmailTooOldToNotify(0, now)).toBe(false);
  });

  it('notifies for a brand-new email (dateMs === now)', () => {
    expect(isEmailTooOldToNotify(now, now)).toBe(false);
  });
});

describe('buildQuotedReplyTrailFromMessages (quoted trail on threaded sends)', () => {
  const messages = [
    {
      from: 'Alice <alice@example.com>',
      date: 'Mon, 10 Aug 2026 09:00:00 +0530',
      body: 'First message',
      bodyHtml: '<p>First message</p>',
      messageIdHeader: '<first@example.com>',
    },
    {
      from: 'Bob <bob@example.com>',
      date: 'Tue, 11 Aug 2026 10:30:00 +0530',
      body: 'Latest question\nsecond line',
      bodyHtml: '<p>Latest question</p>',
      messageIdHeader: '<latest@example.com>',
    },
  ];

  it('quotes the message matching In-Reply-To with attribution and "> " prefixes', () => {
    const trail = buildQuotedReplyTrailFromMessages(messages, '<first@example.com>');
    expect(trail).not.toBeNull();
    expect(trail!.text).toBe(
      'On Mon, 10 Aug 2026 09:00:00 +0530, Alice <alice@example.com> wrote:\n> First message',
    );
    expect(trail!.html).toContain('class="gmail_attr"');
    expect(trail!.html).toContain('<blockquote class="gmail_quote"');
    expect(trail!.html).toContain('<p>First message</p>');
  });

  it('falls back to the latest message when In-Reply-To is unknown', () => {
    const trail = buildQuotedReplyTrailFromMessages(messages, '<unknown@example.com>');
    expect(trail!.text).toContain('Bob <bob@example.com> wrote:');
    expect(trail!.text).toContain('> Latest question\n> second line');
  });

  it('round-trips through the reply sanitizer (attribution is recognized as a boundary)', () => {
    const trail = buildQuotedReplyTrailFromMessages(messages)!;
    const sent = `My reply\n\n${trail.text}`;
    expect(stripGmailQuotedReplyText(sent)).toBe('My reply');
  });

  it('drops data: URI images from the quoted html but keeps remote ones', () => {
    const trail = buildQuotedReplyTrailFromMessages([{
      from: 'Alice <alice@example.com>',
      date: 'Mon, 10 Aug 2026 09:00:00 +0530',
      body: 'See image',
      bodyHtml: '<p>See image</p><img src="data:image/png;base64,AAAA"><img src="https://example.com/a.png">',
    }]);
    expect(trail!.html).not.toContain('data:image/png');
    expect(trail!.html).toContain('https://example.com/a.png');
  });

  it('skips drafts and returns null when nothing quotable exists', () => {
    expect(buildQuotedReplyTrailFromMessages([{ body: 'wip', isDraft: true }])).toBeNull();
    expect(buildQuotedReplyTrailFromMessages([{ body: '   ' }])).toBeNull();
    expect(buildQuotedReplyTrailFromMessages([])).toBeNull();
  });

  it('escapes html in the attribution line', () => {
    const trail = buildQuotedReplyTrailFromMessages([{
      from: 'Alice <alice@example.com>',
      date: 'Mon, 10 Aug 2026 09:00:00 +0530',
      body: 'hello',
    }]);
    expect(trail!.html).toContain('Alice &lt;alice@example.com&gt; wrote:');
  });
});

describe('formatFromHeader (outgoing From with display name)', () => {
  it('returns the bare address when no name is known', () => {
    expect(formatFromHeader(null, 'a@b.com')).toBe('a@b.com');
    expect(formatFromHeader('   ', 'a@b.com')).toBe('a@b.com');
  });

  it('quotes an ASCII display name', () => {
    expect(formatFromHeader('Arjun M', 'a@b.com')).toBe('"Arjun M" <a@b.com>');
  });

  it('RFC-2047 encodes a non-ASCII name without wrapping it in quotes', () => {
    const header = formatFromHeader('Ärjun', 'a@b.com');
    expect(header).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <a@b\.com>$/);
    expect(Buffer.from(header.slice('=?UTF-8?B?'.length, header.indexOf('?= <')), 'base64').toString('utf8')).toBe('Ärjun');
  });

  it('strips characters that would corrupt the header', () => {
    expect(formatFromHeader('Bad\r\nName "X" <spoof@evil.com>', 'a@b.com')).toBe('"Bad Name X spoof@evil.com" <a@b.com>');
  });
});
