import { diffArrays } from 'diff';

// The merge engine (CONTRACT.md decision 1; spec §6). Line-level three-way
// merge: base = the proposal's declared base version's content, current = the
// asset now, proposed = the stale proposal's newContent. The golden fixtures in
// @rowboat/spaces-protocol/fixtures/merge are the conformance suite — this
// exact engine ships in the real Harbor later, so behavior disputes get settled
// by adding a fixture, not by editing this file quietly.
//
// Semantics:
// - Edits from the two sides that touch disjoint base regions compose cleanly.
// - Cross-side edits conflict when their base ranges overlap, when both insert
//   at the same base point (line order would be arbitrary), or when both sides
//   made the identical edit — the last case is clean and applied once.
// - Adjacent-but-not-overlapping edits (one side inserts exactly at the
//   boundary of the other side's edit) merge cleanly. Latitude: if dogfood
//   shows this loses intent, add a fixture and tighten here.
// - Conflict regions are reported as 1-based inclusive line ranges of the BASE;
//   a pure insertion point after base line N is the zero-length region
//   {baseStart: N+1, baseEnd: N}.

export interface MergeConflictRegion {
  baseStart: number;
  baseEnd: number;
  current: string[];
  proposed: string[];
}

export type MergeResult =
  | { outcome: 'merged'; content: string }
  | { outcome: 'conflict'; regions: MergeConflictRegion[] };

type Side = 'current' | 'proposed';

/** Replace base[start..end) with `lines`. start === end is an insertion before base[start]. */
interface Edit {
  start: number;
  end: number;
  lines: string[];
  side: Side;
}

function splitLines(content: string): { lines: string[]; trailingNewline: boolean } {
  if (content === '') return { lines: [], trailingNewline: false };
  const trailingNewline = content.endsWith('\n');
  const lines = content.split('\n');
  if (trailingNewline) lines.pop();
  return { lines, trailingNewline };
}

/** Derive coalesced edits turning `baseLines` into `sideLines`. Same-side edits are disjoint with gaps. */
function editsAgainstBase(baseLines: string[], sideLines: string[], side: Side): Edit[] {
  const parts = diffArrays(baseLines, sideLines);
  const edits: Edit[] = [];
  let baseIndex = 0;
  let pending: Edit | null = null;
  for (const part of parts) {
    if (part.removed) {
      if (pending && pending.end === baseIndex) {
        pending.end += part.value.length;
      } else {
        pending = { start: baseIndex, end: baseIndex + part.value.length, lines: [], side };
        edits.push(pending);
      }
      baseIndex += part.value.length;
    } else if (part.added) {
      if (pending && pending.end === baseIndex) {
        pending.lines.push(...part.value);
      } else {
        pending = { start: baseIndex, end: baseIndex, lines: [...part.value], side };
        edits.push(pending);
      }
    } else {
      pending = null;
      baseIndex += part.value.length;
    }
  }
  return edits;
}

/** Cross-side interaction: overlapping base ranges, or two insertions at the same point. */
function interacts(a: Edit, b: Edit): boolean {
  if (a.side === b.side) return false;
  if (a.start === a.end && b.start === b.end) return a.start === b.start;
  return a.start < b.end && b.start < a.end;
}

/** Side content for base range [rs, re), given that side's edits inside the range (sorted). */
function sideContentForRegion(baseLines: string[], edits: Edit[], rs: number, re: number): string[] {
  const out: string[] = [];
  let i = rs;
  for (const e of edits) {
    out.push(...baseLines.slice(i, e.start));
    out.push(...e.lines);
    i = e.end;
  }
  out.push(...baseLines.slice(i, re));
  return out;
}

function sameEdits(a: Edit[], b: Edit[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((e, i) => {
    const o = b[i]!;
    return e.start === o.start && e.end === o.end && e.lines.length === o.lines.length &&
      e.lines.every((l, j) => l === o.lines[j]);
  });
}

export function merge3(base: string, current: string, proposed: string): MergeResult {
  // Fast paths. Beyond speed, these dodge diff-script ambiguity on degenerate
  // inputs (repeated lines can diff two equal strings via different edit scripts).
  if (current === proposed) return { outcome: 'merged', content: current };
  if (current === base) return { outcome: 'merged', content: proposed };
  if (proposed === base) return { outcome: 'merged', content: current };

  const b = splitLines(base);
  const c = splitLines(current);
  const p = splitLines(proposed);

  const edits = [
    ...editsAgainstBase(b.lines, c.lines, 'current'),
    ...editsAgainstBase(b.lines, p.lines, 'proposed'),
  ].sort((x, y) => x.start - y.start || x.end - y.end || (x.side === y.side ? 0 : x.side === 'current' ? -1 : 1));

  // Group transitively interacting edits. Sorted by start, interval-connected
  // components are contiguous, so checking against the open group suffices.
  const groups: Edit[][] = [];
  for (const e of edits) {
    const open = groups[groups.length - 1];
    if (open && open.some((m) => interacts(m, e))) open.push(e);
    else groups.push([e]);
  }

  const keep: Edit[] = [];
  const regions: MergeConflictRegion[] = [];
  for (const group of groups) {
    const cur = group.filter((e) => e.side === 'current');
    const pro = group.filter((e) => e.side === 'proposed');
    if (cur.length === 0 || pro.length === 0) {
      keep.push(...group);
      continue;
    }
    if (sameEdits(cur, pro)) {
      keep.push(...cur);
      continue;
    }
    const rs = Math.min(...group.map((e) => e.start));
    const re = Math.max(...group.map((e) => e.end));
    regions.push({
      baseStart: rs + 1,
      baseEnd: re, // exclusive 0-based end == inclusive 1-based; rs === re → baseStart = baseEnd + 1
      current: sideContentForRegion(b.lines, cur, rs, re),
      proposed: sideContentForRegion(b.lines, pro, rs, re),
    });
  }

  if (regions.length > 0) {
    return { outcome: 'conflict', regions };
  }

  // Apply kept edits (already sorted; at equal start, insertions precede replacements).
  const merged = sideContentForRegion(b.lines, keep, 0, b.lines.length);

  // EOF newline is three-way merged as a property: the side that changed it wins;
  // if both changed it and disagree, keep the newline.
  const trail =
    c.trailingNewline === b.trailingNewline
      ? p.trailingNewline
      : p.trailingNewline === b.trailingNewline
        ? c.trailingNewline
        : c.trailingNewline || p.trailingNewline;

  const content = merged.length === 0 ? '' : merged.join('\n') + (trail ? '\n' : '');
  return { outcome: 'merged', content };
}
