// The app in French (decided 01/10/2026). The upstream renderer writes its
// interface in English and changes about sixty times a week, so it is never
// edited (docs/baarali/UPSTREAM.md §2): this layer, loaded by one line that
// scripts/brand.mjs adds at build, translates what the interface shows, from
// a dictionary we keep (fr.ts), and only that.
//
// Whole strings only: a text node or a visible attribute is translated when
// its whole text is a key, or matches a template (`$1 files`), so nothing is
// half translated. What a person typed or received (a message, a note, an
// email, an editor) is never touched: those places are skipped altogether.
// A string the dictionary lacks stays English, never broken, and
// `node scripts/i18n-extract.mjs --check` fails the build until it is added.

export type Lang = 'fr' | 'en';

export interface Dictionary {
  /** Exact English text → French. */
  exact: Record<string, string>;
  /**
   * Text with a value in it, as the code writes it: `$1 files` → `$1 fichiers`.
   * Each value is translated in turn when it is itself a known string.
   */
  templates: Record<string, string>;
  /**
   * Lines about people (`$1 joined`), where every value is a name and stays
   * as written. Short and loose, they apply only inside an element marked
   * PEOPLE (scripts/brand.mjs marks them), never on a title or a count.
   */
  people?: Record<string, string>;
}

/** The elements whose text is a line about people: see `Dictionary.people`. */
export const PEOPLE = '[data-baarali-people]';

/** Where people's own content is shown or typed: never translated. */
export const CONTENT = [
  // style and script hold code, not words: translating them would break the screen.
  'style', 'script', 'noscript',
  '[contenteditable]', '.ProseMirror', '.tiptap-editor', '.cm-editor', '.xterm', '.excalidraw',
  'pre', 'code', 'textarea', '.prose', '[data-streamdown]', '.is-user', '[class*="gmail-message"]', '[data-no-translate]',
].join(',');

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

