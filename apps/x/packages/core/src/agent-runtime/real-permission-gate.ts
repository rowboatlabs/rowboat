import { z } from "zod";
import { ToolCallPart } from "@x/shared/dist/message.js";
import { ToolPermissionMetadata } from "@x/shared/dist/runs.js";
import type {
    PermissionCheckResult,
    PermissionClassification,
    PermissionGate,
} from "../agent-loop/permission-gate.js";
import type { AgentLoopTurn } from "../agent-loop/types.js";
import type { UseCase } from "../analytics/use_case.js";
import { convertFromMessages } from "../agents/runtime.js";
import { type FileAccessGrant } from "../config/security.js";
import { classifyToolPermissions } from "../security/auto-permission-classifier.js";
import { getToolPermissionMetadata } from "../security/permission-metadata.js";
import { AgentTools } from "./agent-tools.js";

// Session-scoped grants ("allow for this chat") the gate must honor on top of
// the persistent allow-list. The integration layer populates these when a user
// approves with session scope; v1 ships an empty store, so until that layer
// exists every applicable call simply prompts.
export interface SessionGrants {
    commands(sessionId: string | null): Promise<Set<string>>;
    fileAccess(sessionId: string | null): Promise<FileAccessGrant[]>;
}

export class EmptySessionGrants implements SessionGrants {
    async commands(): Promise<Set<string>> {
        return new Set();
    }
    async fileAccess(): Promise<FileAccessGrant[]> {
        return [];
    }
}

type MetadataFn = typeof getToolPermissionMetadata;
type ClassifierFn = typeof classifyToolPermissions;

// Real PermissionGate: deterministic check() via getToolPermissionMetadata, and
// auto-mode classify() via the LLM classifier. The loop owns when to call these
// and what to do with the answer; this only adapts shapes.
export class RealPermissionGate implements PermissionGate {
    private agentTools: AgentTools;
    private grants: SessionGrants;
    private getMetadata: MetadataFn;
    private classifier: ClassifierFn;
    private useCase: UseCase;

    constructor(deps: {
        agentTools: AgentTools;
        sessionGrants?: SessionGrants;
        getMetadata?: MetadataFn;
        classifier?: ClassifierFn;
        useCase?: UseCase;
    }) {
        this.agentTools = deps.agentTools;
        this.grants = deps.sessionGrants ?? new EmptySessionGrants();
        this.getMetadata = deps.getMetadata ?? getToolPermissionMetadata;
        this.classifier = deps.classifier ?? classifyToolPermissions;
        this.useCase = deps.useCase ?? "copilot_chat";
    }

    async check(
        toolCall: z.infer<typeof ToolCallPart>,
        turn: z.infer<typeof AgentLoopTurn>,
    ): Promise<PermissionCheckResult> {
        const attachment = await this.agentTools.attachment(turn.agentId, toolCall.toolName);
        // An unknown tool needs no approval — the runner turns it into an error
        // ToolMessage, and there is nothing meaningful to approve.
        if (!attachment) return { required: false };

        const [commands, fileAccess] = await Promise.all([
            this.grants.commands(turn.sessionId),
            this.grants.fileAccess(turn.sessionId),
        ]);
        const metadata = await this.getMetadata(toolCall, attachment, commands, fileAccess);
        return metadata ? { required: true, request: metadata } : { required: false };
    }

    async classify(
        toolCall: z.infer<typeof ToolCallPart>,
        request: unknown,
        turn: z.infer<typeof AgentLoopTurn>,
    ): Promise<PermissionClassification> {
        // request is what check() persisted — our own metadata; parse to be safe.
        const permission = ToolPermissionMetadata.parse(request);
        const decisions = await this.classifier({
            runId: turn.id,
            agentName: turn.agentId,
            messages: convertFromMessages(turn.messages),
            candidates: [{ toolCall, permission }],
            // Per-turn attribution if the turn carries one; else the gate default.
            useCase: (turn.useCase as UseCase | null) ?? this.useCase,
        });
        const decision = decisions.find((d) => d.toolCallId === toolCall.toolCallId);
        if (!decision) {
            // The classifier declined to rule on this call — fall back to the user.
            return { decision: "abstained", reason: "Classifier returned no decision for this tool call." };
        }
        return {
            decision: decision.decision === "allow" ? "granted" : "denied",
            reason: decision.reason,
        };
    }
}
