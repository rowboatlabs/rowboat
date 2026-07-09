/**
 * Quoted-reply detection for rendered email bodies.
 *
 * Quoted chains come in two shapes, and the difference decides how they hide:
 *
 *  - Wrapper quotes (Gmail, Apple Mail, Yahoo, Proton): a single element
 *    contains the whole quoted chain, so hiding that element is enough.
 *  - Boundary quotes (Outlook, Thunderbird): a divider element holds only the
 *    "From:/Sent:/Subject:" header and the quoted chain trails it as siblings,
 *    so everything from the divider onward has to be hidden.
 *
 * Treating the second kind as the first is why Outlook threads used to render
 * their entire history inline with no toggle to collapse it.
 */

/** Marks nodes the iframe stylesheet hides until quotes are toggled on. */
export const QUOTED_CLASS = 'rb-quoted'

const WRAPPER_QUOTE_SELECTOR = [
  '.gmail_quote',
  '.gmail_attr',
  'blockquote[type="cite"]',
  '.yahoo_quoted',
  '.protonmail_quote',
].join(', ')

const BOUNDARY_QUOTE_SELECTOR = [
  '#divRplyFwdMsg', // Outlook on the web / "new Outlook"
  '#appendonsend', // Outlook, an empty marker sitting before the quoted chain
  '.moz-cite-prefix', // Thunderbird
].join(', ')

// Outlook desktop draws the divider as an inline-styled <div>. The colour is
// the only stable part of the rule — padding units vary (0in vs 0cm), casing
// varies (#E1E1E1 vs #e1e1e1), and `border:none` may or may not precede it.
const OUTLOOK_DIVIDER_STYLE = /border-top\s*:\s*solid\s*#?e1e1e1/i

const HEADER_SCAN_CHARS = 800

function hasQuotedHeaderBlock(text: string): boolean {
  const head = text.slice(0, HEADER_SCAN_CHARS)
  return /\bFrom:/i.test(head) && /\b(Sent|Date):/i.test(head) && /\bSubject:/i.test(head)
}

// A bare border-top div is also how plenty of signatures and marketing footers
// draw a horizontal rule, so require the header block before calling it a
// quote boundary. Wrongly hiding someone's signature is worse than wrongly
// showing a quote.
function isOutlookDivider(el: Element): boolean {
  if (!OUTLOOK_DIVIDER_STYLE.test(el.getAttribute('style') || '')) return false
  return hasQuotedHeaderBlock(el.textContent || '')
}

// Hide the divider plus everything after it. The quoted chain can sit outside
// the divider's parent, so climb to the body marking later siblings at each
// level. Quoted history always terminates the message, so nothing below the
// boundary is content worth keeping.
function markFromBoundary(el: Element, body: Element): void {
  el.classList.add(QUOTED_CLASS)
  let node: Element | null = el
  while (node && node !== body) {
    for (let sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) {
      sib.classList.add(QUOTED_CLASS)
    }
    node = node.parentElement
  }
}

/** Tags quoted nodes with {@link QUOTED_CLASS}. Returns true if any were found. */
export function markQuotedNodes(doc: Document): boolean {
  const body = doc.body
  if (!body) return false
  let found = false

  for (const el of Array.from(body.querySelectorAll(WRAPPER_QUOTE_SELECTOR))) {
    el.classList.add(QUOTED_CLASS)
    found = true
  }

  const boundaries = Array.from(body.querySelectorAll(BOUNDARY_QUOTE_SELECTOR))
  for (const el of Array.from(body.querySelectorAll('div[style]'))) {
    if (isOutlookDivider(el)) boundaries.push(el)
  }
  for (const el of boundaries) {
    // Already inside a quote we hid, or reached by an earlier boundary's sweep.
    if (el.closest(`.${QUOTED_CLASS}`)) continue
    markFromBoundary(el, body)
    found = true
  }

  return found
}

