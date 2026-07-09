import { MODE_CAPABILITIES } from "../application/assistant/capabilities/modes.js";
import {
    AGENT_NOTES_CAPABILITY,
    WORK_DIRECTORY_CAPABILITY,
} from "../application/assistant/capabilities/workspace.js";
import type { CapabilityContext } from "../application/assistant/capabilities/types.js";

// Everything that composes into the system prompt, in composition order.
const PROMPT_CAPABILITIES = [
    AGENT_NOTES_CAPABILITY,
    WORK_DIRECTORY_CAPABILITY,
    ...MODE_CAPABILITIES,
] as const;

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
    let composed = `${instructions}\n\n${USER_CONTEXT_SYSTEM_INSTRUCTIONS}`;
    // Capabilities compose in PROMPT_CAPABILITIES order — a fixed total
    // order, so identical inputs yield identical bytes. The fragment text
    // lives with the capability records.
    const ctx: CapabilityContext = {
        agentNotesContext,
        userWorkDir,
        voiceInput,
        voiceOutput,
        searchEnabled,
        codeMode,
        codeCwd,
        videoMode: videoMode ?? false,
        coachMode: coachMode ?? false,
    };
    for (const capability of PROMPT_CAPABILITIES) {
        const fragment = capability.promptFragment?.(ctx);
        if (fragment) {
            composed += `\n\n${fragment}`;
        }
    }
    return composed;
}
