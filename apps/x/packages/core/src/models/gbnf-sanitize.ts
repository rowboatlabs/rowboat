// GBNF-safe JSON Schema sanitization for llama.cpp-backed OpenAI-compatible
// servers (LM Studio, llama-server, ...).
//
// When a chat request carries tool definitions (or a json_schema
// response_format), llama.cpp compiles each `pattern` regex in the schema into
// a GBNF grammar so it can constrain decoding. GBNF understands ordinary regex
// syntax — literals, `[a-z]` classes, `(a|b)`, `*`/`+`/`?`/`{n,m}` — but NOT the
// PCRE shorthand classes (`\d \w \s` and their negations) or word boundaries
// (`\b \B`). It aborts grammar compilation with `parse: error parsing grammar:
// unknown escape at \d`, and because the sampler init fails, the WHOLE request
// dies with HTTP 400 ("Failed to initialize samplers: failed to parse grammar")
// — one offending field takes down the entire session.
//
// This is a long-standing, still-open llama.cpp limitation (see llama.cpp
// #16714 and #22314), so it can't be fixed by updating the runtime. Rowboat's
// own tools legitimately use shorthands (e.g. the `HH:MM` window times validate
// with `^([01]\d|2[0-3]):[0-5]\d$`), and any third-party schema might too, so we
// rewrite the outgoing wire request instead: translate every shorthand into an
// equivalent GBNF-safe character class before it reaches the backend.
//
// Only the `openai-compatible` provider wires this in (see models.ts) — the
// hosted providers (OpenAI, Anthropic, Google) accept these patterns fine, and
// leaving their payloads byte-identical keeps prompt caching intact.

// Shorthand -> replacement when the shorthand appears OUTSIDE a character class.
// The replacement is a self-contained class so it can stand alone in the regex.
const SHORTHAND_OUTSIDE_CLASS: Record<string, string> = {
    d: "[0-9]",
    D: "[^0-9]",
    w: "[A-Za-z0-9_]",
    W: "[^A-Za-z0-9_]",
    s: "[ \\t\\n\\r]",
    S: "[^ \\t\\n\\r]",
};

// Shorthand -> replacement when the shorthand appears INSIDE a character class
// (e.g. `[\d.]`). Here the replacement must be bare class members, with no
// brackets. Negated shorthands (`\D \W \S`) have no in-class equivalent —
// negation can't be nested inside `[...]` — so they map to `null`, which forces
// us to drop the whole pattern rather than emit broken grammar.
const SHORTHAND_INSIDE_CLASS: Record<string, string | null> = {
    d: "0-9",
    D: null,
    w: "A-Za-z0-9_",
    W: null,
    s: " \\t\\n\\r",
    S: null,
};

/**
 * Rewrite the PCRE shorthand classes in a regex `pattern` into GBNF-safe
 * character classes.
 *
 * Returns the translated pattern, or `null` when the pattern contains something
 * that cannot be safely expressed in GBNF (a `\b`/`\B` word boundary, a negated
 * shorthand inside a character class, or an unbalanced class). A `null` result
 * means "drop this pattern entirely" — omitting a validation constraint is
 * strictly safer than shipping a grammar that fails the whole request.
 *
 * The scan is character-class aware so `\d` becomes `[0-9]` on its own but
 * `0-9` inside `[...]`. Escapes GBNF already understands (`\n \t \\ \" \xNN` …)
 * are passed through untouched.
 */
