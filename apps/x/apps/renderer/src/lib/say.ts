// A text in the person's language, for a place the translation layer does
// not see: a field's value, an editor's placeholder, words spoken aloud
// (apps/baarali desktop src/i18n/index.ts sets window.__baaraliText).
// Unchanged when the app is in English or the dictionary lacks the text.
export function say(text: string): string {
  const t = (window as { __baaraliText?: (text: string) => string }).__baaraliText
  return t ? t(text) : text
}
