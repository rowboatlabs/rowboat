import { z } from 'zod';
import type {
  AcceptInviteResult,
  ChangeSet,
  ConflictRegion,
  CreateInviteResult,
  Member,
  Message,
  ProposeChangeResult,
  ReadAssetResult,
  ResolveInviteResult,
  ServerFrame,
  Space,
  Topic,
} from '@rowboat/spaces-protocol';

// Renderer-facing surface for Spaces. The wire contract's single source of
// truth is @rowboat/spaces-protocol (see apps/harbor/CONTRACT.md) — this file
// only re-exports the types the UI needs and defines the app-local envelopes
// (org records, the IPC event wrapper). Protocol-shaped payloads cross IPC via
// z.custom<T>() like the turn spine does: deep validation already happens in
// core's client (responses) and the org's server (requests).

export type {
  AcceptInviteResult,
  ChangeSet,
  ConflictRegion,
  CreateInviteResult,
  Member,
  Message,
  ProposeChangeResult,
  ReadAssetResult,
  ResolveInviteResult,
  ServerFrame,
  Space,
  Topic,
};

/** An org this install is signed into — the renderer's view (auth details stay in core). */
export const SpacesOrgSummary = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  baseUrl: z.string(),
  /** Who we are on this org (org-scoped identity, spec §4). */
  memberId: z.string(),
});
export type SpacesOrgSummary = z.infer<typeof SpacesOrgSummary>;

export interface SpacesAssetEntry {
  path: string;
  version: number;
  updatedAt: string;
}

export interface SpacesTopicWithMessages {
  topic: Topic;
  messages: Message[];
}

export interface SpacesPostResult {
  topic: Topic;
  message: Message;
}

export type SpacesManageTopicAction =
  | { action: 'retitle'; title: string }
  | { action: 'archive' }
  | { action: 'unarchive' }
  | { action: 'merge_into'; targetTopicId: string };

/**
 * What the renderer may propose. actingMode is deliberately absent: everything
 * a human does in the app is 'direct'; agent/scheduled writes go through the
 * org's MCP face, never through this IPC surface.
 */
export interface SpacesProposeInput {
  assetPath: string;
  baseVersion: number;
  newContent: string;
  reason?: string;
}

/** Envelope for 'spaces:events' pushes: which org the live frame came from. */
export interface SpacesBusEvent {
  orgId: string;
  frame: ServerFrame;
}
