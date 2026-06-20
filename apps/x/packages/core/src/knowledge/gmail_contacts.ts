import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { WorkDir } from '../config/config.js';
import type { GmailThreadSnapshot } from './sync_gmail.js';
import { getAccountEmail } from './sync_gmail.js';
import { isAutomatedAddress } from './contact_filters.js';

const CACHE_DIR = path.join(WorkDir, 'inbox_lists');
const INDEX_TTL_MS = 5 * 60 * 1000;
const RECENCY_HALFLIFE_DAYS = 60;
const READ_CONCURRENCY = 16;

export interface Contact {
    name: string;
    email: string;
    count: number;
    lastSeenMs: number;
}

interface IndexEntry {
    name: string;
    email: string;
    count: number;
    lastSeenMs: number;
    nameCounts: Map<string, number>;
}

let cachedIndex: Map<string, IndexEntry> | null = null;
let cachedAt = 0;
let pendingRebuild: Promise<Map<string, IndexEntry>> | null = null;

function parseAddressList(header: string): Array<{ name: string; email: string }> {
    if (!header) return [];
    const parts: string[] = [];
    let buf = '';
    let inQuotes = false;
    let inBrackets = 0;
    for (const ch of header) {
        if (ch === '"' && inBrackets === 0) inQuotes = !inQuotes;
        else if (ch === '<') inBrackets++;
        else if (ch === '>') inBrackets = Math.max(0, inBrackets - 1);
        if (ch === ',' && !inQuotes && inBrackets === 0) {
            if (buf.trim()) parts.push(buf.trim());
            buf = '';
        } else {
            buf += ch;
        }
    }
    if (buf.trim()) parts.push(buf.trim());

    const result: Array<{ name: string; email: string }> = [];
    for (const part of parts) {
        const angled = part.match(/^(.*?)<\s*([^>]+?)\s*>\s*$/);
        if (angled) {
            const name = angled[1].trim().replace(/^"|"$/g, '').trim();
            const email = angled[2].trim().toLowerCase();
            if (email.includes('@')) result.push({ name, email });
        } else if (part.includes('@')) {
            result.push({ name: '', email: part.trim().toLowerCase() });
        }
    }
    return result;
}

function ingestSnapshot(snapshot: GmailThreadSnapshot, selfEmail: string, map: Map<string, IndexEntry>): void {
    if (!snapshot?.messages) return;
    for (const msg of snapshot.messages) {
        const parsed = msg.date ? Date.parse(msg.date) : NaN;
        const ts = Number.isFinite(parsed) ? parsed : 0;
        const fromAddrs = msg.from ? parseAddressList(msg.from) : [];
        const sentBySelf = fromAddrs.some((a) => a.email === selfEmail);

        // Collect candidate contacts. For outbound mail, take recipients (the
        // people *you* chose to write to — highest signal). For inbound mail,
        // take the sender, but only if it doesn't look like a no-reply bot.
        const candidates: Array<{ name: string; email: string }> = [];
        if (sentBySelf) {
            for (const h of [msg.to, msg.cc].filter(Boolean) as string[]) {
                candidates.push(...parseAddressList(h));
            }
        } else {
            for (const a of fromAddrs) candidates.push(a);
        }

        for (const { name, email } of candidates) {
            if (!email || email === selfEmail) continue;
            if (isAutomatedAddress(email)) continue;
            let entry = map.get(email);
            if (!entry) {
                entry = { name, email, count: 0, lastSeenMs: 0, nameCounts: new Map() };
                map.set(email, entry);
            }
            // Sent-to addresses carry stronger signal than inbound senders.
            entry.count += sentBySelf ? 3 : 1;
            if (ts > entry.lastSeenMs) entry.lastSeenMs = ts;
            if (name) entry.nameCounts.set(name, (entry.nameCounts.get(name) || 0) + 1);
        }
    }
}

