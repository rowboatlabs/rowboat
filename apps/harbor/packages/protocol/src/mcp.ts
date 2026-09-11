import { z } from 'zod';
import { MENTION_GRAMMAR } from './mentions.js';
import { ActivityKind, NewPoll } from './api.js';
import { BlobInfo } from './blob.js';
import {
  ChangeSet,
  DeleteAssetResult,
  MoveAssetResult,
  ProposeChangeResult,
  ReadAssetResult,
  RestoreAssetResult,
} from './changeset.js';
import { Attribution, Member, Message, ReactionEmoji, Space, SpaceKind, Topic } from './core.js';
import { AssetPath, AssetVersion, BlobHash, MemberId, MessageId, SpaceId, TopicId } from './ids.js';
import { CreateInviteResult } from './invite.js';
import { SearchKind, SearchLimit, SearchResults } from './search.js';

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
//
// PARITY (2026-09-09): the agent face projects EVERY member operation the
// render face has — identity, roster, DMs, space lifecycle, invites, message
// edit/delete/react, polls (create, vote, end), file restore/history/diff,
// versioned reads. An agent acting for a member can do whatever that member
// can do in the app; attribution (actingMode + agentName) records how, never
// who else. The earlier "agents are silent / don't react / don't vote" posture
// is retired — guidance about WHEN to act lives in the agent's skill, not in
// the tool surface.
//
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

// --- identity & people --------------------------------------------------------

export const whoami = tool({
  name: 'whoami',
  description:
    'Who your person is on this org: their memberId, display name, and role. Use it to recognise ' +
    'their own messages and reactions in what you read, and to open their notes-to-self DM ' +
    '(open_direct with their own memberId).',
  input: z.object({}),
  output: z.object({ member: Member }),
});

export const listMembers = tool({
  name: 'list_members',
  description:
    'People, with names. Omit spaceId for the org roster as your person sees it: everyone they ' +
    'share at least one space or DM with (deduped, sorted by display name). Pass spaceId for that ' +
    "space's members only. This is how a name becomes a memberId — match displayName " +
    '(case-insensitive, first name is usually enough); if several match, say so and ask. ' +
    'Messages and reactions carry memberIds only; resolve them here before naming anyone.',
  input: z.object({ spaceId: SpaceId.optional() }),
  output: z.object({ members: z.array(Member) }),
});

// --- spaces & membership --------------------------------------------------------

