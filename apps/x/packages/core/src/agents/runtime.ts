import { ModelMessage } from "ai";
import { Agent } from "@x/shared/dist/agent.js";
import { Message, UserMessageContext } from "@x/shared/dist/message.js";
import { z } from "zod";
import { parse } from "yaml";
import { buildCopilotAgent } from "../application/assistant/agent.js";
import { buildLiveNoteAgent } from "../knowledge/live-note/agent.js";
import { buildBackgroundTaskAgent } from "../background-tasks/agent.js";
import container from "../di/container.js";
import { IAgentsRepo } from "./repo.js";
import { getRaw as getNoteCreationRaw } from "../knowledge/note_creation.js";
import { getRaw as getLabelingAgentRaw } from "../knowledge/labeling_agent.js";
import { getRaw as getNoteTaggingAgentRaw } from "../knowledge/note_tagging_agent.js";
import { getRaw as getInlineTaskAgentRaw } from "../knowledge/inline_task_agent.js";
import { getRaw as getAgentNotesAgentRaw } from "../knowledge/agent_notes_agent.js";

// Runtime-agnostic agent helpers shared across the app after the old agent
// runtime was retired. The new runtime (agent-loop + agent-runtime bridges)
// owns execution; this module keeps only:
//   - loadAgent: resolve an agent's config by id (built-ins + repo fallback)
//   - convertFromMessages: our Message[] -> Vercel AI SDK ModelMessage[]
//   - formatUserMessageContextForLlm: render UserMessageContext as a text prefix
//     (private; used by convertFromMessages)

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

export async function loadAgent(id: string): Promise<z.infer<typeof Agent>> {
    if (id === "copilot" || id === "rowboatx") {
        return buildCopilotAgent();
    }

    if (id === "live-note-agent") {
        return buildLiveNoteAgent();
    }

    if (id === "background-task-agent") {
        return buildBackgroundTaskAgent();
    }

    if (id === 'note_creation') {
        const raw = getNoteCreationRaw();
        let agent: z.infer<typeof Agent> = {
            name: id,
            instructions: raw,
        };

        // Parse frontmatter if present
        if (raw.startsWith("---")) {
            const end = raw.indexOf("\n---", 3);
            if (end !== -1) {
                const fm = raw.slice(3, end).trim();
                const content = raw.slice(end + 4).trim();
                const yaml = parse(fm);
                const parsed = Agent.omit({ name: true, instructions: true }).parse(yaml);
                agent = {
                    ...agent,
                    ...parsed,
                    instructions: content,
                };
            }
        }

        return agent;
    }

    if (id === 'labeling_agent') {
        const labelingAgentRaw = getLabelingAgentRaw();
        let agent: z.infer<typeof Agent> = {
            name: id,
            instructions: labelingAgentRaw,
        };

        if (labelingAgentRaw.startsWith("---")) {
            const end = labelingAgentRaw.indexOf("\n---", 3);
            if (end !== -1) {
                const fm = labelingAgentRaw.slice(3, end).trim();
                const content = labelingAgentRaw.slice(end + 4).trim();
                const yaml = parse(fm);
                const parsed = Agent.omit({ name: true, instructions: true }).parse(yaml);
                agent = {
                    ...agent,
                    ...parsed,
                    instructions: content,
                };
            }
        }

        return agent;
    }

    if (id === 'note_tagging_agent') {
        const noteTaggingAgentRaw = getNoteTaggingAgentRaw();
        let agent: z.infer<typeof Agent> = {
            name: id,
            instructions: noteTaggingAgentRaw,
        };

        if (noteTaggingAgentRaw.startsWith("---")) {
            const end = noteTaggingAgentRaw.indexOf("\n---", 3);
            if (end !== -1) {
                const fm = noteTaggingAgentRaw.slice(3, end).trim();
                const content = noteTaggingAgentRaw.slice(end + 4).trim();
                const yaml = parse(fm);
                const parsed = Agent.omit({ name: true, instructions: true }).parse(yaml);
                agent = {
                    ...agent,
                    ...parsed,
                    instructions: content,
                };
            }
        }

        return agent;
    }

    if (id === 'inline_task_agent') {
        const inlineTaskAgentRaw = getInlineTaskAgentRaw();
        let agent: z.infer<typeof Agent> = {
            name: id,
            instructions: inlineTaskAgentRaw,
        };

        if (inlineTaskAgentRaw.startsWith("---")) {
            const end = inlineTaskAgentRaw.indexOf("\n---", 3);
            if (end !== -1) {
                const fm = inlineTaskAgentRaw.slice(3, end).trim();
                const content = inlineTaskAgentRaw.slice(end + 4).trim();
                const yaml = parse(fm);
                const parsed = Agent.omit({ name: true, instructions: true }).parse(yaml);
                agent = {
                    ...agent,
                    ...parsed,
                    instructions: content,
                };
            }
        }

        return agent;
    }

    if (id === 'agent_notes_agent') {
        const agentNotesAgentRaw = getAgentNotesAgentRaw();
        let agent: z.infer<typeof Agent> = {
            name: id,
            instructions: agentNotesAgentRaw,
        };

        if (agentNotesAgentRaw.startsWith("---")) {
            const end = agentNotesAgentRaw.indexOf("\n---", 3);
            if (end !== -1) {
                const fm = agentNotesAgentRaw.slice(3, end).trim();
                const content = agentNotesAgentRaw.slice(end + 4).trim();
                const yaml = parse(fm);
                const parsed = Agent.omit({ name: true, instructions: true }).parse(yaml);
                agent = {
                    ...agent,
                    ...parsed,
                    instructions: content,
                };
            }
        }

        return agent;
    }

    const repo = container.resolve<IAgentsRepo>('agentsRepo');
    return await repo.fetch(id);
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
                    // New content parts array — collapse to text for LLM
                    const textSegments: string[] = userMessageContextPrefix ? [userMessageContextPrefix] : [];
                    const attachmentLines: string[] = [];

                    for (const part of msg.content) {
                        if (part.type === "attachment") {
                            const sizeStr = part.size ? `, ${formatBytes(part.size)}` : '';
                            const lineStr = part.lineNumber ? ` (line ${part.lineNumber})` : '';
                            attachmentLines.push(`- ${part.filename} (${part.mimeType}${sizeStr}) at ${part.path}${lineStr}`);
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

                    result.push({
                        role: "user",
                        content: textSegments.join("\n"),
                        providerOptions,
                    });
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
