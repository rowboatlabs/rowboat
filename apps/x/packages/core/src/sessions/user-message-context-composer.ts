import { z } from "zod";
import { MessageList, MiddlePaneContext } from "@x/shared/dist/message.js";

// Attaches per-message context (fresh datetime, middle pane) to the new user
// messages of a send. Injected into Sessions so the generic session layer stays
// agent-agnostic and deterministic; the real (copilot) implementation lives in
// agent-runtime, symmetric with the loop's SystemComposer.
export interface UserMessageContextComposer {
    attach(
        messages: z.infer<typeof MessageList>,
        ctx: {
            agentId: string | null;
            middlePaneContext: z.infer<typeof MiddlePaneContext> | null;
        },
    ): z.infer<typeof MessageList>;
}

// Default: attaches nothing. Keeps Sessions usable (and unit tests
// deterministic) without a composer.
export class NoopUserMessageContextComposer implements UserMessageContextComposer {
    attach(messages: z.infer<typeof MessageList>): z.infer<typeof MessageList> {
        return messages;
    }
}