// True if the HTML — ignoring quoted content — defines its own visual layout
// (real images, tables, explicit backgrounds). Unstyled HTML (Gmail replies,
// Outlook one-liners wrapped in MsoNormal boilerplate, outreach emails with
// only a tracking pixel) gets an iframe that adapts to the app theme; styled
// HTML keeps the white "paper" look so newsletters render as sent.
function isStyledDocument(doc: Document): boolean {
  const clone = doc.cloneNode(true) as Document
  clone.querySelectorAll(`.${QUOTED_CLASS}`).forEach((n) => n.remove())
  if (clone.querySelector('table')) return true
  for (const img of Array.from(clone.querySelectorAll('img'))) {
    const w = parseInt(img.getAttribute('width') || '0', 10)
    const h = parseInt(img.getAttribute('height') || '0', 10)
    if (w === 1 && h === 1) continue
    const style = img.getAttribute('style') || ''
    if (/display\s*:\s*none/i.test(style)) continue
    if (/visibility\s*:\s*hidden/i.test(style)) continue
    return true
  }
  const visible = clone.body?.innerHTML || ''
  if (/bgcolor\s*=/i.test(visible)) return true
  if (/background-(color|image)\s*:/i.test(visible)) return true
  return false
}

export interface PreparedEmail {
  /** Body HTML with quoted nodes tagged, ready to embed in the iframe. */
  html: string
  hasQuote: boolean
  styled: boolean
}

// A forward is quoted content all the way down: hiding it leaves a blank body
// behind a "•••" nobody knows to press. When nothing survives, show everything
// and drop the toggle. Real replies clear this easily — the shortest in a
// 558-message sample left 13 visible characters, forwards left zero.
function unmarkIfNothingRemains(doc: Document): boolean {
  const clone = doc.cloneNode(true) as Document
  clone.querySelectorAll(`.${QUOTED_CLASS}`).forEach((n) => n.remove())
  const visible = (clone.body?.textContent || '').replace(/[\s\u00a0]+/g, '')
  if (visible.length > 0) return true
  doc.querySelectorAll(`.${QUOTED_CLASS}`).forEach((n) => n.classList.remove(QUOTED_CLASS))
  return false
}

/**
 * Parse once, tag the quotes, and decide the styling — so the iframe hides
 * quoted history on its first paint and reports the right height immediately.
 */
export function prepareEmailHtml(rawHtml: string): PreparedEmail {
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html')
  const hasQuote = markQuotedNodes(doc) && unmarkIfNothingRemains(doc)
  const styled = isStyledDocument(doc)
  // Emails ship <style> blocks that the parser hoists into <head>. Only the
  // body gets re-embedded downstream, so carry the head along with it — a
  // <style> is just as valid inside <body>.
  const html = (doc.head?.innerHTML || '') + (doc.body?.innerHTML || '')
  return { html, hasQuote, styled }
}

export function isReplyQuoteBoundary(lines: string[], index: number): boolean {
  const line = lines[index]?.trim() || ''
  if (/^On\b.+\bwrote:\s*$/i.test(line)) return true
  if (/^-{2,}\s*(Original Message|Forwarded message)\s*-{2,}$/i.test(line)) return true
  if (/^From:\s+\S/i.test(line)) {
    const next = lines.slice(index + 1, index + 6).map((value) => value.trim())
    return next.some((value) => /^(Sent|Date):\s+\S/i.test(value))
      && next.some((value) => /^To:\s+\S/i.test(value))
      && next.some((value) => /^Subject:\s+\S/i.test(value))
  }
  return false
}

function quoteBoundaryIndex(lines: string[]): number {
  return lines.findIndex((line, index) => {
    if (isReplyQuoteBoundary(lines, index)) return true
    return index > 0
      && line.trim().startsWith('>')
      && (lines[index - 1]?.trim() === '' || lines[index - 1]!.trim().startsWith('>'))
  })
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/**
 * Split a plain-text body into the new content and the quoted tail. Recognises
 * every boundary {@link isReplyQuoteBoundary} does, not just "On … wrote:".
 */
export function splitPlainTextQuote(text: string): { visible: string; quoted: string | null } {
  const lines = normalizeNewlines(text).split('\n')
  const boundary = quoteBoundaryIndex(lines)
  if (boundary < 0) return { visible: text, quoted: null }
  const quoted = lines.slice(boundary).join('\n')
  if (!quoted.trim()) return { visible: text, quoted: null }
  return { visible: lines.slice(0, boundary).join('\n').trimEnd(), quoted }
}

/** Drop the quoted tail entirely — used when seeding the composer from a draft. */
export function stripQuotedReplyText(text: string): string {
  const lines = normalizeNewlines(text).split('\n')
  const boundary = quoteBoundaryIndex(lines)
  const visible = boundary >= 0 ? lines.slice(0, boundary) : lines
  return visible.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
