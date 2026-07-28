import { getGithubToken } from './github-auth.js';

// GitHub stars for catalog apps. Star counts rank the catalog; starring an
// app stars its repo (the device-flow token's public_repo scope covers it).
// Counts are fetched per-repo with a short cache — unauthenticated GitHub API
// allows 60 req/h, so the cache is what keeps a busy catalog usable when the
// user never signed in.

const COUNT_TTL_MS = 10 * 60 * 1000;
const countCache = new Map<string, { stars: number; at: number }>();

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// Once GitHub says the hourly budget is spent (403/429 with
// x-ratelimit-remaining: 0), every further request until the reset is a
// guaranteed 403 — and the catalog re-requests counts on load and on every
// search keystroke. Gate all fetches until the advertised reset instead of
// burning requests on failures.
let rateLimitedUntilMs = 0;

const isRateLimited = () => Date.now() < rateLimitedUntilMs;

function noteRateLimit(res: Response): void {
    if (res.status !== 403 && res.status !== 429) return;
    const remaining = res.headers.get('x-ratelimit-remaining');
    const resetSec = Number(res.headers.get('x-ratelimit-reset'));
    if (remaining === '0' && Number.isFinite(resetSec) && resetSec > 0) {
        rateLimitedUntilMs = Math.max(rateLimitedUntilMs, resetSec * 1000);
    } else {
        // Secondary rate limit / abuse detection — headers don't say when it
        // ends, so back off a few minutes.
        rateLimitedUntilMs = Math.max(rateLimitedUntilMs, Date.now() + 5 * 60 * 1000);
    }
}

async function ghHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'rowboat-apps',
    };
    const auth = await getGithubToken();
    if (auth) headers['Authorization'] = `Bearer ${auth.token}`;
    return headers;
}

/** Star counts for a set of "owner/repo" strings. Unknown/unreachable repos are omitted. */
export async function repoStars(repos: string[]): Promise<Record<string, number>> {
    const headers = await ghHeaders();
    const now = Date.now();
    const limited = isRateLimited();
    const out: Record<string, number> = {};
    await Promise.all([...new Set(repos)].filter((r) => REPO_RE.test(r)).map(async (repo) => {
        const cached = countCache.get(repo);
        // While rate-limited, a stale count beats a guaranteed 403.
        if (cached && (limited || now - cached.at < COUNT_TTL_MS)) {
            out[repo] = cached.stars;
            return;
        }
        if (limited) return;
        try {
            const res = await fetch(`https://api.github.com/repos/${repo}`, { headers });
            if (!res.ok) { noteRateLimit(res); return; } // deleted repo / rate limited — no count is fine
            const body = await res.json() as { stargazers_count?: number };
            if (typeof body.stargazers_count === 'number') {
                countCache.set(repo, { stars: body.stargazers_count, at: now });
                out[repo] = body.stargazers_count;
            }
        } catch { /* offline — no count */ }
    }));
    return out;
}

/** Which of these repos the signed-in user has starred. Empty when signed out. */
export async function starredStatus(repos: string[]): Promise<Record<string, boolean>> {
    const auth = await getGithubToken();
    if (!auth || isRateLimited()) return {};
    const headers = await ghHeaders();
    const out: Record<string, boolean> = {};
    await Promise.all([...new Set(repos)].filter((r) => REPO_RE.test(r)).map(async (repo) => {
        try {
            const res = await fetch(`https://api.github.com/user/starred/${repo}`, { headers });
            if (res.status === 204) out[repo] = true;
            else if (res.status === 404) out[repo] = false;
            else noteRateLimit(res);
            // other statuses (401 revoked token, 403 rate limit) → unknown, omit
        } catch { /* offline — unknown */ }
    }));
    return out;
}

/** Star/unstar a repo as the signed-in user. Throws not_signed_in without a token. */
export async function setStar(repo: string, star: boolean): Promise<{ starred: boolean }> {
    if (!REPO_RE.test(repo)) throw new Error(`invalid repo: ${repo}`);
    const auth = await getGithubToken();
    if (!auth) throw new Error('not_signed_in: sign in with GitHub (used for publishing) to star apps');
    const res = await fetch(`https://api.github.com/user/starred/${repo}`, {
        method: star ? 'PUT' : 'DELETE',
        headers: { ...(await ghHeaders()), 'Content-Length': '0' },
    });
    if (res.status !== 204) {
        noteRateLimit(res);
        throw new Error(`star_failed: HTTP ${res.status} ${await res.text().catch(() => '')}`.trim());
    }
    // Nudge the cached count so the UI reflects the action before the TTL expires.
    const cached = countCache.get(repo);
    if (cached) countCache.set(repo, { stars: Math.max(0, cached.stars + (star ? 1 : -1)), at: cached.at });
    return { starred: star };
}
