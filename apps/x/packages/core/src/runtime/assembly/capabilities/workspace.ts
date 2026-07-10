import type { CapabilityContext, EagerCapability } from "./types.js";

// The always-activated workspace-context capabilities: agent notes and the
// user work directory, composed for agents with the workspaceContext trait
// (the resolver loads both inputs and leaves them null for everyone else).
// Two independent records — the composer's own '\n\n' joining makes their
// output byte-identical to the historical fused block. Fragment text
// extracted verbatim from the historical composer; the golden snapshots in
// agents/compose-instructions.test.ts pin the bytes.

export const AGENT_NOTES_CAPABILITY: EagerCapability = {
    id: "agent-notes",
    activation: "always",
    promptFragment: (ctx: CapabilityContext) => ctx.agentNotesContext,
};

export const WORK_DIRECTORY_CAPABILITY: EagerCapability = {
    id: "work-directory",
    activation: "always",
    promptFragment: (ctx: CapabilityContext) =>
        ctx.userWorkDir ? WORK_DIR_TEMPLATE(ctx.userWorkDir) : null,
};

const WORK_DIR_TEMPLATE = (userWorkDir: string): string => `# User Work Directory
The user has chosen the following directory as their current **work directory**:

\`${userWorkDir}\`

Treat this as the **default location** for file operations whenever the user refers to files generically:
- "list the files", "show me what's in here", "what's the latest report" — list or look in the work directory.
- "save this", "export it", "write that to a file" — write the output into the work directory unless the user names another location.
- "open the file I was just working on", "the doc from earlier" — assume the work directory first.

Use absolute paths rooted at this directory with the \`file-*\` tools. For example, list with \`file-list({ path: "${userWorkDir}" })\`, read text with \`file-readText\`, and write text with \`file-writeText\`. For PDFs, Office docs, images, scanned docs, and other non-text files, use \`parseFile\` or \`LLMParse\` with the absolute path; you do NOT need to copy the file into the workspace first.

**Exceptions — these ALWAYS take precedence over the work directory default:**
1. **Knowledge base questions.** If the user asks about anything in the knowledge graph (notes, people, organizations, projects, topics) or paths starting with \`knowledge/\`, use file tools against \`knowledge/\` as documented above. Do NOT redirect those into the work directory.
2. **Explicit paths.** If the user names a different directory or gives an absolute/relative path (e.g. "in ~/Downloads", "from /tmp/foo", "the Desktop"), honor that path exactly and ignore the work-directory default for that request.
3. **Workspace-specific operations.** Anything that obviously belongs in the Rowboat workspace (config files, MCP servers, agent schedules, etc.) stays in the workspace, not the work directory.

Do not announce the work directory unless it's relevant. Just use it.`;
