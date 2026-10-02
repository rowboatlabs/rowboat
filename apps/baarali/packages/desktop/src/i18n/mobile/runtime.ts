// What babel-plugin.cjs calls in the mobile app's screens: a string in the
// person's language, from the desktop's dictionary (fr.ts). French when the
// phone is in French. Whatever goes wrong, the English the upstream wrote is
// shown, never nothing.
import { FR } from '../fr.js';
import { frenchDates, pickLang, translate } from '../translate.js';

let lang: 'fr' | 'en' = 'en';
try {
  lang = pickLang(null, Intl.DateTimeFormat().resolvedOptions().locale);
  if (lang === 'fr') frenchDates();
} catch {
  // No Intl: English.
}

/** Overrides the phone's language (tests, a future setting). */
export function setLanguage(next: 'fr' | 'en'): void {
  lang = next;
}

const fill = (template: string, values: string[]) => template.replace(/\$(\d+)/g, (_, i) => values[Number(i) - 1] ?? '');

export function __baaraliT(key: string, values?: unknown[]): string {
  const raw = (values ?? []).map((v) => (v === null || v === undefined ? '' : String(v)));
  if (lang !== 'fr') return fill(key, raw);
  try {
    const fr = values ? FR.templates[key] : FR.exact[key];
    if (fr === undefined) return fill(key, raw);
    // A value can itself be English the code wrote (`, including you`).
    return fill(fr, raw.map((v) => (/[A-Za-z]{2}/.test(v) ? translate(FR, v, 'attr') ?? v : v)));
  } catch {
    return fill(key, raw);
  }
}
