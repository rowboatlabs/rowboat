import { readFileSync } from 'node:fs';

// The few files the home page needs from this origin (decided 01/10/2026):
// the fonts, served here because the pages' CSP admits only 'self'. A fixed
// list, never a path from the request: nothing else on disk can be reached.
// public/ sits beside src/ and dist/, so the same path works for both.

const FILES: Record<string, string> = {
  'inter.woff2': 'font/woff2',
  'source-serif-4.woff2': 'font/woff2',
  // The faces of the example agents on the home page (from the old Baarali's
  // clay portraits, decided 01/10/2026), served as agent-<name>.jpg.
  ...Object.fromEntries(['adjoua', 'aminata', 'fatou', 'ibrahim', 'kofi', 'kouadio', 'mariama', 'moussa', 'youssoupha', 'zara'].map((n) => [`agent-${n}.jpg`, 'image/jpeg'])),
};

const cache = new Map<string, Uint8Array<ArrayBuffer>>();

/** The file and its type, or null when it is not one of ours. */
export function asset(name: string): { body: Uint8Array<ArrayBuffer>; type: string } | null {
  const type = FILES[name];
  if (!type) return null;
  let body = cache.get(name);
  if (!body) {
    body = new Uint8Array(readFileSync(new URL(`../public/${name.startsWith('agent-') ? `agents/${name.slice(6)}` : name}`, import.meta.url))) as Uint8Array<ArrayBuffer>;
    cache.set(name, body);
  }
  return { body, type };
}
