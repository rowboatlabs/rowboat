import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// WorkDir is resolved at config module load — set env before any import.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rowboat-user-config-test-'));
process.env.ROWBOAT_WORKDIR = tmpDir;

const {
    normalizeUserConfig,
    unionEmails,
    loadUserConfig,
    saveUserConfig,
    updateUserEmail,
    getOwnerEmails,
    isOwnerEmail,
} = await import('./user_config.js');

const configPath = path.join(tmpDir, 'config', 'user.json');

function writeRaw(obj: unknown) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(obj, null, 2));
}

describe('unionEmails / normalizeUserConfig', () => {
    it('dedupes and lowercases', () => {
        expect(unionEmails(['A@X.com', 'a@x.com'], 'b@y.com')).toEqual(['a@x.com', 'b@y.com']);
    });

    it('migrates legacy { email } only into emails set', () => {
        const n = normalizeUserConfig({ email: 'A@X.com' });
        expect(n).toEqual({
            email: 'a@x.com',
            emails: ['a@x.com'],
            domain: 'x.com',
        });
    });

    it('unions emails + email fields', () => {
        const n = normalizeUserConfig({
            email: 'primary@acme.com',
            emails: ['alias@acme.com', 'PRIMARY@acme.com'],
            name: 'Alex',
        });
        expect(n?.email).toBe('primary@acme.com');
        expect(n?.emails).toEqual(['alias@acme.com', 'primary@acme.com']);
        expect(n?.name).toBe('Alex');
    });

    it('accepts emails-only config', () => {
        const n = normalizeUserConfig({ emails: ['one@x.com', 'two@y.com'] });
        expect(n?.email).toBe('one@x.com');
        expect(n?.emails).toEqual(['one@x.com', 'two@y.com']);
    });

    it('returns null when no identity present', () => {
        expect(normalizeUserConfig({})).toBeNull();
        expect(normalizeUserConfig({ name: 'No Email' })).toBeNull();
    });
});

describe('load / save / updateUserEmail', () => {
    beforeEach(() => {
        if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
    });

    afterEach(() => {
        if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
    });

    it('loads legacy single-email file', () => {
        writeRaw({ email: 'legacy@acme.com' });
        const u = loadUserConfig();
        expect(u?.email).toBe('legacy@acme.com');
        expect(u?.emails).toEqual(['legacy@acme.com']);
    });

    it('updateUserEmail creates config when missing', () => {
        updateUserEmail('new@acme.com');
        const u = loadUserConfig();
        expect(u?.email).toBe('new@acme.com');
        expect(u?.emails).toEqual(['new@acme.com']);
        const disk = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect(disk.emails).toEqual(['new@acme.com']);
        expect(disk.email).toBe('new@acme.com');
    });

    it('updateUserEmail adds second address without dropping primary', () => {
        writeRaw({ email: 'a@acme.com', emails: ['a@acme.com'] });
        updateUserEmail('b@acme.com');
        const u = loadUserConfig();
        expect(u?.email).toBe('a@acme.com');
        expect(u?.emails).toEqual(['a@acme.com', 'b@acme.com']);
    });

    it('saveUserConfig always writes both email and emails', () => {
        saveUserConfig({ email: 'solo@x.com', emails: ['solo@x.com'] });
        const disk = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect(disk.email).toBe('solo@x.com');
        expect(disk.emails).toEqual(['solo@x.com']);
    });

    it('getOwnerEmails / isOwnerEmail match the set', () => {
        writeRaw({
            email: 'a@acme.com',
            emails: ['a@acme.com', 'b@custom.com'],
        });
        expect(getOwnerEmails()).toEqual(['a@acme.com', 'b@custom.com']);
        expect(isOwnerEmail('Alice <a@acme.com>')).toBe(true);
        expect(isOwnerEmail('Bob <b@custom.com>')).toBe(true);
        expect(isOwnerEmail('Eve <eve@other.com>')).toBe(false);
    });
});
