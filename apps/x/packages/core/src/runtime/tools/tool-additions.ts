import type { z } from "zod";
import type { ToolDescriptor } from "@x/shared/dist/turns.js";

// Contract between builtin tools and the tool registries: a builtin whose
// result should extend the turn's toolset (loadSkill attaching a skill's
// declared tools) returns its value with this reserved key. The registry
// wrapper lifts it out of the model-visible output into
// ToolResultData.metadata.toolAdditions, where the turn runtime picks it up
// and records a durable tools_extended event. The legacy runs loop strips the
// key and ignores it (no mid-run tool extension there).
export const TOOL_ADDITIONS_KEY = "$toolAdditions";

export interface ToolAdditions {
    // Human-readable origin for the durable event, e.g. the skill id.
    source: string;
    tools: Array<z.infer<typeof ToolDescriptor>>;
}
