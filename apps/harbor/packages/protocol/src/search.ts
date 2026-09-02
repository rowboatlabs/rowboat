import { z } from 'zod';
import { BlobInfo } from './blob.js';
import { Attribution, Topic } from './core.js';
import { AssetPath, AssetVersion, MessageId, StreamOffset } from './ids.js';

// Space search (2026-09-02): one contract, served identically on both faces
// (GET /v1/spaces/:spaceId/search and the search_space MCP tool). Results come
// back CATEGORIZED — three independently-ranked lists, not one interleaved
// page — because that is what both consumers want: the command palette renders
// vertical categories, and agents pick the category they were asked about.
//
// v0 posture: top-N per category with a truncated flag, no cursors. A person
// refines their query; an agent is told to do the same. Ordering per category:
// messages newest-first (chat convention), topics and assets by relevance.
//
// Query semantics (documented, not configurable): terms are AND-ed words;
// the final term matches as a prefix (live typing works mid-word); a term that
// equals a space member's name also matches mentions of that member
// (query-time expansion — the index stores ids, names resolve fresh so
// renames never stale it). Snippets are RAW message/asset text: mention
// tokens ("@<memberId>") arrive unresolved, and clients render them through
// the same mention resolution as message bodies.

export const SearchKind = z.enum(['messages', 'topics', 'assets']);
export type SearchKind = z.infer<typeof SearchKind>;

/** A body match. Navigate: open the thread at `threadRootId`, land on `messageId`. */
export const MessageSearchHit = z.object({
  messageId: MessageId,
  /** The thread the hit lives in: its root's id (the hit's own id when it IS a root). */
  threadRootId: MessageId,
  /** The topic annotating that thread, when one exists. */
  topicTitle: z.string().optional(),
  author: Attribution,
  /** Raw body excerpt around the first matched term — resolve mentions client-side. */
  snippet: z.string(),
  postedAt: z.iso.datetime(),
  offset: StreamOffset,
});
export type MessageSearchHit = z.infer<typeof MessageSearchHit>;

/** A topic-title match — the whole annotation row rides along (title, root, archived). */
export const TopicSearchHit = z.object({ topic: Topic });
export type TopicSearchHit = z.infer<typeof TopicSearchHit>;

/** A file match: by extracted content (snippet present) or by path (snippet absent). */
export const AssetSearchHit = z.object({
  path: AssetPath,
  version: AssetVersion,
  updatedAt: z.iso.datetime(),
  /** Present when the head version is binary (findable by filename only). */
  blob: BlobInfo.optional(),
  /** Excerpt of the extracted searchable text around the first matched term. */
  snippet: z.string().optional(),
});
export type AssetSearchHit = z.infer<typeof AssetSearchHit>;

export const SearchResults = z.object({
  messages: z.array(MessageSearchHit),
  topics: z.array(TopicSearchHit),
  assets: z.array(AssetSearchHit),
  /** Per category: more hits existed than `limit` — refine the query. */
  truncated: z.object({
    messages: z.boolean(),
    topics: z.boolean(),
    assets: z.boolean(),
  }),
});
export type SearchResults = z.infer<typeof SearchResults>;

export const SearchLimit = z.number().int().positive().max(50);
