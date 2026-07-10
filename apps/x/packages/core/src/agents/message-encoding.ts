// Structural→wire message encoding: converts stored conversation messages
// into AI SDK ModelMessages (user-context weaving, attachment rendering,
// tool-result enveloping). Deterministic per message, so composed requests
// stay byte-stable. Shared by both engines — extracted from the legacy
// engine file so the turn-runtime bridges no longer depend on it.

import { ModelMessage } from "ai";
import { Message, UserMessageContext } from "@x/shared/dist/message.js";
import { z } from "zod";

function formatUserMessageContextForLlm(userMessageContext: z.infer<typeof UserMessageContext>): string {
    const sections: string[] = [];

    if (userMessageContext.currentDateTime) {
        sections.push(`Current date and time: ${userMessageContext.currentDateTime}`);
    }

    if (userMessageContext.middlePane) {
        if (userMessageContext.middlePane.kind === 'empty') {
            sections.push(`Middle pane:\nState: empty`);
        } else if (userMessageContext.middlePane.kind === 'note') {
            sections.push(`Middle pane:\nState: note\nPath: ${userMessageContext.middlePane.path}\n\nContent:\n\`\`\`\n${userMessageContext.middlePane.content}\n\`\`\``);
        } else {
            sections.push(`Middle pane:\nState: browser\nURL: ${userMessageContext.middlePane.url}\nTitle: ${userMessageContext.middlePane.title}`);
        }
    }

    if (sections.length === 0) {
        return '';
    }

    return `# User Context
${sections.join('\n\n')}

# User Message
`;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function convertFromMessages(messages: z.infer<typeof Message>[]): ModelMessage[] {
    const result: ModelMessage[] = [];
    for (const msg of messages) {
        const { providerOptions } = msg;
        switch (msg.role) {
            case "assistant":
                if (typeof msg.content === 'string') {
                    result.push({
                        role: "assistant",
                        content: msg.content,
                        providerOptions,
                    });
                } else {
                    result.push({
                        role: "assistant",
                        content: msg.content.map(part => {
                            switch (part.type) {
                                case 'text':
                                    return part;
                                case 'reasoning':
                                    return part;
                                case 'tool-call':
                                    return {
                                        type: 'tool-call',
                                        toolCallId: part.toolCallId,
                                        toolName: part.toolName,
                                        input: part.arguments,
                                        providerOptions: part.providerOptions,
                                    };
                            }
                        }),
                        providerOptions,
                    });
                }
                break;
            case "system":
                result.push({
                    role: "system",
                    content: msg.content,
                    providerOptions,
                });
                break;
            case "user": {
                const userMessageContextPrefix = msg.userMessageContext ? formatUserMessageContextForLlm(msg.userMessageContext) : '';
                if (typeof msg.content === 'string') {
                    // Legacy string — pass through unchanged
                    result.push({
                        role: "user",
                        content: `${userMessageContextPrefix}${msg.content}`,
                        providerOptions,
                    });
                } else {
                    // New content parts array — collapse text/attachments to text
                    // for the LLM; inline image parts (video-mode webcam and
                    // screen-share frames) are passed through as real multimodal
                    // image parts, grouped under labeled text headers so the
                    // model knows which images show the user vs their screen.
                    const textSegments: string[] = userMessageContextPrefix ? [userMessageContextPrefix] : [];
                    const attachmentLines: string[] = [];
                    type EncodedImagePart = { type: "image"; image: string; mediaType: string };
                    const cameraParts: EncodedImagePart[] = [];
                    const screenParts: EncodedImagePart[] = [];
                    const frameTimes: string[] = [];

                    for (const part of msg.content) {
                        if (part.type === "attachment") {
                            const sizeStr = part.size ? `, ${formatBytes(part.size)}` : '';
                            const lineStr = part.lineNumber ? ` (line ${part.lineNumber})` : '';
                            attachmentLines.push(`- ${part.filename} (${part.mimeType}${sizeStr}) at ${part.path}${lineStr}`);
                        } else if (part.type === "image") {
                            const target = part.source === "screen" ? screenParts : cameraParts;
                            target.push({ type: "image", image: part.data, mediaType: part.mediaType });
                            if (part.capturedAt) frameTimes.push(part.capturedAt);
                        } else {
                            textSegments.push(part.text);
                        }
                    }

                    if (attachmentLines.length > 0) {
                        if (userMessageContextPrefix) {
                            textSegments.push("User has attached the following files:", ...attachmentLines, "");
                        } else {
                            textSegments.unshift("User has attached the following files:", ...attachmentLines, "");
                        }
                    }

                    const imageCount = cameraParts.length + screenParts.length;
                    if (imageCount > 0) {
                        const span = frameTimes.length >= 2
                            ? ` spanning ${frameTimes[0]} to ${frameTimes[frameTimes.length - 1]}`
                            : frameTimes.length === 1
                                ? ` captured at ${frameTimes[0]}`
                                : '';
                        const kinds: string[] = [];
                        if (cameraParts.length > 0) kinds.push(`${cameraParts.length} live webcam frame${cameraParts.length === 1 ? '' : 's'} of the user`);
                        if (screenParts.length > 0) kinds.push(`${screenParts.length} frame${screenParts.length === 1 ? '' : 's'} of the user's shared screen`);
                        textSegments.push(`[Video mode: ${kinds.join(' and ')} attached below, each group oldest to newest,${span ? span + ',' : ''} recorded while they composed this message.]`);
                        const content: Array<{ type: "text"; text: string } | EncodedImagePart> = [
                            { type: "text", text: textSegments.join("\n") },
                        ];
                        if (cameraParts.length > 0) {
                            content.push({ type: "text", text: "Webcam frames (oldest to newest):" }, ...cameraParts);
                        }
                        if (screenParts.length > 0) {
                            content.push({ type: "text", text: "Screen-share frames (oldest to newest):" }, ...screenParts);
                        }
                        result.push({
                            role: "user",
                            content,
                            providerOptions,
                        });
                    } else {
                        result.push({
                            role: "user",
                            content: textSegments.join("\n"),
                            providerOptions,
                        });
                    }
                }
                break;
            }
            case "tool":
                result.push({
                    role: "tool",
                    content: [
                        {
                            type: "tool-result",
                            toolCallId: msg.toolCallId,
                            toolName: msg.toolName,
                            output: {
                                type: "text",
                                value: msg.content,
                            },
                        },
                    ],
                    providerOptions,
                });
                break;
        }
    }
    // doing this because: https://github.com/OpenRouterTeam/ai-sdk-provider/issues/262
    return JSON.parse(JSON.stringify(result));
}
