import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { WorkDir } from '../config/config.js';
import type { GmailThreadSnapshot } from './sync_gmail.js';
import { getAccountEmail } from './sync_gmail.js';

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

// Local-part aliases that are almost always automated/role addresses you don't
// compose a fresh message to. Matched as a whole segment of the local part
// (segments split on . _ - +).
const AUTOMATED_LOCAL_PARTS = new Set([
    'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'reply',
    'notifications', 'notification', 'notify',
    'alerts', 'alert', 'updates', 'update',
    'news', 'newsletter', 'newsletters',
    'info', 'information', 'hello', 'hi', 'hey',
    'welcome', 'onboarding', 'getstarted',
    'team', 'marketing', 'promo', 'promos', 'promotions',
    'offer', 'offers', 'deals', 'deal',
    'accounts', 'account', 'billing', 'invoices', 'statements', 'statement',
    'learn', 'learning', 'courses',
    'mailer-daemon', 'mailerdaemon', 'postmaster', 'bounce', 'bounces',
    'automated', 'auto', 'autoconfirm',
    'support-bot', 'noticeboard', 'system',
    'contact', 'connect',
    'sender', 'broadcast', 'digest', 'campaign', 'campaigns',
    'support', 'service', 'help', 'helpdesk', 'feedback',
    'mailer', 'mailers', 'members', 'membership',
    'careers', 'jobs', 'recruit', 'recruiting',
    'tickets', 'orders', 'order', 'receipts', 'receipt',
    'applications', 'apply', 'admissions',
    'health', 'security', 'auth',
]);

// Subdomain labels that flag a bulk/marketing infrastructure domain.
const AUTOMATED_SUBDOMAIN_LABELS = new Set([
    'mail', 'mailer', 'mailers', 'mailing', 'mailgun', 'sendgrid', 'mta',
    'email', 'em', 'e', 'm',
    'news', 'newsletter', 'newsletters',
    'marketing', 'mkt', 'promo', 'promos', 'offers',
    'event', 'events', 'ecomm', 'commerce',
    'notifications', 'notification', 'notify', 'alerts', 'alert', 'updates',
    'messaging', 'message', 'msg',
    'noreply', 'donotreply',
    'creators', 'partners', 'team',
    'info', 'welcome', 'hi', 'hello',
    'bounces', 'bounce',
    'reply', 'user', 'usr', 'auto',
]);

// Specific bulk-mail provider domains (substring match on full domain).
const AUTOMATED_DOMAIN_KEYWORDS = [
    'facebookmail', 'kajabimail', 'substack', 'mailgun', 'sendgrid',
    'mcsv.net', 'mailchimp', 'mailerlite', 'createsend', 'cmail',
    'amazonses', 'sparkpost', 'sendinblue', 'brevo',
    'luma-mail', 'lumamail',
    'umusic-online', 'icloud-mail',
];

function localSegments(local: string): string[] {
    return local.toLowerCase().split(/[._\-+]/).filter(Boolean);
}

function isAutomatedAddress(email: string): boolean {
    if (!email) return true;
    const at = email.indexOf('@');
    if (at < 0) return true;
    const local = email.slice(0, at).toLowerCase();
    const domain = email.slice(at + 1).toLowerCase();

    // Plus-aliased reply bots: `reply+abc123@…`
    if (/^reply\+/i.test(local)) return true;

    // Whole-segment local-part matches.
    const segs = localSegments(local);
    for (const s of segs) {
        if (AUTOMATED_LOCAL_PARTS.has(s)) return true;
    }
    // Some senders pack noise into the local part with no separators
    // (e.g. `hdfcbanksmartstatement`). Catch the common ones.
    if (/(no.?reply|do.?not.?reply|notifications?|news.?letter|mailer.?daemon|postmaster|automated|broadcast|statement)/i.test(local)) {
        return true;
    }

    // Random-looking machine local parts: long, mostly hex/base32-ish.
    if (local.length >= 20 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(local) && /[0-9]/.test(local)) {
        const digits = (local.match(/[0-9]/g) || []).length;
        if (digits / local.length >= 0.25) return true;
    }

    // Subdomain-label check (everything except the registrable last two labels).
    const labels = domain.split('.');
    if (labels.length >= 3) {
        const subs = labels.slice(0, -2);
        for (const label of subs) {
            if (AUTOMATED_SUBDOMAIN_LABELS.has(label)) return true;
        }
    }

    // Provider keyword anywhere in the domain.
    for (const kw of AUTOMATED_DOMAIN_KEYWORDS) {
        if (domain.includes(kw)) return true;
    }

    // Domain itself contains tell-tale tokens.
    if (/(^|\.)(mailers?|mailer|mailgun|sendgrid|mailchimp|mailerlite|bounces?|marketing|promo|notifications?|newsletter)(\.|$)/i.test(domain)) {
        return true;
    }

    // Marketing-style TLD / second-level domain (e.g. bookmyshow.email,
    // foo.marketing, bar.news). These domains exist almost exclusively for bulk.
    const sld = labels[labels.length - 1];
    if (['email', 'mail', 'marketing', 'promo', 'news', 'newsletter', 'click', 'link'].includes(sld)) {
        return true;
    }

    // Brand-identity addresses like `uber@uber.com`, `lenovo@lenovo.com` —
    // local part equals the first label of the domain. Almost always a
    // transactional/marketing sender.
    if (labels.length >= 2 && local === labels[0]) {
        return true;
    }

    return false;
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
