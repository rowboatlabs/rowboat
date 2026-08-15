import { describe, expect, it } from 'vitest';
import type { GmailThreadSnapshot } from './sync_gmail.js';
import {
    headerMatchesOwner,
    resolveOwnerIdentityEmails,
    userSentLatest,
} from './classify_thread.js';

function snap(messages: Array<{ from?: string }>): GmailThreadSnapshot {
    return {
        threadId: 't1',
        threadUrl: 'https://mail.google.com/mail/#inbox/t1',
        importance: 'other',
        messages: messages.map((m) => ({
            id: 'm',
            from: m.from ?? '',
            body: 'hi',
        })),
    };
}

describe('headerMatchesOwner', () => {
    it('matches any owner email in a From header', () => {
        const owners = ['a@acme.com', 'b@custom.com'];
        expect(headerMatchesOwner('Alice <a@acme.com>', owners)).toBe(true);
        expect(headerMatchesOwner('Bob <b@custom.com>', owners)).toBe(true);
        expect(headerMatchesOwner('Eve <eve@x.com>', owners)).toBe(false);
    });

    it('is case-insensitive', () => {
        expect(headerMatchesOwner('Alice <A@ACME.COM>', ['a@acme.com'])).toBe(true);
    });
});

describe('userSentLatest', () => {
    it('returns true when latest From is the owner', () => {
        const s = snap([
            { from: 'Other <o@x.com>' },
            { from: 'Me <me@acme.com>' },
        ]);
        expect(userSentLatest(s, ['me@acme.com'])).toBe(true);
    });

    it('returns true when latest From is a secondary owner alias', () => {
        const s = snap([
            { from: 'Other <o@x.com>' },
            { from: 'Me <alias@custom.com>' },
        ]);
        expect(userSentLatest(s, ['me@acme.com', 'alias@custom.com'])).toBe(true);
    });

    it('returns false when latest is external', () => {
        const s = snap([
            { from: 'Me <me@acme.com>' },
            { from: 'Other <o@x.com>' },
        ]);
        expect(userSentLatest(s, ['me@acme.com'])).toBe(false);
    });

    it('returns false with empty owner set', () => {
        const s = snap([{ from: 'Me <me@acme.com>' }]);
        expect(userSentLatest(s, [])).toBe(false);
    });
});

describe('resolveOwnerIdentityEmails', () => {
    it('includes connected email even when user.json is empty', () => {
        // No workdir config guaranteed — connected alone should still work.
        const emails = resolveOwnerIdentityEmails('connected@acme.com');
        expect(emails).toContain('connected@acme.com');
    });

    it('dedupes connected against itself', () => {
        const emails = resolveOwnerIdentityEmails('Connected@Acme.com');
        expect(emails.filter((e) => e === 'connected@acme.com')).toHaveLength(1);
    });
});
