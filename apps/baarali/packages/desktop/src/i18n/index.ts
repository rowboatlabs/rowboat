// Loaded first by the renderer's entry (one line added by scripts/brand.mjs):
// the app in the person's language. French when the app or the system says so.
import { FR } from './fr.js';
import { frenchDates, pickLang, startTranslation, translate } from './translate.js';

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
      // For text the page writes into a field (a field's value is not a text
      // node the layer sees): the renderer asks here, English when absent.
      (window as { __baaraliText?: (text: string) => string }).__baaraliText = (text) => translate(FR, text, 'attr') ?? text;
      startTranslation(FR);
    } catch (err) {
      console.error('[i18n] translation disabled', err);
    }
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}
