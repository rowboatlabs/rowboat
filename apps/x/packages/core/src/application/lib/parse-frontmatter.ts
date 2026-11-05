import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/**
 * Parse the YAML frontmatter from the input string. Trims the body — handy
 * when you only care about the frontmatter or treat the body as opaque
 * markdown (e.g. agent instructions). Use {@link splitFrontmatter} when you
 * need to round-trip the body byte-for-byte.
 */
export function parseFrontmatter(input: string): {
    frontmatter: unknown | null;
    content: string;
} {
    if (input.startsWith("---")) {
        const end = input.indexOf("\n---", 3);

        if (end !== -1) {
            const fm = input.slice(3, end).trim();       // YAML text
            return {
                frontmatter: parseYaml(fm),
                content: input.slice(end + 4).trim(),
            };
        }
    }
    return {
        frontmatter: null,
        content: input,
    };
}

/**
 * Split a file's frontmatter from its body without trimming or reformatting
 * the body. Used by callers that round-trip the file (read → mutate
 * frontmatter → re-emit) — preserving body bytes prevents whitespace drift
 * across writes. Pair with {@link joinFrontmatter} on the way out.
 *
 * - `frontmatter` is always an object (empty `{}` if absent or not a map).
 * - `body` is the rest of the file verbatim, including any leading/trailing
 *   whitespace.
 */
export function splitFrontmatter(content: string): {
    frontmatter: Record<string, unknown>;
    body: string;
} {
    if (!content.startsWith('---')) {
        return { frontmatter: {}, body: content };
    }
    const close = /\r?\n---(?:\r?\n|$)/.exec(content);
    if (!close) {
        return { frontmatter: {}, body: content };
    }
    const yamlText = content.slice(3, close.index).trim();
    const body = content.slice(close.index + close[0].length);
    let parsed: unknown = {};
    if (yamlText) {
        try {
            parsed = parseYaml(yamlText);
        } catch {
            return { frontmatter: {}, body: content };
        }
    }
    const frontmatter = (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        ? parsed as Record<string, unknown>
        : {};
    return { frontmatter, body };
}

/**
 * Re-emit a file with the given frontmatter object and body. If the
 * frontmatter object is empty, no `---` fence is written — the file is body
 * only. Pairs with {@link splitFrontmatter}.
 */
export function joinFrontmatter(
    frontmatter: Record<string, unknown>,
    body: string,
): string {
    if (Object.keys(frontmatter).length === 0) return body;
    const yamlText = stringifyYaml(frontmatter).replace(/\n$/, '');
    return `---\n${yamlText}\n---\n${body}`;
}
