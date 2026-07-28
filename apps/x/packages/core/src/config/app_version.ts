import fs from 'node:fs';
import path from 'node:path';
import { WorkDir } from './config.js';

const VERSION_PATH = path.join(WorkDir, 'config', 'app-version.json');

/**
 * Record the running app version in WorkDir/config/app-version.json and
 * report what changed. Returns the previously recorded version when this
 * launch is the first on a new version, or null on a fresh install or when
 * the version is unchanged. A missing/corrupt stamp file is treated as a
 * fresh install so users never see a spurious "updated" notice.
 */
export function recordAppVersion(currentVersion: string): string | null {
    let previous: string | null = null;
    try {
        const raw = fs.readFileSync(VERSION_PATH, 'utf-8');
        const parsed = JSON.parse(raw) as { version?: string };
        if (typeof parsed.version === 'string') previous = parsed.version;
    } catch {
        // fresh install or unreadable stamp — fall through with previous = null
    }

    if (previous === currentVersion) return null;

    try {
        fs.mkdirSync(path.dirname(VERSION_PATH), { recursive: true });
        fs.writeFileSync(VERSION_PATH, JSON.stringify({ version: currentVersion }, null, 2));
    } catch (err) {
        console.error('[Updates] Failed to write app-version.json:', err);
    }

    return previous;
}

/**
 * True when `to` is a strictly newer dotted version than `from`. Numeric
 * segment compare; a leading `v` and any prerelease suffix are ignored.
 * Unparseable input counts as not-an-upgrade, so callers stay quiet on
 * malformed stamps rather than announcing a bogus update.
 */
export function isVersionUpgrade(from: string, to: string): boolean {
    const parse = (v: string) => v.trim().replace(/^v/i, '').split('-')[0].split('.').map(Number);
    const a = parse(from);
    const b = parse(to);
    if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        if (x !== y) return y > x;
    }
    return false;
}
