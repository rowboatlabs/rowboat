import { MODE_CAPABILITIES } from "../application/assistant/capabilities/modes.js";
import type { CapabilityContext } from "../application/assistant/capabilities/types.js";

// System-prompt composition for agent assembly: the base instructions plus
// the mode blocks (voice, video, coach, search, code) appended per turn
// composition. Extracted verbatim from the legacy streamAgent path so both
// engines compose byte-identical prompts; compose-instructions.test.ts pins
// the output bytes (golden snapshots) that step-by-step restructuring must
// preserve. Pure: callers load agent notes / work dir themselves.

const USER_CONTEXT_SYSTEM_INSTRUCTIONS = `# Hidden User Context
User messages may include a hidden "# User Context" section before "# User Message". Treat it as runtime metadata captured when that specific user message was sent. The actual user-authored text starts under "# User Message".

Use "Current date and time" for temporal reasoning.

If Middle pane context is present, it reflects what the user had open at the time of that specific message and overrides earlier middle-pane references. If the conversation history references a different note or browser page, the user had since closed or navigated away from it. Do not treat earlier context as current.

If Middle pane state is empty, the user was not looking at any relevant note or web page at that point. Answer the user's message on its own merits.

If Middle pane state is note, the supplied path and content are available so you can reference the note when relevant. The user may or may not be talking about this note. Do NOT assume every message is about it. Only reference or act on this note when the user's message clearly relates to it, such as "this note", "what I'm looking at", "here", "above", "below", or questions whose subject is plainly the note's content. For unrelated questions, ignore this note entirely and answer normally. Do not mention that you can see this note unless it is relevant to the answer.

If Middle pane state is browser, only the URL and page title are supplied; the page content itself is NOT included. If you need the page content to answer, use the browser tools available to you to read the page. The user may or may not be talking about this page. Only reference or act on this page when the user's message clearly relates to it, such as "this page", "this article", "what I'm looking at", "this site", or "summarize this". For unrelated questions, ignore this page entirely and answer normally. Do not mention that you can see the browser unless it is relevant to the answer.`;


export interface ComposeSystemInstructionsInput {
    instructions: string;
    agentNotesContext: string | null;
    userWorkDir: string | null;
    voiceInput: boolean;
    voiceOutput: 'summary' | 'full' | null;
    searchEnabled: boolean;
    codeMode: 'claude' | 'codex' | null;
    codeCwd: string | null;
    // Optional so legacy callers (old streamAgent path) are unaffected.
    videoMode?: boolean;
    coachMode?: boolean;
}

// System-prompt assembly, extracted verbatim from streamAgent so the new turn
// runtime's agent resolver composes byte-identical prompts. Pure: callers
// load agent notes / work dir themselves.
export function composeSystemInstructions({
    instructions,
    agentNotesContext,
    userWorkDir,
    voiceInput,
    voiceOutput,
    searchEnabled,
    codeMode,
    codeCwd,
    videoMode,
    coachMode,
}: ComposeSystemInstructionsInput): string {
    let instructionsWithDateTime = `${instructions}\n\n${USER_CONTEXT_SYSTEM_INSTRUCTIONS}`;
        if (agentNotesContext) {
            instructionsWithDateTime += `\n\n${agentNotesContext}`;
        }
        if (userWorkDir) {
                instructionsWithDateTime += `\n\n# User Work Directory
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
        }
        // App-activated mode capabilities compose here, in MODE_CAPABILITIES
        // order — a fixed total order, so identical inputs yield identical
        // bytes. The fragment text lives with the capability records.
        const ctx: CapabilityContext = {
            voiceInput,
            voiceOutput,
            searchEnabled,
            codeMode,
            codeCwd,
            videoMode: videoMode ?? false,
            coachMode: coachMode ?? false,
        };
        for (const capability of MODE_CAPABILITIES) {
            const fragment = capability.promptFragment?.(ctx);
            if (fragment) {
                instructionsWithDateTime += `\n\n${fragment}`;
            }
        }
        return instructionsWithDateTime;
}
