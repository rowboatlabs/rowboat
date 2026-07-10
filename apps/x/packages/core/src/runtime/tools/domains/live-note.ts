// Builtin tools: live-note domain. Entries moved VERBATIM from the historical
// monolith — the merge order in ../builtin-tools.ts preserves the original
// catalog key order (provider-payload bytes; see the key-order test there).

import { z } from "zod";
import { BuiltinToolsSchema } from "../types.js";


export const liveNoteTools: z.infer<typeof BuiltinToolsSchema> = {
    'run-live-note-agent': {
        description: "Manually trigger the live-note agent to run now on a note. Equivalent to the user clicking the Run button in the live-note sidebar, but you can pass extra `context` to bias what the agent does this run — most useful for backfills (e.g. seeding a newly-made-live note from existing synced emails) or focused refreshes. Returns the action taken, summary, and the new note body.",
        inputSchema: z.object({
            filePath: z.string().describe("Workspace-relative path to the note file (e.g., 'knowledge/Notes/my-note.md'). The note must already have a `live:` block in its frontmatter."),
            context: z.string().optional().describe(
                "Optional extra context for the live-note agent to consider for THIS run only — does not modify the note's objective. " +
                "Use it to drive backfills (e.g. 'Backfill from existing synced emails in gmail_sync/ from the last 90 days about this topic') " +
                "or focused refreshes (e.g. 'Focus on changes from the last 7 days'). " +
                "Omit for a plain refresh."
            ),
        }),
        execute: async ({ filePath, context }: { filePath: string; context?: string }) => {
            const knowledgeRelativePath = filePath.replace(/^knowledge\//, '');
            try {
                // Lazy import to break a module-init cycle:
                // builtin-tools → live-note/runner → runs/runs → agents/runtime → builtin-tools
                const { runLiveNoteAgent } = await import("../../../knowledge/live-note/runner.js");
                const result = await runLiveNoteAgent(knowledgeRelativePath, 'manual', context);
                return {
                    success: !result.error,
                    runId: result.runId,
                    action: result.action,
                    summary: result.summary,
                    contentAfter: result.contentAfter,
                    error: result.error,
                };
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return { success: false, error: msg };
            }
        },
    },
};
