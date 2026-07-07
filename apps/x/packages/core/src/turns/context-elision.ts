import fs from "fs";
import path from "path";
import { z } from "zod";
import type {
    ConversationMessage,
    ResolvedAgent,
    ResolvedAgentSnapshot,
    TurnContext,
} from "@x/shared/dist/turns.js";
import { WorkDir } from "../config/config.js";
import type { IContextResolver } from "./context-resolver.js";
import { TurnRepoContextResolver } from "./context-resolver.js";
import type { ITurnRepo } from "./repo.js";

// Transmit-time elision of historic context (the cross-turn prefix only —
// the current turn's own messages never pass through the resolver, so
// in-flight tool results and just-captured frames are always sent verbatim).
//
// Two policies, both on by default:
//   - Tool results: large tool outputs from earlier turns (skill loads, file
//     reads, HTTP fetches) dominate resent context; the model rarely needs
//     them verbatim and can re-run the tool when it does.
//   - Inline images: video-mode webcam and screen-share frames matter for
//     the response they were captured for; afterwards the assistant's own
//     text carries the takeaway, and fresh frames arrive with every new call
//     message. Unlike tool results they cannot be re-fetched, so the
//     placeholder only records what was there.
//   - Middle-pane note content: every user message sent while a note is
//     open carries a full snapshot of that note in userMessageContext. Only
//     the newest snapshot matters (the system prompt already tells the model
//     later middle-pane context overrides earlier), and the current file is
//     always re-readable at the recorded path.
//
// Elision is a pure function of each message's content, so resolved prefixes
// stay byte-stable across calls and turns (provider prefix caches keep
// working), and the durable JSONL log is untouched — only the transmitted
// bytes change.

export interface ElisionPolicy {
    toolResults: boolean;
    toolResultThresholdChars: number;
    images: boolean;
    middlePaneContent: boolean;
}

// Threshold rationale: ~2,500 chars ≈ 600 tokens. Observed sessions show
// skill bodies at ~5k chars are the most common oversized result, so 10k
// would replay them forever; the head preview plus re-run hint makes the
// lower cut safe. Tunable via config/context.json.
export const DEFAULT_ELISION_POLICY: ElisionPolicy = {
    toolResults: true,
    toolResultThresholdChars: 2_500,
    images: true,
    middlePaneContent: true,
};

// Notes smaller than this stay verbatim in history: below the floor the
// placeholder saves nothing and a short note may carry useful context.
const MIDDLE_PANE_CONTENT_FLOOR_CHARS = 500;

// Head of an elided tool result kept verbatim ahead of the placeholder.
const TOOL_RESULT_PREVIEW_CHARS = 400;

const ContextConfig = z.object({
    elideHistoricToolResults: z.boolean().optional(),
    elideHistoricToolResultsThresholdChars: z.number().int().min(0).optional(),
    elideHistoricImages: z.boolean().optional(),
    elideHistoricMiddlePaneContent: z.boolean().optional(),
});

const CONTEXT_CONFIG_PATH = path.join(WorkDir, "config", "context.json");

// Read the elision policy from config/context.json, falling back to defaults
// for missing keys or an unreadable file. Read per resolve so a config edit
// applies to the next turn without a restart.
export function loadElisionPolicy(): ElisionPolicy {
    try {
        if (!fs.existsSync(CONTEXT_CONFIG_PATH)) {
            return DEFAULT_ELISION_POLICY;
        }
        const raw = fs.readFileSync(CONTEXT_CONFIG_PATH, "utf-8");
        const parsed = ContextConfig.parse(JSON.parse(raw));
        return {
            toolResults:
                parsed.elideHistoricToolResults ??
                DEFAULT_ELISION_POLICY.toolResults,
            toolResultThresholdChars:
                parsed.elideHistoricToolResultsThresholdChars ??
                DEFAULT_ELISION_POLICY.toolResultThresholdChars,
            images:
                parsed.elideHistoricImages ?? DEFAULT_ELISION_POLICY.images,
            middlePaneContent:
                parsed.elideHistoricMiddlePaneContent ??
                DEFAULT_ELISION_POLICY.middlePaneContent,
        };
    } catch {
        return DEFAULT_ELISION_POLICY;
    }
}

