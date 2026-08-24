import { z } from 'zod';
import type {
  AcceptInviteResult,
  BlobInfo,
  ChangeSet,
  ConflictRegion,
  CreateInviteResult,
  Member,
  Message,
  ProposeChangeResult,
  Reaction,
  ReactionGroup,
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
  BlobInfo,
  ChangeSet,
  ConflictRegion,
  CreateInviteResult,
  Member,
  Message,
  ProposeChangeResult,
  Reaction,
  ReactionGroup,
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
  authKind: z.enum(['dev', 'oauth']),
  /** Present = the org needs a re-login (refresh dead). Visible and gentle, never silent. */
  authError: z.string().optional(),
});
export type SpacesOrgSummary = z.infer<typeof SpacesOrgSummary>;

export interface SpacesAssetEntry {
  path: string;
  version: number;
  updatedAt: string;
  /** Present when the head version is binary (spec §6). */
  blob?: BlobInfo;
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
  /** Text variant. Exactly one of newContent / blob (contract decision 1, amended). */
  newContent?: string;
  /** Binary variant: the hash of bytes already uploaded via spaces:uploadBlob. */
  blob?: string;
  reason?: string;
}

/** Envelope for 'spaces:events' pushes: which org the live frame came from. */
export interface SpacesBusEvent {
  orgId: string;
  frame: ServerFrame;
}

// ---------------------------------------------------------------------------
// Mention scanning — one implementation for the renderer (composer highlight,
// @rowboat trigger) and main (mention notifications).
//
// Address vs. cite rules (ported from buzz's mention scanner): text inside
// code fences, inline code, and quoted lines is writing ABOUT someone, not
// addressing them — stripped before scanning. The mention must sit at a word
// boundary ("email@rowboat.com" never triggers).
// ---------------------------------------------------------------------------

export function stripNonAddressRegions(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, ' ') // fenced code blocks (incl. unterminated)
    .replace(/`[^`\n]*`/g, ' ') // inline code
    .replace(/^[ \t]*>.*$/gm, ' '); // markdown-quoted lines (citing someone else's message)
}

/** Does the body genuinely ADDRESS @<handle>? Case-insensitive. */
export function containsMemberAddress(body: string, handle: string): boolean {
  return addressRegExp(handle).test(stripNonAddressRegions(body));
}

function addressRegExp(handle: string): RegExp {
  const escaped = handle.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Negative lookahead: not a longer handle ("@arjun.k", "@Arjun Kumaraswamy"
  // when matching "Arjun Kumar") — but trailing punctuation ("ping @arjun.")
  // still counts as addressing.
  return new RegExp(`(^|[\\s([{])@${escaped}(?!\\w|[.-]\\w)`, 'i');
}

/** What a mention can name someone by. Ids are opaque (spec §4), so people type the display name. */
export interface MentionIdentity {
  id: string;
  displayName?: string;
}

/**
 * Does the body address this member? The composer inserts the DISPLAY NAME
 * (an org's member ids are opaque IdP subjects — "@01M0F8S2…" helps nobody
 * reading the log), so that is the primary form; the id still matches so
 * agent-written and older messages keep working.
 */
export function mentionsMember(body: string, member: MentionIdentity): boolean {
  const stripped = stripNonAddressRegions(body);
  const handles = [member.displayName, member.id].filter((h): h is string => !!h && h.trim().length > 0);
  return handles.some((handle) => addressRegExp(handle).test(stripped));
}

/** The @rowboat address — always the speaker's own agent (spec §8). */
export function containsRowboatAddress(body: string): boolean {
  return containsMemberAddress(body, 'rowboat');
}