async function rebuildIndex(): Promise<Map<string, IndexEntry>> {
    const map = new Map<string, IndexEntry>();
    if (!fs.existsSync(CACHE_DIR)) return map;

    // Without a self email we can't tell which messages were sent by the user,
    // so the index stays empty until Gmail is connected.
    const selfRaw = await getAccountEmail().catch(() => null);
    if (!selfRaw) return map;
    const selfEmail = selfRaw.trim().toLowerCase();

    let names: string[];
    try {
        names = await fsp.readdir(CACHE_DIR);
    } catch {
        return map;
    }

    const files = names.filter((n) => n.endsWith('.json'));
    // Cap concurrency so a huge inbox can't blow the FD table.
    for (let i = 0; i < files.length; i += READ_CONCURRENCY) {
        const slice = files.slice(i, i + READ_CONCURRENCY);
        const chunks = await Promise.all(
            slice.map(async (fname) => {
                try {
                    return await fsp.readFile(path.join(CACHE_DIR, fname), 'utf-8');
                } catch {
                    return null;
                }
            }),
        );
        for (const raw of chunks) {
            if (!raw) continue;
            try {
                const wrapper = JSON.parse(raw) as { snapshot?: GmailThreadSnapshot };
                if (wrapper.snapshot) ingestSnapshot(wrapper.snapshot, selfEmail, map);
            } catch {
                continue;
            }
        }
    }

    for (const entry of map.values()) {
        let best = entry.name;
        let bestN = 0;
        for (const [n, c] of entry.nameCounts) {
            if (c > bestN) { best = n; bestN = c; }
        }
        entry.name = best;
    }
    return map;
}

async function getIndex(): Promise<Map<string, IndexEntry>> {
    const now = Date.now();
    const fresh = cachedIndex && now - cachedAt <= INDEX_TTL_MS;
    if (fresh) return cachedIndex!;

    // Serve stale cache while a refresh runs in the background; only block when
    // there's no cache at all.
    if (!pendingRebuild) {
        pendingRebuild = rebuildIndex().then((m) => {
            cachedIndex = m;
            cachedAt = Date.now();
            pendingRebuild = null;
            return m;
        }).catch((err) => {
            pendingRebuild = null;
            throw err;
        });
    }
    if (cachedIndex) return cachedIndex;
    return pendingRebuild;
}

export function invalidateContactIndex(): void {
    cachedIndex = null;
    cachedAt = 0;
}

// Warm the cache eagerly so the first user keystroke doesn't pay the cost.
export function warmContactIndex(): void {
    void getIndex().catch(() => {});
}

function score(entry: IndexEntry, nowMs: number): number {
    const days = Math.max(0, (nowMs - entry.lastSeenMs) / (1000 * 60 * 60 * 24));
    const recency = Math.pow(0.5, days / RECENCY_HALFLIFE_DAYS);
    return entry.count * (0.5 + 0.5 * recency);
}

function matchTier(q: string, entry: IndexEntry): number {
    if (!q) return 3;
    const name = entry.name.toLowerCase();
    const email = entry.email;
    if (name && name.startsWith(q)) return 0;
    if (email.startsWith(q)) return 1;
    if (name && name.includes(' ' + q)) return 1;
    if (name && name.includes(q)) return 2;
    if (email.includes(q)) return 3;
    return -1;
}

export interface SearchOpts {
    limit?: number;
    excludeEmails?: string[];
}

export async function searchContacts(query: string, opts: SearchOpts = {}): Promise<Contact[]> {
    const q = query.trim().toLowerCase();
    const limit = Math.max(1, Math.min(50, opts.limit ?? 8));
    const excluded = new Set((opts.excludeEmails ?? []).map((e) => e.trim().toLowerCase()));

    const index = await getIndex();
    const nowMs = Date.now();
    const matches: Array<{ entry: IndexEntry; tier: number; s: number }> = [];
    for (const entry of index.values()) {
        if (excluded.has(entry.email)) continue;
        const tier = matchTier(q, entry);
        if (tier < 0) continue;
        matches.push({ entry, tier, s: score(entry, nowMs) });
    }
    matches.sort((a, b) => (a.tier - b.tier) || (b.s - a.s));
    return matches.slice(0, limit).map(({ entry }) => ({
        name: entry.name,
        email: entry.email,
        count: entry.count,
        lastSeenMs: entry.lastSeenMs,
    }));
}
