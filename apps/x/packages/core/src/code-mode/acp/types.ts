// Rowboat-facing types for the ACP code-mode engine. These are intentionally
// decoupled from the raw @agentclientprotocol/sdk schema so the IPC layer (Phase 2)
// and renderer (Phase 3) consume a small, stable surface instead of the full protocol.

export type CodingAgent = 'claude' | 'codex';

// How the permission broker answers an agent's requestPermission, before any
// per-tool "allow for this session" memory is applied.
//   ask                -> surface every gated action to the user
//   auto-approve-reads -> silently allow read-only tool calls, ask for the rest
//   yolo               -> auto-approve everything (the safe, scoped equivalent of
//                         `claude --dangerously-skip-permissions` — our toggle, not a flag)
export type ApprovalPolicy = 'ask' | 'auto-approve-reads' | 'yolo';

// A user's decision for a single permission request.
export type PermissionDecision = 'allow_once' | 'allow_always' | 'reject';

// What we hand to the UI (Phase 3) when the agent asks for permission.
export interface PermissionAsk {
    toolCallId?: string;
    title: string;
    kind?: string; // tool kind, e.g. "edit" | "execute" | "read"
    /** Whether this looks like a read-only action (used by auto-approve-reads). */
    isRead: boolean;
}

// Normalized stream events emitted for a coding run. The renderer renders these;
// the engine maps raw ACP session/update notifications onto this union.
export type CodeRunEvent =
    // role distinguishes the agent's own output from replayed user turns
    // (loadSession streams the whole prior conversation back on resume).
    | { type: 'message'; role: 'agent' | 'user'; text: string }
    | { type: 'thought' }
    | { type: 'tool_call'; id?: string; title?: string; kind?: string; status?: string }
    | { type: 'tool_call_update'; id?: string; status?: string; diffs: string[] }
    | { type: 'plan'; entries: { content: string; status?: string; priority?: string }[] }
    | { type: 'permission'; ask: PermissionAsk; decision: PermissionDecision | 'cancelled'; auto: boolean }
    | { type: 'other'; sessionUpdate: string };

export interface RunPromptResult {
    stopReason: string;
    sessionId: string;
}
