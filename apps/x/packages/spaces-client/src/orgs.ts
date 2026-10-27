/**
 * The org's address is generated, never chosen (decision 2026-09-07: names
 * are display-only; the address is opaque). Always append a random suffix
 * so creation reveals nothing about taken names. Shared with the web host
 * (2026-10-27: its name-only request omitted Harbor's required slug).
 * Prefix 35 + '-' + 4 fits Harbor's 40-character cap.
 */
export function generatedOrgSlug(name: string): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const prefix =
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 35).replace(/-+$/, '') || 'server';
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${prefix}-${suffix}`;
}
