// The copilot's always-attached toolset. Everything else is skill-scoped:
// skills declare the BuiltinTools they own, and loading a skill attaches its
// tools for the rest of the session. Keep this list small — every entry is
// schema bytes on every single model call, and tool-selection accuracy
// degrades as the attached count grows.
//
// code_agent_run and launch-code-task are here for the legacy code-mode path
// (runs/), which shares buildCopilotAgent and cannot gain tools mid-run;
// revisit once code-mode migrates to the turns runtime.
export const COPILOT_BASE_TOOLS: readonly string[] = [
    "loadSkill",
    "file-getRoot",
    "file-exists",
    "file-list",
    "file-readText",
    "file-glob",
    "file-grep",
    // Attachment reading is a hot path with no skill signal: users drop PDFs,
    // Office docs, and images into chat/calls as path references the model
    // must read immediately.
    "parseFile",
    "LLMParse",
    "web-search",
    "fetch-url",
    "save-to-memory",
    "executeCommand",
    "spawn-agent",
    "code_agent_run",
    "launch-code-task",
];
