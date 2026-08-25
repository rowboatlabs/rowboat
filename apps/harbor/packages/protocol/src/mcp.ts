import { z } from 'zod';
import { BlobInfo } from './blob.js';
import { DeleteAssetResult, MoveAssetResult, ProposeChangeResult, ReadAssetResult } from './changeset.js';
import { Message, Topic } from './core.js';
import { AssetPath, AssetVersion, BlobHash, MessageId, SpaceId, TopicId } from './ids.js';

// Decision 5 (CONTRACT.md): the agent face. These six tools are direct
// projections of the core operations; the MCP server attributes every call as
// the token's member with actingMode 'agent' (or 'scheduled' when the client
// declares it). Two properties are load-bearing (spec §9):
//   1. Semantics live in the tool design — list_spaces makes discovery
//      mechanical (space ids + file listings in one call, no README-link
//      convention required), read_asset bundles recent history, and a
//      propose_change conflict returns current content + history, so ANY
//      well-behaved agent gets read-before-write and retry for free.
//   2. Rowboat's own agent uses these exact tools — no privileged path.
// NOTE: `reason` is REQUIRED here though optional on the render face. The spec's
// convention ("agents essentially always attach a why") is enforced where only
// agents call.

export interface McpToolDef<In extends z.ZodType, Out extends z.ZodType> {
  name: string;
  description: string;
  input: In;
  output: Out;
}

function tool<In extends z.ZodType, Out extends z.ZodType>(t: McpToolDef<In, Out>): McpToolDef<In, Out> {
  return t;
}

export const listSpaces = tool({
  name: 'list_spaces',
  description:
    'List the spaces you are a member of on this org, each with its file listing. ' +
    'Call this first: it resolves a space name (e.g. "Roadboard") to the spaceId every other ' +
    'tool needs, and shows the asset paths available to read_asset. Discovery is mechanical — ' +
    'do not guess spaceIds or file paths.',
  input: z.object({}),
  output: z.object({
    spaces: z.array(
      z.object({
        id: SpaceId,
        name: z.string(),
        memberCount: z.number().int().nonnegative(),
        assets: z.array(
          z.object({
            path: AssetPath,
            version: AssetVersion,
            updatedAt: z.iso.datetime(),
            /** Present = a binary file (image, pdf, …); read_asset returns its metadata, not bytes. */
            blob: BlobInfo.optional(),
          }),
        ),
      }),
    ),
  }),
});

export const readTopic = tool({
  name: 'read_topic',
  description:
    'Read a feed topic: its metadata and messages (each attributed to its member and acting ' +
    'mode). Use this to answer questions about a discussion, summarise a thread, or catch up ' +
    'before replying. Returns the most recent messages up to `limit` (default 50), oldest first.',
  input: z.object({
    spaceId: SpaceId,
    topicId: TopicId,
    limit: z.number().int().positive().max(200).optional(),
  }),
  output: z.object({
    topic: Topic,
    messages: z.array(Message),
    /** True when older messages exist beyond the returned window. */
    truncated: z.boolean(),
  }),
});

export const readAsset = tool({
  name: 'read_asset',
  description:
    'Read a file in a space. Returns content, current version, and recent change history. ' +
    'Always read before proposing a change; the version you read is your base version. ' +
    'Binary files (images, pdfs, uploads) return empty content plus a `blob` {hash, size, mime} — ' +
    'describe them by their metadata; the bytes are not readable over this face.',
  input: z.object({ spaceId: SpaceId, path: AssetPath }),
  output: ReadAssetResult,
});

