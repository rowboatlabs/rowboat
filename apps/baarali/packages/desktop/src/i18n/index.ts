// Loaded first by the renderer's entry (one line added by scripts/brand.mjs):
// the app in the person's language. French when the app or the system says so.
import { FR } from './fr.js';
import { frenchDates, pickLang, startTranslation } from './translate.js';

let saved: string | null = null;
try {
  saved = localStorage.getItem('baarali-lang');
} catch {
  // Storage refused: the system's language decides.
}
const lang = pickLang(saved, navigator.language);
document.documentElement.lang = lang;
if (lang === 'fr') {
  // Whatever goes wrong here, the app keeps working, in English: a failure of
  // the translation must never stop the interface (decided 02/10/2026).
  const start = () => {
    try {
      frenchDates();
      startTranslation(FR);
    } catch (err) {
      console.error('[i18n] translation disabled', err);
    }
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}
