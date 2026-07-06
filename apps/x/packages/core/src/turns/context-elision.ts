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

// Transmit-time elision of historic tool results (the cross-turn prefix
// only — the current turn's own messages never pass through the resolver, so
// in-flight tool results are always sent verbatim). Large tool outputs from
// earlier turns (skill loads, file reads, HTTP fetches) dominate resent
// context; the model rarely needs them verbatim and can re-run the tool when
// it does. Elision is a pure function of each message's content, so resolved
// prefixes stay byte-stable across calls and turns (provider prefix caches
// keep working), and the durable JSONL log is untouched — only the
// transmitted bytes change.

export interface ToolResultElisionPolicy {
    enabled: boolean;
    thresholdChars: number;
}

export const DEFAULT_ELISION_POLICY: ToolResultElisionPolicy = {
    enabled: true,
    thresholdChars: 10_000,
};

const ContextConfig = z.object({
    elideHistoricToolResults: z.boolean().optional(),
    elideHistoricToolResultsThresholdChars: z.number().int().min(0).optional(),
});

const CONTEXT_CONFIG_PATH = path.join(WorkDir, "config", "context.json");

// Read the elision policy from config/context.json, falling back to defaults
// for missing keys or an unreadable file. Read per resolve so a config edit
// applies to the next turn without a restart.
export function loadElisionPolicy(): ToolResultElisionPolicy {
    try {
        if (!fs.existsSync(CONTEXT_CONFIG_PATH)) {
            return DEFAULT_ELISION_POLICY;
        }
        const raw = fs.readFileSync(CONTEXT_CONFIG_PATH, "utf-8");
        const parsed = ContextConfig.parse(JSON.parse(raw));
        return {
            enabled:
                parsed.elideHistoricToolResults ??
                DEFAULT_ELISION_POLICY.enabled,
            thresholdChars:
                parsed.elideHistoricToolResultsThresholdChars ??
                DEFAULT_ELISION_POLICY.thresholdChars,
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
        return {
            ...message,
            content: `[Tool result elided to save context: "${message.toolName}" returned ${message.content.length} characters in an earlier turn. Call the tool again if you need this output now.]`,
        };
    });
}

// IContextResolver decorator: applies the elision policy to the materialized
// cross-turn prefix. Agent snapshot resolution is delegated untouched.
export class ElidingContextResolver implements IContextResolver {
    private readonly inner: IContextResolver;
    private readonly loadPolicy: () => ToolResultElisionPolicy;

    constructor({
        inner,
        loadPolicy,
    }: {
        inner: IContextResolver;
        loadPolicy?: () => ToolResultElisionPolicy;
    }) {
        this.inner = inner;
        this.loadPolicy = loadPolicy ?? loadElisionPolicy;
    }

    async resolve(
        context: z.infer<typeof TurnContext>,
    ): Promise<Array<z.infer<typeof ConversationMessage>>> {
        const prefix = await this.inner.resolve(context);
        const policy = this.loadPolicy();
        if (!policy.enabled) {
            return prefix;
        }
        return elideHistoricToolResults(prefix, policy.thresholdChars);
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
