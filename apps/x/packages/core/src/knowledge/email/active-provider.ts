// Single source of truth for which native email provider (Google or
// Microsoft) is connected. The connect flow enforces that at most one holds
// tokens; if both somehow do (hand-edited oauth.json), Google wins and we log
// a warning. Consumed by the email dispatcher, copilot prompt assembly, and
// the main-process OAuth handler — the "which mailbox is active" rule must
// never fork between them.
//
// The oauth repo resolves lazily (see di/lazy-resolve.ts): prompt assembly
// imports this while the DI container initializes, so a static container
// import here would break boot ordering. Any failure reads as "not
// connected" — the historical default for connection checks.
import { lazyResolve } from '../../di/lazy-resolve.js';
import type { EmailProviderId } from './provider.js';

async function hasTokens(id: EmailProviderId): Promise<boolean> {
    const repo = await lazyResolve<import('../../auth/repo.js').IOAuthRepo>('oauthRepo');
    const connection = await repo.read(id);
    return !!connection.tokens;
}

/** True when the given email provider currently holds OAuth tokens. */
export async function isEmailProviderConnected(id: EmailProviderId): Promise<boolean> {
    try {
        return await hasTokens(id);
    } catch {
        return false;
    }
}

/** The single active email provider, or null when none is connected. */
export async function getActiveEmailProviderId(): Promise<EmailProviderId | null> {
    try {
        const [google, microsoft] = await Promise.all([hasTokens('google'), hasTokens('microsoft')]);
        if (google && microsoft) {
            console.warn('[Email] Both Google and Microsoft hold tokens — using Google. Only one email provider is supported at a time.');
            return 'google';
        }
        if (google) return 'google';
        if (microsoft) return 'microsoft';
        return null;
    } catch {
        return null;
    }
}
