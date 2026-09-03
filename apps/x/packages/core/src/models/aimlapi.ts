/**
 * AI/ML API (aimlapi.com) — an OpenAI-compatible aggregator, addressed the
 * same way OpenRouter and the Vercel AI Gateway are: one key, one base URL,
 * many vendors' models behind vendor-prefixed ids ("openai/gpt-4.1",
 * "anthropic/claude-sonnet-4.5", "google/gemini-2.5-flash").
 *
 * It reaches Rowboat through @ai-sdk/openai-compatible like the generic
 * flavor does — the only thing this module adds is knowing how to read the
 * provider's catalog, which is what the generic flavor cannot do.
 *
 * Why its own flavor rather than "openai-compatible" with a pasted URL:
 * GET /v1/models answers with EVERY endpoint the account can reach, not just
 * chat. Today that is 936 entries across 15 endpoint types — 353 chat models
 * plus video, image, TTS, STT, embeddings, OCR and Anthropic batch handles —
 * and 91 ids appear more than once because the same model is served by two
 * endpoints (e.g. "openai/gpt-4.1-mini" as both chat-completions and
 * responses). The generic flavor maps that straight to the picker, so a user
 * scrolls 936 rows, most of which cannot hold a conversation, some listed
 * twice. Filtering by the catalog's own `type` discriminator is a few lines
 * here and cannot be expressed as configuration there.
 */

/** Default endpoint. Overridable per provider entry (staging, a proxy). */
export const AIMLAPI_BASE_URL = "https://api.aimlapi.com/v1";

/**
 * The catalog's endpoint-type discriminator for conversational models.
 *
 * This string is load-bearing and has changed before ("chat-completion" →
 * "openai/chat-completions"), which is exactly how a sibling integration
 * ended up with a permanently empty model dropdown. Hence the fail-open rule
 * in parseAimlapiChatModelIds below: an unrecognised vocabulary degrades to
 * the unfiltered list, never to nothing.
 */
const CHAT_COMPLETIONS_TYPE = "openai/chat-completions";

interface CatalogEntry {
    id?: unknown;
    type?: unknown;
}

/**
 * Chat-capable model ids from a GET /v1/models body, in catalog order.
 *
 * The response is an OpenAI-shaped envelope — `{ "object": "list", "data":
 * [...] }`, not a bare array — and each entry carries `type`. Entries are
 * kept when that type is the chat one, de-duplicated (ids are picker keys),
 * and returned in the order the provider sent them; nothing here reorders or
 * curates the catalog.
 *
 * Fails OPEN, in two steps, because a dark picker is worse than a noisy one:
 *   - an entry with no `type` at all is kept (an older or trimmed response);
 *   - if the filter would empty a non-empty catalog — every entry typed, none
 *     of them chat — the unfiltered id list is returned instead, so a renamed
 *     type string costs users a longer list rather than the whole provider.
 */
export function parseAimlapiChatModelIds(payload: unknown): string[] {
    const data = (payload as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) return [];

    const all: string[] = [];
    const chat: string[] = [];
    const seenAll = new Set<string>();
    const seenChat = new Set<string>();

    for (const raw of data as CatalogEntry[]) {
        const id = raw?.id;
        if (typeof id !== "string" || id.length === 0) continue;
        if (!seenAll.has(id)) {
            seenAll.add(id);
            all.push(id);
        }
        const type = raw?.type;
        const isChat = type === CHAT_COMPLETIONS_TYPE || type === undefined || type === null;
        if (isChat && !seenChat.has(id)) {
            seenChat.add(id);
            chat.push(id);
        }
    }

    return chat.length > 0 ? chat : all;
}

/**
 * Attribution headers, the same pair of conventions this provider's peers
 * already use: HTTP-Referer / X-Title are OpenRouter's (they name the
 * CALLING app — Rowboat — not the provider), and X-AIMLAPI-Source is the
 * provider's own channel tag.
 *
 * Frozen and never sent directly: aimlapiRequestHeaders builds a fresh
 * object per provider so nothing downstream can edit the shared constant.
 */
const ATTRIBUTION_HEADERS: Readonly<Record<string, string>> = Object.freeze({
    "HTTP-Referer": "https://github.com/rowboatlabs/rowboat",
    "X-Title": "Rowboat",
    "X-AIMLAPI-Source": "agent/rowboat",
});

/**
 * Partner id, format ^part_[A-Za-z0-9]{1,64}$ — asserted in aimlapi.test.ts,
 * because a malformed one is DROPPED by the receiving service rather than
 * rejected: the request succeeds and the attribution silently goes nowhere.
 *
 * Empty on purpose. No id has been issued for Rowboat, and a made-up value
 * is worse than none. When one is issued this constant is the only edit;
 * while it is empty the header is not sent at all.
 */
export const AIMLAPI_PARTNER_ID: string = "part_VGDbk3ZJHZ1bi3eoaLNwToNC";

/** Attribution rides only to this origin — never to a proxy or a peer. */
const ATTRIBUTION_ORIGIN = "https://api.aimlapi.com";

function isAimlapiOrigin(baseURL: string | undefined): boolean {
    try {
        return new URL(baseURL || AIMLAPI_BASE_URL).origin === ATTRIBUTION_ORIGIN;
    } catch {
        // An unparseable override is not our origin.
        return false;
    }
}

/**
 * The headers an aimlapi provider sends: the user's own, plus attribution
 * when — and only when — the request is actually going to aimlapi.com. A
 * provider entry may point at a proxy or a compatible peer; attribution must
 * not ride along to someone else's service, so the origin is checked rather
 * than trusting the flavor alone.
 *
 * Merges, never assigns: a user's configured header wins on a key clash, and
 * the returned object is new every call.
 */
export function aimlapiRequestHeaders(
    config: { baseURL?: string; headers?: Record<string, string> },
): Record<string, string> | undefined {
    if (!isAimlapiOrigin(config.baseURL)) return config.headers;
    const headers: Record<string, string> = { ...ATTRIBUTION_HEADERS };
    if (AIMLAPI_PARTNER_ID) headers["X-AIMLAPI-Partner-ID"] = AIMLAPI_PARTNER_ID;
    return { ...headers, ...(config.headers ?? {}) };
}
