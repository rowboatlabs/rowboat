import type { ActivityRow } from './store.js';

/** Newest first; ties (same instant) break on the item id, descending — the cursor's order. */
export function sortActivity(rows: ActivityRow[]): ActivityRow[] {
  return rows.sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : a.at < b.at ? 1 : -1));
}