export function translatePcreShorthands(pattern: string): string | null {
    let out = "";
    let inClass = false;

    for (let i = 0; i < pattern.length; i++) {
        const ch = pattern[i];

        if (ch === "\\") {
            const next = pattern[i + 1];
            if (next === undefined) {
                // Trailing backslash: malformed. Leave it verbatim; the backend
                // would reject such a pattern regardless of shorthands.
                out += ch;
                break;
            }
            // Word boundaries have no GBNF equivalent, in or out of a class.
            if (next === "b" || next === "B") {
                return null;
            }
            const table = inClass ? SHORTHAND_INSIDE_CLASS : SHORTHAND_OUTSIDE_CLASS;
            if (Object.prototype.hasOwnProperty.call(table, next)) {
                const replacement = table[next];
                if (replacement === null) {
                    // e.g. `\D` inside `[...]` — untranslatable, drop the pattern.
                    return null;
                }
                out += replacement;
            } else {
                // Any other escape (`\. \n \t \\ \" \/ \xNN` …) — GBNF handles
                // these, so keep the escape as-is.
                out += ch + next;
            }
            i++; // consumed the escaped character
            continue;
        }

        if (ch === "[" && !inClass) {
            inClass = true;
        } else if (ch === "]" && inClass) {
            inClass = false;
        }
        out += ch;
    }

    if (inClass) {
        // Unbalanced character class — we can't reason about member escapes
        // safely, so drop the pattern rather than risk broken grammar.
        return null;
    }
    return out;
}

/**
 * Walk an arbitrary JSON value (a parsed JSON Schema or any nesting of tool
 * definitions) and sanitize every string `pattern` in place. Translatable
 * shorthands are rewritten; untranslatable patterns have their `pattern` key
 * deleted. Returns the number of patterns changed or removed.
 *
 * Mutates `node` in place — callers that must not alter the input should pass a
 * clone (a freshly `JSON.parse`d wire body is already safe to mutate).
 *
 * A key literally named `pattern` whose value is NOT a string (e.g. a tool
 * input field that happens to be called "pattern") is left alone and recursed
 * into normally, so only real JSON-Schema `pattern` constraints are touched.
 */
export function sanitizePatternsInPlace(node: unknown): number {
    if (Array.isArray(node)) {
        let changes = 0;
        for (const item of node) changes += sanitizePatternsInPlace(item);
        return changes;
    }
    if (node === null || typeof node !== "object") {
        return 0;
    }

    const obj = node as Record<string, unknown>;
    let changes = 0;
    for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (key === "pattern" && typeof value === "string") {
            const translated = translatePcreShorthands(value);
            if (translated === null) {
                delete obj[key];
                changes++;
            } else if (translated !== value) {
                obj[key] = translated;
                changes++;
            }
            continue;
        }
        changes += sanitizePatternsInPlace(value);
    }
    return changes;
}

/**
 * Sanitize a serialized `/chat/completions` request body: rewrite any GBNF-
 * hostile `pattern` inside `tools` (tool-call schemas) and `response_format`
 * (structured-output schemas). Returns the original string untouched when the
 * body isn't JSON, carries no schema, or needs no changes — so non-chat
 * requests (embeddings, model listing, …) and clean bodies pass through
 * byte-for-byte.
 */
export function sanitizeChatCompletionsBody(body: string): string {
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        return body;
    }
    if (parsed === null || typeof parsed !== "object") {
        return body;
    }

    const obj = parsed as Record<string, unknown>;
    let changes = 0;
    if (Array.isArray(obj.tools)) {
        changes += sanitizePatternsInPlace(obj.tools);
    }
    if (obj.response_format !== undefined) {
        changes += sanitizePatternsInPlace(obj.response_format);
    }
    return changes > 0 ? JSON.stringify(parsed) : body;
}

/**
 * Wrap a `fetch` so every outgoing request with a string body has its tool /
 * response_format schemas made GBNF-safe (see sanitizeChatCompletionsBody).
 * Bodies without schemas are forwarded unchanged. This is the seam the
 * openai-compatible provider uses so llama.cpp-backed servers don't 400 on
 * shorthand-bearing patterns.
 */
export function makeGbnfSafeFetch(baseFetch: typeof fetch = fetch): typeof fetch {
    return async (input, init) => {
        const body = init?.body;
        if (typeof body === "string" && body.length > 0) {
            const sanitized = sanitizeChatCompletionsBody(body);
            if (sanitized !== body) {
                return baseFetch(input, { ...init, body: sanitized });
            }
        }
        return baseFetch(input, init);
    };
}
