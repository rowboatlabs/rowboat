import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { WorkDir } from './config.js';

const USER_CONFIG_PATH = path.join(WorkDir, 'config', 'user.json');

/**
 * On-disk shape. `email` remains the primary/display address for back-compat.
 * `emails` is the full owner identity set (self-exclusion, reply gate, classify).
 * After load, both are always populated when a config exists.
 */
const RawUserConfig = z.object({
    name: z.string().optional(),
    email: z.string().email().optional(),
    emails: z.array(z.string().email()).optional(),
    domain: z.string().optional(),
});

export type UserConfig = {
    name?: string;
    /** Primary / display address (legacy singular field; always set when config exists). */
    email: string;
    /** Full owner identity set (lowercased, unique). Includes `email`. */
    emails: string[];
    domain?: string;
};

export function normalizeEmail(addr: string): string {
    return addr.trim().toLowerCase();
}

/** Union and dedupe email addresses (lowercased). Order: first-seen wins. */
export function unionEmails(...groups: Array<string | null | undefined | readonly string[]>): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const g of groups) {
        if (g == null) continue;
        const list = typeof g === 'string' ? [g] : g;
        for (const raw of list) {
            if (!raw || typeof raw !== 'string') continue;
            const e = normalizeEmail(raw);
            if (!e || seen.has(e)) continue;
            // Basic shape check — skip garbage without throwing mid-union
            if (!e.includes('@')) continue;
            seen.add(e);
            out.push(e);
        }
    }
    return out;
}

/**
 * Normalize a raw on-disk object into UserConfig.
 * Returns null if no usable email identity is present.
 */
export function normalizeUserConfig(raw: unknown): UserConfig | null {
    const parsed = RawUserConfig.safeParse(raw);
    if (!parsed.success) return null;
    const data = parsed.data;
    const emails = unionEmails(data.emails, data.email);
    if (emails.length === 0) return null;

    // Primary: legacy `email` if present and in set, else first of set
    const primaryCandidate = data.email ? normalizeEmail(data.email) : emails[0];
    const primary = emails.includes(primaryCandidate) ? primaryCandidate : emails[0];

    const domain =
        data.domain?.toLowerCase()
        ?? (primary.includes('@') ? primary.split('@')[1] : undefined);

    const result: UserConfig = {
        email: primary,
        emails,
    };
    if (data.name !== undefined) result.name = data.name;
    if (domain) result.domain = domain;
    return result;
}

export function loadUserConfig(): UserConfig | null {
    try {
        if (fs.existsSync(USER_CONFIG_PATH)) {
            const content = fs.readFileSync(USER_CONFIG_PATH, 'utf-8');
            const parsed = JSON.parse(content);
            return normalizeUserConfig(parsed);
        }
    } catch (error) {
        console.error('[UserConfig] Error loading user config:', error);
    }
    return null;
}

/** Owner email set for self-exclusion / reply gate / classify matching. */
export function getOwnerEmails(): string[] {
    return loadUserConfig()?.emails ?? [];
}

/**
 * True if `headerOrAddr` (e.g. a From: header) contains any owner email.
 * Optional `emails` override for tests / call-site identity sets.
 */
export function isOwnerEmail(headerOrAddr: string, emails?: readonly string[]): boolean {
    const set = emails ?? getOwnerEmails();
    if (set.length === 0 || !headerOrAddr) return false;
    const hay = headerOrAddr.toLowerCase();
    return set.some((e) => hay.includes(e));
}

export function saveUserConfig(config: UserConfig): void {
    const dir = path.dirname(USER_CONFIG_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const normalized = normalizeUserConfig(config);
    if (!normalized) {
        throw new Error('[UserConfig] Cannot save: no valid email identity');
    }
    // Persist both singular + set for back-compat readers
    const disk = {
        ...(normalized.name !== undefined ? { name: normalized.name } : {}),
        email: normalized.email,
        emails: normalized.emails,
        ...(normalized.domain !== undefined ? { domain: normalized.domain } : {}),
    };
    fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(disk, null, 2));
}

/**
 * Add `email` to the owner set. If no primary yet, it becomes primary.
 * Existing primary is preserved when already set (unless it was empty).
 */
export function updateUserEmail(email: string): void {
    const existing = loadUserConfig();
    const next = normalizeEmail(email);
    if (!next.includes('@')) {
        throw new Error(`[UserConfig] Invalid email: ${email}`);
    }
    if (!existing) {
        saveUserConfig({ email: next, emails: [next] });
        return;
    }
    const emails = unionEmails(existing.emails, next);
    saveUserConfig({
        ...existing,
        email: existing.email || next,
        emails,
    });
}
