// Link validation for RichMarkdownViewer when a link handler is mounted.
//
// TipTap's default isAllowedUri rejects any href whose first segment is
// followed by '/', '.', or ':' unless the scheme is allowlisted — which drops
// the link mark entirely for space-relative paths like `decisions/sso.md` and
// for app:// blob links. This validator keeps the default (so javascript:,
// data:, etc. stay blocked), and additionally accepts app:// URLs and
// scheme-less relative hrefs.

/** Whitespace a browser strips from URLs — remove before scheme sniffing, or `java\nscript:` slips through as "relative". */
// eslint-disable-next-line no-control-regex
const URL_WHITESPACE_RE = /[\u0000-\u0020\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]+/g

export function allowRelativeAndAppHrefs(url: string, ctx: { defaultValidate: (url: string) => boolean }): boolean {
    if (ctx.defaultValidate(url)) return true
    const cleaned = url.replace(URL_WHITESPACE_RE, '')
    if (/^app:\/\//i.test(cleaned)) return true
    // No scheme and not protocol-relative → a relative path, safe to render.
    return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(cleaned) && !cleaned.startsWith('//')
}
