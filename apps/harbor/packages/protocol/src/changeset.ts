import { z } from 'zod';
import { BlobInfo } from './blob.js';
import { Attribution, ActingMode } from './core.js';
import { AssetPath, AssetVersion, BlobHash, ChangeSetId, SpaceId, StreamOffset, TopicId } from './ids.js';

// Decision 1 (CONTRACT.md): a proposal is full new content against a declared
// base version; the org performs a line-level three-way merge. No operation
// encoding on the wire. Decision 6: a conflict response carries everything a
// human draft UI or an agent retry needs — no second round trip.
//
// Binary variant (spec §6): a proposal may carry an uploaded blob's hash
// instead of text. One namespace, one log — `design.pdf` beside `README.md`,
// only the populated field differs. Binary staleness never merges: a stale
// binary base (or a binary head) is conflict-or-replace, never a three-way.

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
  /** The topic the change was made from, when it was made from one (provenance). */
  topicId: TopicId.optional(),
  /** Present when the change produced a binary version (proposeChange's blob variant). */
  blob: BlobInfo.optional(),
  committedAt: z.iso.datetime(),
  offset: StreamOffset,
});
export type ChangeSet = z.infer<typeof ChangeSet>;

export const ProposeChange = z.object({
  assetPath: AssetPath,
  /** Version the proposer last read. 0 = create; stale values trigger merge or conflict. */
  baseVersion: z.number().int().nonnegative(),
  /** Text variant: full desired content (inline cap 1MB — over that, or non-UTF-8, attach a blob instead). */
  newContent: z.string().max(1_048_576).optional(),
  /** Binary variant: the address of bytes already uploaded to this space (uploadBlob). Exactly one of newContent/blob. */
  blob: BlobHash.optional(),
  reason: z.string().max(1_000).optional(),
  /** Provenance: the topic this change was made from. Omitted by prompt-driven agents, which append "· topic:<id>" to the reason instead — the org derives topicId from that suffix (topicIdFromReason). */
  topicId: TopicId.optional(),
  actingMode: ActingMode,
  agentName: z.string().max(64).optional(),
}).superRefine((v, ctx) => {
  if ((v.newContent === undefined) === (v.blob === undefined)) {
    ctx.addIssue({ code: 'custom', message: 'exactly one of newContent or blob' });
  }
});
export type ProposeChange = z.infer<typeof ProposeChange>;

/**
 * The reason-suffix convention, owned here so both faces parse it identically:
 * a change made from a topic may carry "· topic:<id>" at the end of its reason
 * (legacy spelling "thread:"). Servers newer than migration 004 stamp the
 * parsed value into ChangeSet.topicId at commit time.
 */
export function topicIdFromReason(reason: string | undefined): string | null {
  if (!reason) return null;
  const suffixed = /\s*·\s*(?:topic|thread):([0-9A-Za-z_-]+)\s*$/.exec(reason);
  if (suffixed) return suffixed[1]!;
  const bare = /^(?:topic|thread):([0-9A-Za-z_-]+)$/.exec(reason.trim());
  return bare ? bare[1]! : null;
}

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
   *
   * Binary: when either side of a stale propose is binary there is nothing to
   * three-way-merge, so the conflict comes with `regions: []` — the current
   * head is `currentBlob` (binary, `currentContent` is '') or `currentContent`
   * (text). Re-proposing at `currentVersion` is the explicit replace.
   */
  z.object({
    outcome: z.literal('conflict'),
    currentVersion: AssetVersion,
    currentContent: z.string(),
    currentBlob: BlobInfo.optional(),
    regions: z.array(ConflictRegion),
    recentHistory: z.array(ChangeSet),
  }),
]);
export type ProposeChangeResult = z.infer<typeof ProposeChangeResult>;

/** Read is bundled with recent history everywhere (spec §6: read-before-write is mechanical fact). */
export const ReadAssetResult = z.object({
  path: AssetPath,
  /** '' for binary versions — the bytes live behind getBlob, addressed by `blob.hash`. */
  content: z.string(),
  /** Present when this version is binary. */
  blob: BlobInfo.optional(),
  version: AssetVersion,
  recentHistory: z.array(ChangeSet),
});
export type ReadAssetResult = z.infer<typeof ReadAssetResult>;
