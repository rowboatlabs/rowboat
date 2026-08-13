// Builtin tools: Home command-center domain.

import { z } from "zod";
import { BuiltinToolsSchema } from "../types.js";
import type { HomeThreadsTracker } from "../../../home/threads.js";

export const homeTools: z.infer<typeof BuiltinToolsSchema> = {
    // The operator's sitrep: the same registry feed the Deck and Skipper
    // read, so spoken answers about fleet state come from ground truth.
    "home-status": {
        permission: "none",
        description:
            'Read the live state of the user\'s Home command center: every thread of delegated work (to-do runs, coding lanes, chats) with its status — underway, needs-you, ready (finished work awaiting the user\'s review), or idle — plus a one-line note of what each live thread is doing right now. Use this to answer "what\'s running?", "what needs me?", or "status" from ground truth instead of memory. For the to-do LIST itself (items, receipts), read todo.md instead.',
        inputSchema: z.object({}),
        execute: async () => {
            const { lazyResolve } = await import("../../../di/lazy-resolve.js");
            const tracker = await lazyResolve<HomeThreadsTracker>("homeThreadsTracker");
            const threads = await tracker.snapshot();
            const active = threads.filter(
                (t) => !t.snoozed && (t.status === "underway" || t.status === "needs-you" || t.status === "ready"),
            );
            return {
                counts: {
                    underway: threads.filter((t) => t.status === "underway").length,
                    needsYou: threads.filter((t) => t.status === "needs-you" && !t.snoozed).length,
                    readyForReview: threads.filter((t) => t.status === "ready" && !t.snoozed).length,
                    snoozed: threads.filter((t) => t.snoozed).length,
                    idle: threads.filter((t) => t.status === "idle").length,
                },
                // Only the threads worth speaking about — quiet ones stay a count.
                threads: active.slice(0, 30).map((t) => ({
                    title: t.title,
                    kind: t.kind,
                    status: t.status,
                    ...(t.attention ? { attention: t.attention } : {}),
                    ...(t.activity ? { activity: t.activity } : {}),
                    ...(t.code ? { repo: t.code.projectName, ...(t.code.branch ? { branch: t.code.branch } : {}) } : {}),
                })),
            };
        },
    },
};
