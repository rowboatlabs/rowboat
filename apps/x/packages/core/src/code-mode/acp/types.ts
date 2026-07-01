// Rowboat-facing types for the ACP code-mode engine. The schemas live in
// @x/shared (so the IPC/renderer layers share them); we re-export the inferred
// types here so the engine modules import from one local barrel.
export type {
    CodingAgent,
    ApprovalPolicy,
    PermissionDecision,
    PermissionAsk,
    CodeRunEvent,
    RunPromptResult,
} from '@x/shared/dist/code-mode.js';
