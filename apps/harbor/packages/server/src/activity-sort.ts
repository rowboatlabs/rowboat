import type { ActivityRow } from './store.js';

/** Newest first; ties (same instant) break on the item id, descending — the cursor's order. */
export function sortActivity(rows: ActivityRow[]): ActivityRow[] {
  return rows.sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : a.at < b.at ? 1 : -1));
}

/** Is the row strictly older than the cursor, in that same order? */
export function olderThan(row: { at: string; id: string }, before: { at: string; id: string } | undefined): boolean {
  if (!before) return true;
  return row.at < before.at || (row.at === before.at && row.id < before.id);
}
