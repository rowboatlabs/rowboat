import { z } from 'zod';
import { BlobInfo } from './blob.js';
import { DeleteAssetResult, MoveAssetResult, ProposeChangeResult, ReadAssetResult } from './changeset.js';
import { Message, Topic } from './core.js';
import { AssetPath, AssetVersion, BlobHash, MessageId, SpaceId, TopicId } from './ids.js';

// Decision 5 (CONTRACT.md): the agent face — direct projections of the core
// operations; the MCP server attributes every call as the token's member with
// actingMode 'agent' (or 'scheduled' when the client declares it). Two
// properties are load-bearing (spec §9):
//   1. Semantics live in the tool design — list_spaces makes discovery
//      mechanical (space ids + file listings in one call, no README-link
//      convention required), read_asset bundles recent history, and a
//      propose_change conflict returns current content + history, so ANY
//      well-behaved agent gets read-before-write and retry for free.
//   2. Rowboat's own agent uses these exact tools — no privileged path.
// The agent navigates the same conversation model as the UI (annotation model
// 2026-09-01): one stream of root messages, flat threads behind reply chips,
// topics as archivable annotation rows on threads.
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

export const readStream = tool({
  name: 'read_stream',
  description:
    "A window of the space's message stream: ROOT messages only, newest window first, returned " +
    'oldest first (default 50). Each message carries `replyCount` — a nonzero count means a flat ' +
    'thread hangs under it (read_thread). `topics` holds the annotation rows for these roots ' +
    "(a stated goal + archived flag). When `truncated` is true, older messages exist — pass " +
    '`beforeOffset` (the oldest offset you received) to page back before summarising.',
  input: z.object({
    spaceId: SpaceId,
    /** Page back: only messages with offset below this. */
    beforeOffset: z.number().int().positive().optional(),
    limit: z.number().int().positive().max(200).optional(),
  }),
  output: z.object({
    messages: z.array(Message),
    topics: z.array(Topic),
    /** True when older messages exist beyond the returned window. */
    truncated: z.boolean(),
  }),
});

export const readThread = tool({
  name: 'read_thread',
  description:
    'Read one flat thread: the root message, its topic row (null = a plain untitled thread), and ' +
    'the replies (each attributed to its member and acting mode), oldest first (default 50). ' +
    'Use this to catch up before replying or to answer questions about a conversation. A reply id ' +
    'resolves to its root. When `truncated` is true, pass `beforeOffset` to page back before ' +
    'summarising a whole thread.',
  input: z.object({
    spaceId: SpaceId,
    /** The thread root message id (from read_stream, list_topics, or a message link). */
    rootMessageId: MessageId,
    beforeOffset: z.number().int().positive().optional(),
    limit: z.number().int().positive().max(200).optional(),
  }),
  output: z.object({
    root: Message,
    topic: Topic.nullable(),
    messages: z.array(Message),
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

export const postMessage = tool({
  name: 'post_message',
  description:
    'Post a message: provide threadRoot (a root message id) to reply in that flat thread; omit it ' +
    'to post a new root into the stream. Posting never creates a topic (use create_topic to give a ' +
    'thread a goal). Replying to an archived topic revives it. Only post when your person asked ' +
    'you to — agents are silent by default in spaces.',
  input: z.object({
    spaceId: SpaceId,
    threadRoot: MessageId.optional(),
    body: z.string().min(1).max(65_536),
  }),
  output: z.object({ messageId: MessageId, threadRoot: MessageId.optional() }),
});

export const listTopics = tool({
  name: 'list_topics',
  description:
    "The space's topics — threads a member deliberately annotated with a stated goal — sorted by " +
    'last activity, newest first. Each entry carries the root message (its replyCount is the thread ' +
    'size). Archived topics are off the rail but fully readable; pass includeArchived to see them. ' +
    'Read the thread via read_thread with rootMessageId.',
  input: z.object({
    spaceId: SpaceId,
    includeArchived: z.boolean().optional(),
  }),
  output: z.object({
    topics: z.array(
      Topic.extend({
        rootMessage: Message.nullable(),
        lastActivityAt: z.iso.datetime(),
      }),
    ),
  }),
});

export const createTopic = tool({
  name: 'create_topic',
  description:
    'Annotate a thread with a stated goal, putting it on the rail. Provide rootMessageId to promote ' +
    'an existing thread (use its root, not a reply), or body to post a new root message and annotate ' +
    'it in one step — exactly one of the two. Titles are goals ("Decide: launch cut"), not summaries. ' +
    'At most one topic per thread. Only create topics when asked, or when your person told you to ' +
    'tidy the space.',
  input: z.object({
    spaceId: SpaceId,
    rootMessageId: MessageId.optional(),
    title: z.string().min(1).max(256),
    body: z.string().min(1).max(65_536).optional(),
  }),
  output: z.object({ topic: Topic, rootMessageId: MessageId }),
});

export const manageTopic = tool({
  name: 'manage_topic',
  description:
    'One-row lifecycle ops on a topic: retitle (needs title), archive (off the rail; a new reply ' +
    'revives it), unarchive, or remove (deletes the annotation — the thread and every message stay ' +
    'in the stream untouched; "convert back to thread"). None of these can touch a message. ' +
    'Attributed to your person like everything else.',
  input: z.object({
    spaceId: SpaceId,
    topicId: TopicId,
    action: z.enum(['retitle', 'archive', 'unarchive', 'remove']),
    title: z.string().min(1).max(256).optional(),
  }),
  output: z.object({ topic: Topic }),
});

export const searchFeed = tool({
  name: 'search_feed',
  description:
    'Search messages and topic titles in a space. Each hit names the thread it lives in ' +
    '(threadRootId — feed it to read_thread for context). Use before posting a new root to avoid ' +
    'duplicating a conversation.',
  input: z.object({
    spaceId: SpaceId,
    query: z.string().min(1).max(512),
    limit: z.number().int().positive().max(50).optional(),
  }),
  output: z.object({
    results: z.array(
      z.object({
        messageId: MessageId,
        /** The thread the hit lives in: its root's id (the hit's own id when it IS a root). */
        threadRootId: MessageId,
        /** The topic annotating that thread, when one exists. */
        topicTitle: z.string().optional(),
        snippet: z.string(),
        at: z.iso.datetime(),
      }),
    ),
  }),
});

export const mcpTools = [
  listSpaces,
  readStream,
  readThread,
  readAsset,
  proposeChange,
  moveAsset,
  deleteAsset,
  postMessage,
  listTopics,
  createTopic,
  manageTopic,
  searchFeed,
] as const;