export const listSpaces = tool({
  name: 'list_spaces',
  description:
    'List the spaces you are a member of on this org, each with its file listing. ' +
    'Call this first: it resolves a space name (e.g. "Roadboard") to the spaceId every other ' +
    'tool needs, and shows the asset paths available to read_asset. Discovery is mechanical — ' +
    'do not guess spaceIds or file paths. Shared spaces only by default; pass includeDirect to ' +
    'also list your direct messages (kind "direct": a private conversation with exactly one other ' +
    'member — its participants are listed; label it by the other member, its name is a placeholder). ' +
    "A DM flagged self: true is your person's own notes-to-self space (they are its only participant) — " +
    'the right place for "save this for me". Every other tool works on a DM exactly as on a space.',
  input: z.object({
    /** Also list the member's direct messages (kind 'direct'). Default false: pre-DM skills never see one. */
    includeDirect: z.boolean().optional(),
  }),
  output: z.object({
    spaces: z.array(
      z.object({
        id: SpaceId,
        name: z.string(),
        kind: SpaceKind,
        /** Direct spaces only: the member ids (one = a self-DM). */
        participants: z.array(MemberId).optional(),
        /** Direct spaces only: true when the caller is the only participant — their notes to self. */
        self: z.boolean().optional(),
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

export const openDirect = tool({
  name: 'open_direct',
  description:
    'Open the direct message with one member (get-or-create: two people only ever have one DM, ' +
    'so calling this for an existing DM just returns it). Returns the DM as a space — use its ' +
    'spaceId with post_message, read_stream, files, exactly like any space. Opening a new DM ' +
    'needs no acceptance; the other person simply sees it. Get the memberId from list_members; ' +
    "your person's own memberId (whoami) opens their notes-to-self.",
  input: z.object({ memberId: MemberId }),
  output: z.object({ space: Space, created: z.boolean() }),
});

export const createSpace = tool({
  name: 'create_space',
  description:
    'Create a new shared space (a channel: one message stream plus a file folder). Your person ' +
    'becomes its first member; others join by invite link (create_invite). Check list_spaces ' +
    'first so you do not create a duplicate of a space that already exists.',
  input: z.object({ name: z.string().min(1).max(128) }),
  output: z.object({ space: Space }),
});

export const renameSpace = tool({
  name: 'rename_space',
  description:
    'Rename a shared space (any member may; direct messages refuse — a DM is named by the other ' +
    'person). An identical name is a no-op.',
  input: z.object({ spaceId: SpaceId, name: z.string().min(1).max(128) }),
  output: z.object({ space: Space }),
});

export const leaveSpace = tool({
  name: 'leave_space',
  description:
    'Remove your person from a shared space. Direct messages cannot be left. Only when they ' +
    'explicitly asked to leave — rejoining needs a fresh invite.',
  input: z.object({ spaceId: SpaceId }),
  output: z.object({ left: z.literal(true) }),
});

export const createInvite = tool({
  name: 'create_invite',
  description:
    'Make an invite link for a shared space (any member may; DMs refuse). Returns the link to ' +
    'share — delivery is up to your person (paste it in a DM, an email, wherever they said). ' +
    'The org may cap expiresInHours.',
  input: z.object({ spaceId: SpaceId, expiresInHours: z.number().int().positive().max(24 * 30).optional() }),
  output: CreateInviteResult,
});

// --- reading ------------------------------------------------------------------

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
    'Read one flat thread: the root message, its topic row (null = a plain untitled thread; its ' +
    'documentPath, when set, is the file the discussion is about — read_asset it for context), and ' +
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

export const searchSpace = tool({
  name: 'search_space',
  description:
    'Search a space: messages, topic titles, and files (by extracted content or filename), ' +
    'returned as three independently-ranked lists. Query words are AND-ed; a word that is a ' +
    "member's name also matches @-mentions of them. Message hits name their thread " +
    '(threadRootId — feed it to read_thread for context); asset hits name the path for ' +
    'read_asset. A truncated flag means more hits existed than limit — refine the query ' +
    'rather than raising the limit. Use before posting a new root to avoid duplicating a ' +
    'conversation, and to locate files without listing everything.',
  input: z.object({
    spaceId: SpaceId,
    query: z.string().min(1).max(512),
    /** Narrow to specific categories; omit for all three. */
    kinds: z.array(SearchKind).optional(),
    /** Per-category cap, default 10. */
    limit: SearchLimit.optional(),
  }),
  output: SearchResults,
});

// --- messages -----------------------------------------------------------------

export const postMessage = tool({
  name: 'post_message',
  description:
    'Post a message: provide threadRoot (a root message id) to reply in that flat thread; omit it ' +
    'to post a new root into the stream. Posting never creates a topic (use create_topic to give a ' +
    'thread a goal). Replying to an archived topic revives it. Attach a `poll` to post a poll ' +
    '(question + 2–10 answers; the body must still carry a plain-text rendering of it for clients ' +
    'that cannot show the card). Works on a DM exactly as on a space. ' +
    MENTION_GRAMMAR,
  input: z.object({
    spaceId: SpaceId,
    threadRoot: MessageId.optional(),
    body: z.string().min(1).max(65_536),
    poll: NewPoll.optional(),
  }),
  output: z.object({ messageId: MessageId, threadRoot: MessageId.optional() }),
});

export const editMessage = tool({
  name: 'edit_message',
  description:
    "Rewrite the body of one of your person's own messages in place (author-only: you act as " +
    'them, so their messages and nothing else). The old text is gone everywhere; the message ' +
    'shows an edited mark. Poll messages and deleted messages refuse. Returns the updated message. ' +
    MENTION_GRAMMAR,
  input: z.object({ spaceId: SpaceId, messageId: MessageId, body: z.string().min(1).max(65_536) }),
  output: z.object({ message: Message }),
});

export const deleteMessage = tool({
  name: 'delete_message',
  description:
    "Delete one of your person's own messages (author-only). The body is redacted everywhere; " +
    'the row stays as a tombstone so the thread keeps its shape. Idempotent. Only when asked — ' +
    'this cannot be undone.',
  input: z.object({ spaceId: SpaceId, messageId: MessageId }),
  output: z.object({ message: Message }),
});

export const react = tool({
  name: 'react',
  description:
    'Add or remove an emoji reaction on any message, as your person (one per member per emoji; ' +
    're-adding is a no-op). Pass the emoji character itself ("👍"), never a :name:. Pinning is ' +
    'the 📌 reaction. Returns the message with reactions folded in.',
  input: z.object({
    spaceId: SpaceId,
    messageId: MessageId,
    emoji: ReactionEmoji,
    action: z.enum(['add', 'remove']),
  }),
  output: z.object({ message: Message }),
});

export const votePoll = tool({
  name: 'vote_poll',
  description:
    "Cast or withdraw your person's vote on a poll answer (answerId from the message's poll.answers). " +
    "A vote you cast IS your person's vote — only do it when they told you their choice. " +
    'Single-select polls move the vote; closed polls refuse.',
  input: z.object({
    spaceId: SpaceId,
    messageId: MessageId,
    answerId: z.number().int().min(1),
    action: z.enum(['add', 'remove']),
  }),
  output: z.object({ message: Message }),
});

export const endPoll = tool({
  name: 'end_poll',
  description:
    "Close one of your person's own polls early (author-only). Already-closed polls are a no-op. " +
    'Natural expiry needs no call.',
  input: z.object({ spaceId: SpaceId, messageId: MessageId }),
  output: z.object({ message: Message }),
});

// --- topics (UI: "Discussions") -------------------------------------------------

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
    'Give a thread a title (the UI calls it a Discussion), putting it on the rail. Provide ' +
    'rootMessageId to title an existing thread (use its root, not a reply), or body to post a new ' +
    'root message and title it in one step — exactly one of the two. Titles are goals ' +
    '("Decide: launch cut"), not summaries. At most one topic per thread. Pass documentPath ' +
    "(a live file's path from list_assets) to make the discussion about that file — the UI " +
    'opens it beside the thread. ' +
    MENTION_GRAMMAR,
  input: z.object({
    spaceId: SpaceId,
    rootMessageId: MessageId.optional(),
    title: z.string().min(1).max(256),
    body: z.string().min(1).max(65_536).optional(),
    documentPath: AssetPath.optional(),
  }),
  output: z.object({ topic: Topic, rootMessageId: MessageId }),
});

export const manageTopic = tool({
  name: 'manage_topic',
  description:
    'One-row lifecycle ops on a topic: retitle (needs title), archive (off the rail; a new reply ' +
    'revives it), unarchive, remove (deletes the annotation — the thread and every message stay ' +
    'in the stream untouched; "convert back to thread"), attach_document (needs path: link ONE ' +
    "live space file as what the discussion is about — the topic's documentPath; the UI opens it " +
    'beside the thread; read it with read_asset), or detach_document. None of these can touch a ' +
    'message. Attributed to your person like everything else.',
  input: z.object({
    spaceId: SpaceId,
    topicId: TopicId,
    action: z.enum(['retitle', 'archive', 'unarchive', 'remove', 'attach_document', 'detach_document']),
    title: z.string().min(1).max(256).optional(),
    path: AssetPath.optional(),
  }),
  output: z.object({ topic: Topic }),
});

// --- files --------------------------------------------------------------------

export const readAsset = tool({
  name: 'read_asset',
  description:
    'Read a file in a space. Returns content, current version, and recent change history. ' +
    'Always read before proposing a change; the version you read is your base version. ' +
    'Pass `version` to read an older version (time travel); omit for the current one. ' +
    'Binary files (images, pdfs, uploads) return empty content plus a `blob` {hash, size, mime} — ' +
    'describe them by their metadata; the bytes are not readable over this face.',
  input: z.object({ spaceId: SpaceId, path: AssetPath, version: z.number().int().positive().optional() }),
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
    'record, it can be restored from Trash (restore_asset), and the feed shows who deleted it and why. ' +
    'Declare the baseVersion you last read; "conflict" means it changed meanwhile. Delete conservatively: ' +
    'prefer moving files into folders over deleting when tidying.',
  input: z.object({
    spaceId: SpaceId,
    path: AssetPath,
    baseVersion: z.number().int().positive(),
    /** One line: why this delete. Shown in the feed and in history forever. */
    reason: z.string().min(1).max(1_000),
  }),
  output: DeleteAssetResult,
});

export const restoreAsset = tool({
  name: 'restore_asset',
  description:
    'Bring a deleted file back from Trash at its old path, with its whole history. If several ' +
    'deleted files share the path, the most recently deleted one is restored. Refuses when the ' +
    'path is occupied by a live file — move that one first.',
  input: z.object({
    spaceId: SpaceId,
    path: AssetPath,
    /** One line: why. Shown in the feed and in history forever. */
    reason: z.string().min(1).max(1_000),
  }),
  output: RestoreAssetResult,
});

export const assetHistory = tool({
  name: 'asset_history',
  description:
    "Change history. With path: that file's changes (across renames, and after deletion), newest " +
    "first. Without path: the whole space's change log — every file edit, move, delete, restore, " +
    'with who, why, and when (the feed\'s Activity strand). Page back with beforeOffset. Use ' +
    '`diff` to see what one change altered.',
  input: z.object({
    spaceId: SpaceId,
    path: AssetPath.optional(),
    beforeOffset: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(200).optional(),
  }),
  output: z.object({ changeSets: z.array(ChangeSet) }),
});

export const diff = tool({
  name: 'diff',
  description:
    'A unified diff of a text file between two versions (from < to; from 0 = the file did not ' +
    'exist yet). Versions come from read_asset and asset_history. Answers "what changed in ' +
    'roadmap.md since yesterday" without reading both versions whole.',
  input: z.object({
    spaceId: SpaceId,
    path: AssetPath,
    from: z.number().int().nonnegative(),
    to: z.number().int().positive(),
  }),
  output: z.object({ unified: z.string() }),
});

/**
 * Activity (2026-09-10): the one call behind "what's new for me?". Everything
 * that involves the person across every space and DM, newest first, with the
 * org's read marks saying what is still unread.
 */
export const readActivity = tool({
  name: 'read_activity',
  description:
    "Everything that involves your person, across every space and DM they are in, newest first: " +
    'messages that name them (`mention`), `@here` announcements (`here`), messages in their DMs (`dm`), ' +
    'replies in threads they follow (`reply`), and reactions on their own messages (`reaction`, folded per ' +
    "message and emoji). This is the one call for \"what's new for me?\", \"catch me up\", \"did anyone need " +
    'me?\": call it once (`unread: true` for only what they have not read — the org\'s read marks decide), ' +
    'then summarise by space, name people by displayName, lead with the unread items, and offer to open or ' +
    'reply. Do not walk spaces one by one for this. `truncated` means more: pass `cursor` back to page.',
  input: z.object({
    kinds: z.array(ActivityKind).optional(),
    spaceId: SpaceId.optional(),
    unread: z.boolean().optional(),
    cursor: z.string().optional(),
    limit: z.number().int().positive().max(100).optional(),
  }),
  output: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        kind: ActivityKind,
        spaceId: SpaceId,
        spaceKind: SpaceKind,
        spaceName: z.string(),
        threadRootId: MessageId.optional(),
        message: Message,
        actors: z.array(Attribution.extend({ displayName: z.string() })),
        emoji: z.string().optional(),
        at: z.iso.datetime(),
        unread: z.boolean(),
      }),
    ),
    truncated: z.boolean(),
    cursor: z.string().optional(),
  }),
});

export const mcpTools = [
  whoami,
  listMembers,
  listSpaces,
  openDirect,
  createSpace,
  renameSpace,
  leaveSpace,
  createInvite,
  readStream,
  readThread,
  readActivity,
  searchSpace,
  postMessage,
  editMessage,
  deleteMessage,
  react,
  votePoll,
  endPoll,
  listTopics,
  createTopic,
  manageTopic,
  readAsset,
  proposeChange,
  moveAsset,
  deleteAsset,
  restoreAsset,
  assetHistory,
  diff,
] as const;

/** Tool names whose only effect is reading — no event is appended, nothing is written. */
export const readOnlyMcpToolNames: ReadonlySet<string> = new Set([
  whoami.name,
  listMembers.name,
  listSpaces.name,
  readStream.name,
  readThread.name,
  readActivity.name,
  searchSpace.name,
  listTopics.name,
  readAsset.name,
  assetHistory.name,
  diff.name,
]);