export const proposeChange = tool({
  name: 'propose_change',
  description:
    'Propose the full new content of a file against the version you read (baseVersion; 0 to create). ' +
    'Provide EXACTLY ONE of newContent (text) or blob (binary). `blob` files bytes already uploaded to ' +
    'this space by their sha256 — e.g. the hash inside a message attachment link ".../b/<hash>" — so ' +
    '"put that attachment in the space files" is a pure reference, no re-upload. ' +
    'Outcome "applied"/"merged" means it is saved (on "merged", mergedContent is what now exists — re-read it). ' +
    'Outcome "conflict" means nothing was written: adjust against currentContent and re-propose ' +
    '(binary conflicts come with regions: [] — re-proposing at currentVersion is the explicit replace).',
  // One-of newContent/blob is enforced by the server (kept out of the schema so
  // the JSON-schema projection stays plain).
  input: z.object({
    spaceId: SpaceId,
    path: AssetPath,
    baseVersion: z.number().int().nonnegative(),
    newContent: z.string().max(1_048_576).optional(),
    blob: BlobHash.optional(),
    /** One line: why this change. Shown in the feed and in history forever. */
    reason: z.string().min(1).max(1_000),
  }),
  output: ProposeChangeResult,
});

export const moveAsset = tool({
  name: 'move_asset',
  description:
    'Move or rename a file (folders are just path prefixes — moving into a new folder creates it). ' +
    'Content, history, and blame travel with the file; the old path keeps a redirect. Declare the ' +
    'baseVersion you last read: outcome "conflict" means the file changed meanwhile — re-read and retry. ' +
    'An occupied destination is refused (pick another name); this never overwrites.',
  input: z.object({
    spaceId: SpaceId,
    fromPath: AssetPath,
    toPath: AssetPath,
    baseVersion: z.number().int().positive(),
    /** One line: why this move. Shown in the feed and in history forever. */
    reason: z.string().min(1).max(1_000),
  }),
  output: MoveAssetResult,
});

export const deleteAsset = tool({
  name: 'delete_asset',
  description:
    'Delete a file from the space. Nothing is destroyed — every version and its history stay in the ' +
    'record, humans can restore it from Trash, and the feed shows who deleted it and why. Declare the ' +
    'baseVersion you last read; "conflict" means it changed meanwhile. Delete conservatively: prefer ' +
    'moving files into folders over deleting when tidying.',
  input: z.object({
    spaceId: SpaceId,
    path: AssetPath,
    baseVersion: z.number().int().positive(),
    /** One line: why this delete. Shown in the feed and in history forever. */
    reason: z.string().min(1).max(1_000),
  }),
  output: DeleteAssetResult,
});

export const postToTopic = tool({
  name: 'post_to_topic',
  description:
    'Post a message into a space feed. Provide topicId to reply in a thread; omit it to start a new ' +
    'topic (your first message becomes the title). Only post when your person asked you to — agents ' +
    'are silent by default in spaces.',
  input: z.object({
    spaceId: SpaceId,
    topicId: TopicId.optional(),
    body: z.string().min(1).max(65_536),
  }),
  output: z.object({ topicId: TopicId, messageId: MessageId }),
});

export const searchFeed = tool({
  name: 'search_feed',
  description: 'Search topics and messages in a space. Use before starting a topic to avoid duplicates.',
  input: z.object({
    spaceId: SpaceId,
    query: z.string().min(1).max(512),
    limit: z.number().int().positive().max(50).optional(),
  }),
  output: z.object({
    results: z.array(
      z.object({
        topicId: TopicId,
        title: z.string(),
        snippet: z.string(),
        lastActivityAt: z.iso.datetime(),
      }),
    ),
  }),
});

export const manageTopic = tool({
  name: 'manage_topic',
  description:
    'Tidy the feed: retitle a topic, archive/unarchive it, or merge it into another. ' +
    'Housekeeping actions; attributed to your person like everything else.',
  input: z.object({
    spaceId: SpaceId,
    topicId: TopicId,
    action: z.enum(['retitle', 'archive', 'unarchive', 'merge_into']),
    title: z.string().min(1).max(256).optional(),
    targetTopicId: TopicId.optional(),
  }),
  output: z.object({ topic: Topic }),
});

export const mcpTools = [
  listSpaces,
  readTopic,
  readAsset,
  proposeChange,
  moveAsset,
  deleteAsset,
  postToTopic,
  searchFeed,
  manageTopic,
] as const;
