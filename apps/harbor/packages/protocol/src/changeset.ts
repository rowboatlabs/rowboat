import { z } from 'zod';
import { Attribution, ActingMode } from './core.js';
import { AssetPath, AssetVersion, ChangeSetId, SpaceId, StreamOffset } from './ids.js';

// Decision 1 (CONTRACT.md): a proposal is full new content against a declared
// base version; the org performs a line-level three-way merge. No operation
// encoding on the wire. Decision 6: a conflict response carries everything a
// human draft UI or an agent retry needs — no second round trip.

/** The durable record of one applied change (spec §6). Content is fetched via read/history/diff, not carried here. */
export const ChangeSet = z.object({
  id: ChangeSetId,
  spaceId: SpaceId,
  assetPath: AssetPath,
  /** 0 means the change created the asset. */
  baseVersion: z.number().int().nonnegative(),
  resultVersion: AssetVersion,
  attribution: Attribution,
  /** Commit-message-style reasoning. Optional for humans; the MCP face requires it (mcp.ts). */
  reason: z.string().max(1_000).optional(),
  committedAt: z.iso.datetime(),
  offset: StreamOffset,
});
export type ChangeSet = z.infer<typeof ChangeSet>;

export const ProposeChange = z.object({
  assetPath: AssetPath,
  /** Version the proposer last read. 0 = create; stale values trigger merge or conflict. */
  baseVersion: z.number().int().nonnegative(),
  /** Full desired content. V1 assets are small text files; simplicity beats op-encoding. */
  newContent: z.string().max(1_048_576),
  reason: z.string().max(1_000).optional(),
  actingMode: ActingMode,
  agentName: z.string().max(64).optional(),
});
export type ProposeChange = z.infer<typeof ProposeChange>;

/** A base-file line range where both sides changed. Line numbers are 1-based on the base version. */
export const ConflictRegion = z.object({
  baseStart: z.number().int().positive(),
  baseEnd: z.number().int().nonnegative(),
  /** What the current asset has for that region (the earlier writer won it, so far). */
  current: z.array(z.string()),
  /** What the stale proposal wanted there. */
  proposed: z.array(z.string()),
});
export type ConflictRegion = z.infer<typeof ConflictRegion>;

export const ProposeChangeResult = z.discriminatedUnion('outcome', [
  /** Base was current. Content stored verbatim. */
  z.object({
    outcome: z.literal('applied'),
    changeSet: ChangeSet,
    version: AssetVersion,
  }),
  /**
   * Base was stale but the three-way merge was clean. The org stored
   * `mergedContent` — the proposer MUST treat it, not `newContent`, as what
   * now exists (principle 5: no write is ever silently lost, in either direction).
   */
  z.object({
    outcome: z.literal('merged'),
    changeSet: ChangeSet,
    version: AssetVersion,
    mergedContent: z.string(),
  }),
  /**
   * Overlapping edits. NOTHING was written. The proposer adjusts against
   * `currentContent`/`currentVersion` and re-proposes (spec §6 merge-then-correct).
   * `recentHistory` is the read-before-write bundle for agent retries.
   */
  z.object({
    outcome: z.literal('conflict'),
    currentVersion: AssetVersion,
    currentContent: z.string(),
    regions: z.array(ConflictRegion).min(1),
    recentHistory: z.array(ChangeSet),
  }),
]);
export type ProposeChangeResult = z.infer<typeof ProposeChangeResult>;

/** Read is bundled with recent history everywhere (spec §6: read-before-write is mechanical fact). */
export const ReadAssetResult = z.object({
  path: AssetPath,
  content: z.string(),
  version: AssetVersion,
  recentHistory: z.array(ChangeSet),
});
export type ReadAssetResult = z.infer<typeof ReadAssetResult>;
