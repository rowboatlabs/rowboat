// Builtin tools: todo domain (the home to-do list).

import { z } from "zod";
import { BuiltinToolsSchema } from "../types.js";

export const todoTools: z.infer<typeof BuiltinToolsSchema> = {
    'todo-add': {
        permission: "none",
        description: "Add items to the user's to-do list (the home surface, todo.md). Use when the user asks to add, track, or remember something as a to-do — e.g. 'add X to my list', 'track this as a to-do'. Items land at the end of the list. Include @rowboat in an item's text ONLY when the user wants it delegated — that starts a background run immediately. Never add items the user didn't ask for.",
        inputSchema: z.object({
            items: z.array(z.object({
                text: z.string().describe("The item's line text, phrased as the user would write it (e.g. 'chase the SOC2 vendor'). Include @rowboat only to delegate."),
                parent: z.string().optional().describe("Line text of an existing top-level item to nest this under as a sub-task. Omit for top-level."),
            })).min(1).describe("The to-dos to add, in order."),
        }),
        execute: async ({ items }: {
            items: { text: string; parent?: string }[];
        }) => {
            try {
                // Lazy imports to break a module-init cycle, mirroring todo-report.
                const { addItem, addSubItem, isDelegated } = await import("../../../todo/fileops.js");
                const { todoBus } = await import("../../../todo/bus.js");
                const added: string[] = [];
                const failed: string[] = [];
                for (const entry of items) {
                    const item = entry.parent
                        ? await addSubItem(entry.parent, entry.text)
                        : await addItem(entry.text);
                    if (!item) {
                        failed.push(`${entry.text} (parent not found: ${entry.parent})`);
                        continue;
                    }
                    added.push(item.text);
                    if (isDelegated(item.text)) {
                        const { runTodoItem } = await import("../../../todo/runner.js");
                        void runTodoItem(item.key).catch(() => {});
                    }
                }
                todoBus.publish({ type: 'list_changed' });
                return { success: failed.length === 0, added, ...(failed.length > 0 ? { failed } : {}) };
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return { success: false, error: msg };
            }
        },
    },
    'todo-report': {
        permission: "none",
        description: "Report the outcome of one delegated item on the user's to-do list (todo.md). Writes a one-line receipt under the item — this is the to-do item agent's ONLY pen on the list; never edit todo.md with file tools. Trust rules: `done` (checks the box) is only for internal/read-only work; anything outward-facing (sending email, posting) stops at `ready` with the prepared draft linked — the user's check is the approval.",
        inputSchema: z.object({
            item: z.string().describe("The item's line text, exactly as given in your run message."),
            parent: z.string().optional().describe("When the item is a sub-item, its parent's line text — given as **Part of:** in your run message. Omit for top-level items."),
            status: z.enum(['done', 'ready', 'needs_user']).describe(
                "`done` — internal work fully finished; the box gets checked. `ready` — output prepared, needs the user's sign-off (ALWAYS the terminal status for outward-facing work); box stays open. `needs_user` — you need input only the user can give; the summary is your ONE specific question."
            ),
            summary: z.string().describe("One short sentence, shown verbatim on the list. What happened and where the output is — or, for needs_user, the question itself (e.g. 'Which template should the deck use?')."),
            links: z.array(z.object({
                label: z.string().describe("Short human label, e.g. 'Pricing research'."),
                path: z.string().optional().describe("Workspace-relative path for notes/files (e.g. 'knowledge/Topics/sso-demand.md')."),
                url: z.string().optional().describe("URL for web links."),
            })).optional().describe("Links to the work products this run made — how the user finds your output."),
        }),
        execute: async ({ item, parent, status, summary, links }: {
            item: string;
            parent?: string;
            status: 'done' | 'ready' | 'needs_user';
            summary: string;
            links?: { label: string; path?: string; url?: string }[];
        }) => {
            try {
                // Lazy import to break a module-init cycle, mirroring run-live-note-agent.
                const { attachReceipt, subKey } = await import("../../../todo/fileops.js");
                const { todoBus } = await import("../../../todo/bus.js");
                const key = parent ? subKey(parent, item) : item;
                const receipt = status === 'needs_user'
                    ? { kind: 'question' as const, text: summary, links: [] }
                    : { kind: 'result' as const, text: summary, links: links ?? [] };
                const attached = await attachReceipt(key, receipt, { check: status === 'done' });
                todoBus.publish({ type: 'list_changed' });
                if (!attached) {
                    return { success: true, note: 'The item was removed from the list mid-run — treat it as dismissed and stop.' };
                }
                return { success: true };
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return { success: false, error: msg };
            }
        },
    },
};
