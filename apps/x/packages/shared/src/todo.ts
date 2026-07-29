import z from 'zod';

// ---------------------------------------------------------------------------
// Todo (the home to-do list)
// ---------------------------------------------------------------------------
//
// One rolling markdown file at `~/.rowboat/todo.md` shared between the user
// and @rowboat. Everything durable lives in the file — there is no sidecar
// state, no hidden anchors. GFM task lines are items; typing `@rowboat` in a
// line delegates it; when a run finishes, the agent's outcome is appended as
// an indented "receipt" line under the item:
//
//   - [x] @rowboat research pricing models
//     - → [Pricing research](knowledge/Topics/pricing.md) — 9 tools compared
//   - [ ] @rowboat draft replies to investor emails
//     - → needs you: reply to Maya first, or wait for the call?
//
// Items are identified by their normalized line text (`key`) — good enough
// for the short window of a run; if the user deletes or rewrites a line
// mid-run, the receipt is dropped (delete = dismiss). Completed items are
// archived to `todo/archive/<YYYY-MM>.md` with receipts intact.
//
// Ephemeral run state (working spinners) is never written to the file — the
// renderer overlays it from push events.
//
// Hand-written types — single source of truth (see live-note.ts for why we
// don't `z.infer` here).
// ---------------------------------------------------------------------------

/** A link inside a receipt — exactly one of `path` (workspace-relative) or
 * `url` is set. */
export type TodoLink = {
    label: string;
    path?: string;
    url?: string;
};

/**
 * Receipt kinds:
 * - `result`   — what the agent did, with links to the work products
 * - `question` — the agent needs the user ("needs you: …"); box stays open
 * - `error`    — the run failed ("failed: …"); box stays open
 */
export type TodoReceiptKind = 'result' | 'question' | 'error';

export type TodoReceipt = {
    kind: TodoReceiptKind;
    /** Summary / question / error text, without the arrow marker or links. */
    text: string;
    links: TodoLink[];
};

export type TodoItem = {
    /** Normalized line text — the item's identity for runs and push events.
     * Sub-items are scoped: `<parent key> :: <normalized sub text>`. */
    key: string;
    /** Raw line text after the checkbox (includes any @rowboat mention). */
    text: string;
    checked: boolean;
    /** True when the text mentions @rowboat. */
    delegated: boolean;
    /** True when the planner suggested this item ("(via rowboat)" marker on
     * the line). Proposed items never self-start — the user's go is the run
     * chip. */
    proposed?: boolean;
    receipts: TodoReceipt[];
    /** Sub-items — one level only; a sub-item's children are always empty.
     * Each is a full item: own thread, receipts, delegation. */
    children: TodoItem[];
};

/** The file, block by block: task items (with their receipts) plus every
 * other line preserved verbatim so hand edits survive round-trips. */
export type TodoBlock =
    | { kind: 'item'; item: TodoItem }
    | { kind: 'raw'; text: string };

export type TodoList = {
    blocks: TodoBlock[];
};

/**
 * One bubble in the compact conversation view of an item's session — derived
 * from the session's turns (each turn's user message + the agent's final
 * reply), never stored. `error` kind marks failed/stopped turns.
 */
export type TodoChatBubble = {
    role: 'user' | 'rowboat';
    text: string;
    kind?: 'error';
    /** todo-report links from the turn — the artifacts, as buttons. */
    links: TodoLink[];
};

/** Push events for the renderer (todo:events channel). `key` identifies the
 * item; `list_changed` means "re-fetch the file". */
export type TodoEventType =
    | { type: 'run_start'; key: string }
    | { type: 'run_complete'; key: string; summary?: string }
    | { type: 'run_error'; key: string; error: string }
    | { type: 'list_changed' };

export const TodoLinkSchema = z.object({
    label: z.string(),
    path: z.string().optional(),
    url: z.string().optional(),
});

export const TodoReceiptKindSchema = z.enum(['result', 'question', 'error']);

export const TodoReceiptSchema = z.object({
    kind: TodoReceiptKindSchema,
    text: z.string(),
    links: z.array(TodoLinkSchema),
});

export const TodoItemSchema: z.ZodType<TodoItem> = z.lazy(() => z.object({
    key: z.string(),
    text: z.string(),
    checked: z.boolean(),
    delegated: z.boolean(),
    proposed: z.boolean().optional(),
    receipts: z.array(TodoReceiptSchema),
    // Depth (one level) is enforced by the parser, not the schema.
    children: z.array(TodoItemSchema),
}));

export const TodoBlockSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('item'), item: TodoItemSchema }),
    z.object({ kind: z.literal('raw'), text: z.string() }),
]);

export const TodoListSchema = z.object({
    blocks: z.array(TodoBlockSchema),
});

export const TodoChatBubbleSchema = z.object({
    role: z.enum(['user', 'rowboat']),
    text: z.string(),
    kind: z.literal('error').optional(),
    links: z.array(TodoLinkSchema),
});

export const TodoEvent = z.discriminatedUnion('type', [
    z.object({ type: z.literal('run_start'), key: z.string() }),
    z.object({ type: z.literal('run_complete'), key: z.string(), summary: z.string().optional() }),
    z.object({ type: z.literal('run_error'), key: z.string(), error: z.string() }),
    z.object({ type: z.literal('list_changed') }),
]);
