// The capability record: the unit of agent assembly. A capability owns what
// it contributes to an agent — lazy guidance the model can pull in, tools,
// and (for app/always activation) an eager system-prompt fragment.
//
// Activation is the axis that distinguishes the historical concepts:
// - 'model'  — today's skills: a catalog line in the prompt; the model calls
//              loadSkill when it recognizes the task; guidance arrives as a
//              tool result and declared tools attach mid-turn.
// - 'app'    — today's modes (voice, video, coach, code): the app toggles a
//              fact about the world; the fragment is composed into the
//              system prompt from token zero and tools attach at assembly.
// - 'always' — unconditional contributions (workspace context traits).
//
// Trust boundary: disk-loaded skills (~/.rowboat/skills, ~/.agents/skills)
// are structurally limited to the 'model' subset — eager prompt fragments
// and app activation are bundled-only powers. A model-activated skill's
// prose lands in conversation because the model chose to read it; a disk
// file injecting into every turn's system prompt would be a standing
// prompt-injection channel.

export type CapabilityActivation = "model" | "app" | "always";

// Inputs an eager fragment may read. All fields mirror persisted
// RequestedAgent.overrides.composition values, resolved before composition —
// a fragment must be a pure function of this context so composed prompts
// stay byte-identical for identical inputs (provider prefix caching and
// agent-snapshot inheritance both depend on it).
export interface CapabilityContext {
    // Workspace context (workspaceContext trait agents only; the resolver
    // loads these and leaves them null for everyone else).
    agentNotesContext: string | null;
    userWorkDir: string | null;
    voiceInput: boolean;
    voiceOutput: "summary" | "full" | null;
    searchEnabled: boolean;
    codeMode: "claude" | "codex" | null;
    codeCwd: string | null;
    videoMode: boolean;
    coachMode: boolean;
}

export interface CapabilityDefinition {
    id: string;
    title: string;
    summary: string;
    // Defaults to 'model' (the historical skill behavior).
    activation?: CapabilityActivation;
    // Lazy guidance returned by loadSkill (model activation).
    content?: string;
    // BuiltinTools keys this capability owns.
    tools?: string[];
    // Eager system-prompt fragment (app/always activation). Returns null
    // when the capability contributes nothing for this context. MUST be
    // pure: same context, same bytes.
    promptFragment?: (ctx: CapabilityContext) => string | null;
}

export function isModelActivated(def: Pick<CapabilityDefinition, "activation">): boolean {
    return def.activation === undefined || def.activation === "model";
}
