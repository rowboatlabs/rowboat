// Builtin tools: todo domain (the home to-do list).

import { z } from "zod";
import { BuiltinToolsSchema } from "../types.js";

export const todoTools: z.infer<typeof BuiltinToolsSchema> = {
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
