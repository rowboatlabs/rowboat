// Builtin tools: notifications domain. Entries moved VERBATIM from the historical
// monolith — the merge order in ../builtin-tools.ts preserves the original
// catalog key order (provider-payload bytes; see the key-order test there).

import { z } from "zod";
import container from "../../../di/container.js";
import type { ToolContext } from "../exec-tool.js";
import { getCurrentUseCase } from "../../../analytics/use_case.js";
import type { INotificationService } from "../../../application/notification/service.js";
import { notifyIfEnabled } from "../../../application/notification/notifier.js";
import {
    BuiltinToolsSchema,
} from "./support.js";


export const notificationTools: z.infer<typeof BuiltinToolsSchema> = {
    'notify-user': {
        description: "Show a native OS notification to the user. Clicking the notification opens the provided link in the default browser, or focuses the Rowboat app if no link is given.",
        inputSchema: z.object({
            title: z.string().min(1).max(120).optional().describe("Bold headline shown at the top of the notification. Defaults to 'Rowboat'."),
            message: z.string().min(1).describe("Body text of the notification."),
            link: z.string().url().refine((v) => /^(https?|rowboat):\/\//i.test(v), {
                message: "link must be an http(s):// or rowboat:// URL",
            }).optional().describe("Optional URL opened when the user clicks the notification. Accepts http(s):// (opens in browser) or rowboat:// (opens a view inside Rowboat — see the notify-user skill for deep-link shapes)."),
            actionLabel: z.string().min(1).max(20).optional().describe("Optional label for an inline action button on the notification (e.g. 'Open', 'View', 'Take Notes'). Only shown when `link` is set. Click on the button triggers the same action as clicking the notification body."),
            secondaryActions: z.array(z.object({
                label: z.string().min(1).max(30),
                link: z.string().url().refine((v) => /^(https?|rowboat):\/\//i.test(v), {
                    message: "secondary action link must be an http(s):// or rowboat:// URL",
                }),
            })).max(4).optional().describe("Additional action buttons. macOS shows them in the chevron menu next to the primary button (or all inline in Alert style). Each has its own label and link — clicking the button triggers that link, independent of the primary `link`."),
        }),
        isAvailable: async () => {
            try {
                return container.resolve<INotificationService>('notificationService').isSupported();
            } catch {
                return false;
            }
        },
        execute: async ({ title, message, link, actionLabel, secondaryActions }: { title?: string; message: string; link?: string; actionLabel?: string; secondaryActions?: Array<{ label: string; link: string }> }, ctx?: ToolContext) => {
            try {
                const service = container.resolve<INotificationService>('notificationService');
                if (!service.isSupported()) {
                    return { success: false, error: 'Notifications are not supported on this system' };
                }
                let uc = getCurrentUseCase()?.useCase;
                // ALS doesn't reliably propagate across the run's async generator,
                // so when the in-context use-case is missing, fall back to the
                // persisted use case on the run record via ctx.runId.
                if (!uc && ctx?.runId) {
                    try {
                        const { fetchRun } = await import("../../legacy/runs.js");
                        const run = await fetchRun(ctx.runId);
                        uc = run.useCase;
                    } catch {
                        // best effort — fall through to the default branch
                    }
                }
                if (uc === 'background_task_agent') {
                    // User-configured background agent: gate behind the
                    // background_task category (toggleable), suppress the reopen
                    // flood, and default the deep-link to the background tasks
                    // page if the agent didn't supply its own link.
                    await notifyIfEnabled('background_task', {
                        title,
                        message,
                        link: link ?? 'rowboat://open?type=bg-tasks',
                        actionLabel,
                        secondaryActions,
                        suppressDuringStartupGrace: true,
                        onlyWhenBackground: true,
                    });
                } else {
                    // Regular chat (or any other) agent calling notify-user:
                    // notify directly as before.
                    service.notify({ title, message, link, actionLabel, secondaryActions });
                }
                return { success: true };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },
};
