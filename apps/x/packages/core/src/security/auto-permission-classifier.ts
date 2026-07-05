import type { ModelMessage } from "ai";
import z from "zod";
import { ToolPermissionMetadata } from "@x/shared/dist/runs.js";
import { ToolCallPart } from "@x/shared/dist/message.js";
import { captureLlmUsage } from "../analytics/usage.js";
import { withUseCase, type UseCase } from "../analytics/use_case.js";
import { getAutoPermissionDecisionModel, getDefaultModelAndProvider, resolveProviderConfig } from "../models/defaults.js";
import { createLanguageModel } from "../models/models.js";
import { generateObjectSafe } from "../models/structured.js";

const DecisionSchema = z.object({
    decisions: z.array(z.object({
        toolCallId: z.string(),
        decision: z.enum(["allow", "deny"]),
        reason: z.string().min(1),
    })),
});

export type AutoPermissionCandidate = {
    toolCall: z.infer<typeof ToolCallPart>;
    permission: z.infer<typeof ToolPermissionMetadata>;
};

export type AutoPermissionDecision = {
    toolCallId: string;
    decision: "allow" | "deny";
    reason: string;
};

const SYSTEM_PROMPT = `You decide whether a personal productivity app may run tool calls without interrupting the user.

You only receive tool calls that already require permission under deterministic rules.

Allow a tool call only when it is clearly consistent with the user's request and low risk.
Deny tool calls that are destructive, credential-sensitive, privacy-sensitive, broad in scope, likely irreversible, or not clearly requested.

Command examples to deny unless explicitly requested: deleting data, force pushing, deploying, running migrations, changing permissions, reading secrets, exfiltrating tokens, or modifying files outside the user's workspace.
File examples to deny unless explicitly requested: deleting paths, writing outside the workspace, reading secrets or credentials, or broad access to private directories.

Return one decision for every toolCallId. Use the exact toolCallId values provided.`;

function compact(value: unknown, max = 8_000): string {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    if (text.length <= max) return text;
    return `${text.slice(0, max)}\n...<truncated>`;
}

function recentContext(messages: ModelMessage[]): unknown[] {
    return messages.slice(-8).map((message) => {
        if (typeof message.content === "string") {
            return { role: message.role, content: compact(message.content, 2_000) };
        }
        return { role: message.role, content: compact(message.content, 3_000) };
    });
}

function buildPrompt(input: {
    agentName: string | null;
    messages: ModelMessage[];
    candidates: AutoPermissionCandidate[];
}) {
    return compact({
        agentName: input.agentName,
        recentConversation: recentContext(input.messages),
        toolCalls: input.candidates.map(({ toolCall, permission }) => ({
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            arguments: toolCall.arguments,
            permission,
        })),
    }, 24_000);
}

export async function classifyToolPermissions(input: {
    runId: string;
    agentName: string | null;
    messages: ModelMessage[];
    candidates: AutoPermissionCandidate[];
    useCase: UseCase;
    subUseCase?: string | null;
}): Promise<AutoPermissionDecision[]> {
    if (input.candidates.length === 0) return [];

    const modelId = await getAutoPermissionDecisionModel();
    const { provider: providerName } = await getDefaultModelAndProvider();
    const providerConfig = await resolveProviderConfig(providerName);
    const model = createLanguageModel(providerConfig, modelId, { priority: "classifier" });

    const result = await withUseCase(
        {
            useCase: input.useCase,
            subUseCase: "auto_permission_classifier",
            ...(input.agentName ? { agentName: input.agentName } : {}),
        },
        () => generateObjectSafe({
            model,
            system: SYSTEM_PROMPT,
            prompt: buildPrompt(input),
            schema: DecisionSchema,
            retry: true,
        }),
    );

    captureLlmUsage({
        useCase: input.useCase,
        subUseCase: "auto_permission_classifier",
        model: modelId,
        provider: providerName,
        usage: result.usage,
    });

    const allowedIds = new Set(input.candidates.map((candidate) => candidate.toolCall.toolCallId));
    return result.object.decisions.filter((decision) => allowedIds.has(decision.toolCallId));
}