export function elideHistoricToolResults(
    messages: Array<z.infer<typeof ConversationMessage>>,
    thresholdChars: number,
): Array<z.infer<typeof ConversationMessage>> {
    return messages.map((message) => {
        if (
            message.role !== "tool" ||
            message.content.length <= thresholdChars
        ) {
            return message;
        }
        // Keep a head preview so the model knows what it is declining to
        // re-fetch (a skill body reads very differently from a web page).
        // Capped at the threshold so tiny thresholds still shrink content.
        const preview = message.content.slice(
            0,
            Math.min(TOOL_RESULT_PREVIEW_CHARS, thresholdChars),
        );
        return {
            ...message,
            content: `${preview}\n[Rest of tool result elided to save context: "${message.toolName}" returned ${message.content.length} characters in an earlier turn. Call the tool again if you need the full output now.]`,
        };
    });
}

export function elideHistoricImages(
    messages: Array<z.infer<typeof ConversationMessage>>,
): Array<z.infer<typeof ConversationMessage>> {
    return messages.map((message) => {
        if (message.role !== "user" || typeof message.content === "string") {
            return message;
        }
        const images = message.content.filter((part) => part.type === "image");
        if (images.length === 0) {
            return message;
        }
        const camera = images.filter((part) => part.source !== "screen").length;
        const screen = images.length - camera;
        const kinds = [
            ...(camera > 0 ? [`${camera} webcam frame${camera === 1 ? "" : "s"}`] : []),
            ...(screen > 0 ? [`${screen} screen-share frame${screen === 1 ? "" : "s"}`] : []),
        ].join(" and ");
        return {
            ...message,
            content: [
                ...message.content.filter((part) => part.type !== "image"),
                {
                    type: "text" as const,
                    text: `[Omitted from history to save context: ${kinds} captured while this message was composed. The assistant saw them when responding to this message.]`,
                },
            ],
        };
    });
}

export function elideHistoricMiddlePaneContent(
    messages: Array<z.infer<typeof ConversationMessage>>,
): Array<z.infer<typeof ConversationMessage>> {
    return messages.map((message) => {
        if (message.role !== "user") {
            return message;
        }
        const middlePane = message.userMessageContext?.middlePane;
        if (
            !middlePane ||
            middlePane.kind !== "note" ||
            middlePane.content.length <= MIDDLE_PANE_CONTENT_FLOOR_CHARS
        ) {
            return message;
        }
        return {
            ...message,
            userMessageContext: {
                ...message.userMessageContext,
                middlePane: {
                    ...middlePane,
                    content: `[Note content (${middlePane.content.length} characters) omitted from history to save context. This snapshot is stale; read the file at the path above if its content is needed now.]`,
                },
            },
        };
    });
}

// IContextResolver decorator: applies the elision policy to the materialized
// cross-turn prefix. Agent snapshot resolution is delegated untouched.
export class ElidingContextResolver implements IContextResolver {
    private readonly inner: IContextResolver;
    private readonly loadPolicy: () => ElisionPolicy;

    constructor({
        inner,
        loadPolicy,
    }: {
        inner: IContextResolver;
        loadPolicy?: () => ElisionPolicy;
    }) {
        this.inner = inner;
        this.loadPolicy = loadPolicy ?? loadElisionPolicy;
    }

    async resolve(
        context: z.infer<typeof TurnContext>,
    ): Promise<Array<z.infer<typeof ConversationMessage>>> {
        let prefix = await this.inner.resolve(context);
        const policy = this.loadPolicy();
        if (policy.toolResults) {
            prefix = elideHistoricToolResults(
                prefix,
                policy.toolResultThresholdChars,
            );
        }
        if (policy.images) {
            prefix = elideHistoricImages(prefix);
        }
        if (policy.middlePaneContent) {
            prefix = elideHistoricMiddlePaneContent(prefix);
        }
        return prefix;
    }

    resolveAgent(
        resolved: z.infer<typeof ResolvedAgentSnapshot>,
    ): Promise<z.infer<typeof ResolvedAgent>> {
        return this.inner.resolveAgent(resolved);
    }
}

// The one context resolver the app should construct (DI container and the
// inspect CLI both use this), so the debug view reproduces the same bytes
// the loop transmits.
export function createContextResolver({
    turnRepo,
}: {
    turnRepo: ITurnRepo;
}): IContextResolver {
    return new ElidingContextResolver({
        inner: new TurnRepoContextResolver({ turnRepo }),
    });
}
