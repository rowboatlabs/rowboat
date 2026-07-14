// Builtin tools: memory domain. Entries moved VERBATIM from the historical
// monolith — the merge order in ../builtin-tools.ts preserves the original
// catalog key order (provider-payload bytes; see the key-order test there).

import { z } from "zod";
import * as path from "path";
import * as fs from "fs/promises";
import { WorkDir } from "../../../config/config.js";
import { BuiltinToolsSchema } from "../types.js";


export const memoryTools: z.infer<typeof BuiltinToolsSchema> = {
    'save-to-memory': {
        permission: "none",
        description: "Save a note about the user to the agent memory inbox. Use this when you observe something worth remembering — their preferences, communication patterns, relationship context, scheduling habits, or explicit instructions about how they want things done.",
        inputSchema: z.object({
            note: z.string().describe("The observation or preference to remember. Be specific and concise."),
        }),
        execute: async ({ note }: { note: string }) => {
            const inboxPath = path.join(WorkDir, 'knowledge', 'Agent Notes', 'inbox.md');
            const dir = path.dirname(inboxPath);
            await fs.mkdir(dir, { recursive: true });

            const timestamp = new Date().toISOString();
            const entry = `\n- [${timestamp}] ${note}\n`;

            await fs.appendFile(inboxPath, entry, 'utf-8');

            return {
                success: true,
                message: `Saved to memory: ${note}`,
            };
        },
    },

    // ========================================================================
    // Composio Meta-Tools
    // ========================================================================,
};
