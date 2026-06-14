import { z } from "zod";
import { MiddlePaneContext, UserMessageContext } from "@x/shared/dist/message.js";

// Per-message context helpers shared by the old runtime and the new composer.
// Datetime + middle-pane ride on the user message (not the system prompt):
// captured fresh when the message is sent, then prepended at model-call time by
// convertFromMessages. Extracted verbatim from agents/runtime.ts.

export function isCopilotLikeAgent(agentName: string | null | undefined): boolean {
    return agentName === "copilot" || agentName === "rowboatx";
}

export function formatCurrentDateTime(now: Date): string {
    return now.toLocaleString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
    });
}

export function toUserMessageContextMiddlePane(
    middlePaneContext: z.infer<typeof MiddlePaneContext> | null,
): z.infer<typeof UserMessageContext>["middlePane"] {
    if (!middlePaneContext) {
        return { kind: "empty" };
    }
    if (middlePaneContext.kind === "note") {
        return {
            kind: "note",
            path: middlePaneContext.path,
            content: middlePaneContext.content,
        };
    }
    return {
        kind: "browser",
        url: middlePaneContext.url,
        title: middlePaneContext.title,
    };
}

export function buildUserMessageContext({
    agentName,
    middlePaneContext,
}: {
    agentName: string | null | undefined;
    middlePaneContext: z.infer<typeof MiddlePaneContext> | null;
}): z.infer<typeof UserMessageContext> {
    return {
        currentDateTime: formatCurrentDateTime(new Date()),
        ...(isCopilotLikeAgent(agentName)
            ? { middlePane: toUserMessageContextMiddlePane(middlePaneContext) }
            : {}),
    };
}

export function formatUserMessageContextForLlm(
    userMessageContext: z.infer<typeof UserMessageContext>,
): string {
    const sections: string[] = [];

    if (userMessageContext.currentDateTime) {
        sections.push(`Current date and time: ${userMessageContext.currentDateTime}`);
    }

    if (userMessageContext.middlePane) {
        if (userMessageContext.middlePane.kind === "empty") {
            sections.push(`Middle pane:\nState: empty`);
        } else if (userMessageContext.middlePane.kind === "note") {
            sections.push(`Middle pane:\nState: note\nPath: ${userMessageContext.middlePane.path}\n\nContent:\n\`\`\`\n${userMessageContext.middlePane.content}\n\`\`\``);
        } else {
            sections.push(`Middle pane:\nState: browser\nURL: ${userMessageContext.middlePane.url}\nTitle: ${userMessageContext.middlePane.title}`);
        }
    }

    if (sections.length === 0) {
        return "";
    }

    return `# User Context
${sections.join("\n\n")}

# User Message
`;
}
