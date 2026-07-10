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
// The two shapes are a discriminated union so the design's rules are
// unrepresentable to break: a model capability MUST carry catalog metadata
// and lazy content and CANNOT carry an eager fragment; an app/always
// capability MUST carry a fragment and never appears in the catalog.
//
// Trust boundary: disk-loaded skills (~/.rowboat/skills, ~/.agents/skills)
// are typed as ModelCapability, so eager prompt fragments and app activation
// are structurally bundled-only powers. A model-activated skill's prose
// lands in conversation because the model chose to read it; a disk file
// injecting into every turn's system prompt would be a standing
// prompt-injection channel.

import { z } from "zod";

export type CapabilityActivation = "model" | "app" | "always";

// THE single source of truth for the app-toggled mode flags. Every key is a
// persisted RequestedAgent.overrides.composition value; defaults make the
// parsed output fully concrete, so the wire shape (all-optional, what turn
// files carry), the resolver's parse result, and the composition context are
// one declaration. Adding a mode = one key here + one record in modes.ts;
// forgetting anything else is a compile error, not a silently-absent prompt
// block. Every key alters system-prompt bytes, so prompt-affecting inputs
// must stay session-sticky (prefix caching).
export const ModeFlags = z.object({
    voiceInput: z.boolean().default(false),
    voiceOutput: z.enum(["summary", "full"]).nullable().default(null),
    searchEnabled: z.boolean().default(false),
    codeMode: z.enum(["claude", "codex"]).nullable().default(null),
    codeCwd: z.string().nullable().default(null),
    videoMode: z.boolean().default(false),
    coachMode: z.boolean().default(false),
});
export type ModeFlags = z.infer<typeof ModeFlags>;

// Inputs an eager fragment may read: the mode flags plus resolved workspace
// context. A fragment must be a pure function of this context so composed
// prompts stay byte-identical for identical inputs (provider prefix caching
// and agent-snapshot inheritance both depend on it).
export interface CapabilityContext extends ModeFlags {
    // Workspace context (workspaceContext trait agents only; the resolver
    // loads these and leaves them null for everyone else).
    agentNotesContext: string | null;
    userWorkDir: string | null;
}

// Model-activated (a "skill"): advertised in the loadSkill catalog, loaded
// by the model's judgment, guidance delivered lazily as a tool result.
export interface ModelCapability {
    id: string;
    // The discriminant; omitted means 'model' (the historical default).
    activation?: "model";
    // Catalog metadata — the loadSkill catalog renders both.
    title: string;
    summary: string;
    // Lazy guidance returned by loadSkill.
    content: string;
    // BuiltinTools keys this capability owns; attached mid-turn on load.
    tools?: string[];
}

// App/always-activated: an eager system-prompt contribution composed at
// assembly time. Bundled-only (see trust boundary above).
export interface EagerCapability {
    id: string;
    activation: "app" | "always";
    // Returns null when the capability contributes nothing for this
    // context. MUST be pure: same context, same bytes.
    promptFragment: (ctx: CapabilityContext) => string | null;
    // BuiltinTools keys this capability owns; attached at assembly.
    tools?: string[];
}

export type CapabilityDefinition = ModelCapability | EagerCapability;

export function isModelActivated(
    def: CapabilityDefinition,
): def is ModelCapability {
    return def.activation === undefined || def.activation === "model";
}
