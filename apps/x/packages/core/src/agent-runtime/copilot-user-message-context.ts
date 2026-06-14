import { z } from "zod";
import { MessageList, MiddlePaneContext } from "@x/shared/dist/message.js";
import type { UserMessageContextComposer } from "../sessions/user-message-context-composer.js";
import { buildUserMessageContext } from "../agents/compose/user-context.js";

// Real UserMessageContextComposer: stamps each new user message with a fresh
// datetime and (for copilot-like agents) the current middle-pane context, the
// same way the old runtime did at message-dequeue time.
export class CopilotUserMessageContextComposer implements UserMessageContextComposer {
    attach(
        messages: z.infer<typeof MessageList>,
        ctx: {
            agentId: string | null;
            middlePaneContext: z.infer<typeof MiddlePaneContext> | null;
        },
    ): z.infer<typeof MessageList> {
        return messages.map((message) =>
            message.role === "user" && message.userMessageContext === undefined
                ? {
                    ...message,
                    userMessageContext: buildUserMessageContext({
                        agentName: ctx.agentId,
                        middlePaneContext: ctx.middlePaneContext,
                    }),
                }
                : message,
        );
    }
}
