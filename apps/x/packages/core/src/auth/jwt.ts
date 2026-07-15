/**
 * Decode a JWT's payload segment without verifying the signature — for
 * reading claims out of tokens we already trust (or only use as local cache
 * keys), never for authentication decisions.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
    try {
        const parts = token.split('.');
        if (parts.length < 2) return null;
        const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
        const json = Buffer.from(padded + pad, 'base64').toString('utf-8');
        const parsed = JSON.parse(json);
        return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
    } catch {
        return null;
    }
}