/** The language: the one chosen in the app, else the system's. */
export function pickLang(saved: string | null, system: string | undefined): Lang {
  if (saved === 'fr' || saved === 'en') return saved;
  return (system ?? '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

interface Template {
  re: RegExp;
  fr: string;
  /** Fewer than two words around the values (`Open $1`): see `allowed`. */
  loose: boolean;
}

const compiled = new WeakMap<Dictionary, Template[]>();

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `Open $1` → /^Open (.+?)$/, most specific templates first. */
export function compile(dict: Dictionary): Template[] {
  let out = compiled.get(dict);
  if (out) return out;
  out = Object.entries(dict.templates)
    .map(([en, fr]) => {
      const words = en.replace(/\$\d+/g, ' ').split(/\s+/).filter((w) => /[A-Za-z]{2}/.test(w));
      const source = en.split(/(\$\d+)/).map((part) => (/^\$\d+$/.test(part) ? '(.*?)' : escape(part))).join('');
      return { re: new RegExp(`^${source}$`, 's'), fr, loose: words.length < 2, weight: en.replace(/\$\d+/g, '').length };
    })
    .sort((a, b) => b.weight - a.weight)
    .map(({ re, fr, loose }) => ({ re, fr, loose }));
  compiled.set(dict, out);
  return out;
}

/** Where the text sits, which decides whether a loose template may apply. */
export type Place = 'attr' | 'text' | 'control';

/**
 * A loose template (`Open $1`, `$1 files`) could match a title a person gave
 * (a note called « Open questions »), so it applies only where the interface
 * speaks: an attribute, a button or a notification, or when its values are
 * numbers.
 */
function allowed(t: Template, values: string[], place: Place): boolean {
  if (!t.loose || place === 'attr') return true;
  if (values.every((v) => /^[\d\s.,:+\-–/%]*$/.test(v))) return true;
  // On a button, a name (`Connect OpenAI`), never a phrase (`Add your first to-do`).
  return place === 'control' && values.every((v) => !/\s/.test(v.trim()));
}

/**
 * Two values side by side split anywhere (`Awa, including you`): the English
 * the code appended is a known ending, after a comma or an opening bracket.
 */
function tail(dict: Dictionary, value: string): string {
  const m = /^(.*?)([,(]\s*)([A-Za-z][^,(]*)$/s.exec(value);
  const fr = m ? dict.exact[m[3].trim()] : undefined;
  return m && fr ? m[1] + m[2] + fr : value;
}

const compiledPeople = new WeakMap<Dictionary, Template[]>();

/** The French of a line about people, its names kept as written; null when none matches. */
export function aboutPeople(dict: Dictionary, text: string): string | null {
  let list = compiledPeople.get(dict);
  if (!list) {
    list = compile({ exact: {}, templates: dict.people ?? {} });
    compiledPeople.set(dict, list);
  }
  const core = text.trim();
  for (const t of list) {
    const m = t.re.exec(core);
    if (!m) continue;
    const out = t.fr.replace(/\$(\d+)/g, (_, i) => m[Number(i)] ?? '');
    const at = text.indexOf(core);
    return text.slice(0, at) + out + text.slice(at + core.length);
  }
  return null;
}

/** Strings already looked at, so each is matched against the templates once. */
const seen = new Map<string, string | null>();

/** The French for one string, or null when there is none. */
export function translate(dict: Dictionary, text: string, place: Place = 'text', depth = 0): string | null {
  const core = text.trim();
  if (!core || !/[A-Za-z]/.test(core)) return null;
  // The build names the product Baarali (scripts/brand.mjs); a text it missed still matches.
  let out: string | null = dict.exact[core] ?? dict.exact[core.replace(/\bRowboat\b/g, 'Baarali')] ?? null;
  const key = `${place}\u0000${core}`;
  if (out === null && seen.has(key)) out = seen.get(key) ?? null;
  else if (out === null) {
    for (const t of compile(dict)) {
      const m = t.re.exec(core);
      if (!m) continue;
      const values = m.slice(1);
      if (!allowed(t, values, place)) continue;
      // A value can itself be English the code wrote (`, including you`).
      const inner = values.map((v) => (depth < 2 && /[A-Za-z]{2}/.test(v) ? translate(dict, v, 'attr', depth + 1) ?? tail(dict, v) : v));
      out = t.fr.replace(/\$(\d+)/g, (_, i) => inner[Number(i) - 1] ?? '');
      break;
    }
    if (seen.size > 5000) seen.clear();
    seen.set(key, out);
  }
  if (out === null) return null;
  // Keep the spaces around the text: JSX often splits a sentence there.
  const at = text.indexOf(core);
  return text.slice(0, at) + out + text.slice(at + core.length);
}

const CONTROLS = 'button, [role="button"], [role="menuitem"], [role="tab"], label, [data-sonner-toast]';

function skip(el: Element | null): boolean {
  return !!el?.closest(CONTENT);
}

function translateAttrs(dict: Dictionary, el: Element): void {
  for (const name of ATTRS) {
    const v = el.getAttribute(name);
    if (v) {
      const fr = translate(dict, v, 'attr');
      if (fr !== null && fr !== v) el.setAttribute(name, fr);
    }
  }
}

/**
 * A piece of a sentence (`and`, `Add`) is translated only when the rest of
 * the sentence is the interface's too: next to words the dictionary does not
 * know (an app's description, a to-do someone wrote), it stays as written,
 * so nothing reads « two colors et a mix ».
 */
/** Text nodes this layer wrote: French already, never strangers. */
const translated = new WeakSet<Node>();

function amongStrangers(dict: Dictionary, node: Node, place: Place): boolean {
  const parent = node.parentElement;
  if (!parent) return false;
  for (const sibling of Array.from(parent.childNodes)) {
    if (sibling === node || sibling.nodeType !== Node.TEXT_NODE) continue;
    const text = sibling.nodeValue ?? '';
    // A phrase (three words or more), not a value like a name or an address.
    const words = text.split(/\s+/).filter((w) => /[A-Za-z]{2}/.test(w)).length;
    if (words >= 3 && !translated.has(sibling) && translate(dict, text, place) === null) return true;
  }
  return false;
}

function translateNode(dict: Dictionary, node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    if (skip(parent)) return;
    const people = parent?.closest(PEOPLE) ? aboutPeople(dict, node.nodeValue ?? '') : null;
    if (people === null && amongStrangers(dict, node, 'text')) return;
    const fr = people ?? translate(dict, node.nodeValue ?? '', parent?.closest(CONTROLS) ? 'control' : 'text');
    if (fr !== null && fr !== node.nodeValue) {
      node.nodeValue = fr;
      translated.add(node);
    }
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  // A field's own hint (placeholder, label) is the interface's, even where its content is not.
  if (!skip(el.parentElement)) translateAttrs(dict, el);
  if (skip(el)) return;
  for (const child of Array.from(el.childNodes)) translateNode(dict, child);
}

/**
 * Dates and times in French. Some screens ask for 'en-US' outright
 * ("Oct 2, 3:45 PM"); in French every request for English, or for the
 * default, gets French instead ("2 oct., 15:45").
 */
export function frenchDates(locale = 'fr-FR'): void {
  const swap = (l: unknown) => (l === undefined || l === 'en-US' || l === 'en' || (Array.isArray(l) && (l.length === 0 || l[0] === 'en-US')) ? locale : l);
  const date = Date.prototype;
  for (const name of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'] as const) {
    const original = date[name];
    date[name] = function (this: Date, l?: unknown, options?: Intl.DateTimeFormatOptions) {
      return original.call(this, swap(l) as string, options);
    } as (typeof date)[typeof name];
  }
  const Native = Intl.DateTimeFormat;
  const Patched = function (this: unknown, l?: unknown, options?: Intl.DateTimeFormatOptions) {
    return new Native(swap(l) as string, options);
  } as unknown as typeof Intl.DateTimeFormat;
  Object.defineProperty(Patched, 'supportedLocalesOf', { value: Native.supportedLocalesOf.bind(Native) });
  Object.defineProperty(Patched, 'prototype', { value: Native.prototype });
  Intl.DateTimeFormat = Patched;
}

/**
 * Translates the page now and whatever it shows next. React keeps writing
 * English into the nodes it owns; each write comes back here and is
 * translated again, so the person never sees the English for more than a
 * frame.
 */
export function startTranslation(dict: Dictionary, root: Element = document.body): MutationObserver {
  translateNode(dict, root);
  const title = translate(dict, document.title, 'attr');
  if (title) document.title = title;
  const observer = new MutationObserver((records) => {
    // One bad node leaves that node in English, never the rest of the screen.
    for (const r of records) {
      try {
        if (r.type === 'characterData') translateNode(dict, r.target);
        else if (r.type === 'attributes') {
          if (!skip((r.target as Element).parentElement)) translateAttrs(dict, r.target as Element);
        }
        else for (const n of Array.from(r.addedNodes)) translateNode(dict, n);
      } catch {
        // Stays English.
      }
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  return observer;
}
