import fs from "fs";
import path from "path";
import { z } from "zod";
import { CodeMode, VoiceOutputMode } from "@x/shared/dist/message.js";
import { WorkDir } from "../../config/config.js";
import { isCopilotLikeAgent } from "./user-context.js";

// System-prompt assembly shared by the old runtime and the new SystemComposer.
// The system prompt is composed fresh per model call: agent instructions +
// hidden-user-context explainer + (copilot-only) agent notes & work dir +
// per-turn voice/search/code-mode blocks. Extracted verbatim from
// agents/runtime.ts so both runtimes produce byte-identical prompts.

const AGENT_NOTES_DIR = path.join(WorkDir, "knowledge", "Agent Notes");

// Work directory is scoped per chat. Each chat gets its own sidecar config file
// so setting it in one chat does not leak into others.
export function workDirConfigFile(id: string): string {
    return path.join(WorkDir, "config", `workdir-${id}.json`);
}

export function loadUserWorkDir(id: string): string | null {
    try {
        const file = workDirConfigFile(id);
        if (!fs.existsSync(file)) return null;
        const raw = fs.readFileSync(file, "utf-8");
        const parsed = JSON.parse(raw) as { path?: unknown };
        const value = typeof parsed.path === "string" ? parsed.path.trim() : "";
        return value || null;
    } catch {
        return null;
    }
}

export function loadAgentNotesContext(): string | null {
    const sections: string[] = [];

    const userFile = path.join(AGENT_NOTES_DIR, "user.md");
    const prefsFile = path.join(AGENT_NOTES_DIR, "preferences.md");

    try {
        if (fs.existsSync(userFile)) {
            const content = fs.readFileSync(userFile, "utf-8").trim();
            if (content) {
                sections.push(`## About the User\nThese are notes you took about the user in previous chats.\n\n${content}`);
            }
        }
    } catch { /* ignore */ }

    try {
        if (fs.existsSync(prefsFile)) {
            const content = fs.readFileSync(prefsFile, "utf-8").trim();
            if (content) {
                sections.push(`## User Preferences\nThese are notes you took on their general preferences.\n\n${content}`);
            }
        }
    } catch { /* ignore */ }

    // List other Agent Notes files for on-demand access
    const otherFiles: string[] = [];
    const skipFiles = new Set(["user.md", "preferences.md", "inbox.md"]);
    try {
        if (fs.existsSync(AGENT_NOTES_DIR)) {
            const listMdFiles = (dir: string, prefix: string): void => {
                for (const entry of fs.readdirSync(dir)) {
                    const fullPath = path.join(dir, entry);
                    const stat = fs.statSync(fullPath);
                    if (stat.isDirectory()) {
                        listMdFiles(fullPath, `${prefix}${entry}/`);
                    } else if (entry.endsWith(".md") && !skipFiles.has(`${prefix}${entry}`)) {
                        otherFiles.push(`${prefix}${entry}`);
                    }
                }
            };
            listMdFiles(AGENT_NOTES_DIR, "");
        }
    } catch { /* ignore */ }

    if (otherFiles.length > 0) {
        sections.push(`## More Specific Preferences\nFor more specific preferences, you can read these files using file-readText. Only read them when relevant to the current task.\n\n${otherFiles.map(f => `- knowledge/Agent Notes/${f}`).join("\n")}`);
    }

    if (sections.length === 0) return null;
    return `# Agent Memory\n\n${sections.join("\n\n")}`;
}

const USER_CONTEXT_SYSTEM_INSTRUCTIONS = `# Hidden User Context
User messages may include a hidden "# User Context" section before "# User Message". Treat it as runtime metadata captured when that specific user message was sent. The actual user-authored text starts under "# User Message".

Use "Current date and time" for temporal reasoning.

If Middle pane context is present, it reflects what the user had open at the time of that specific message and overrides earlier middle-pane references. If the conversation history references a different note or browser page, the user had since closed or navigated away from it. Do not treat earlier context as current.

If Middle pane state is empty, the user was not looking at any relevant note or web page at that point. Answer the user's message on its own merits.

If Middle pane state is note, the supplied path and content are available so you can reference the note when relevant. The user may or may not be talking about this note. Do NOT assume every message is about it. Only reference or act on this note when the user's message clearly relates to it, such as "this note", "what I'm looking at", "here", "above", "below", or questions whose subject is plainly the note's content. For unrelated questions, ignore this note entirely and answer normally. Do not mention that you can see this note unless it is relevant to the answer.

If Middle pane state is browser, only the URL and page title are supplied; the page content itself is NOT included. If you need the page content to answer, use the browser tools available to you to read the page. The user may or may not be talking about this page. Only reference or act on this page when the user's message clearly relates to it, such as "this page", "this article", "what I'm looking at", "this site", or "summarize this". For unrelated questions, ignore this page entirely and answer normally. Do not mention that you can see the browser unless it is relevant to the answer.`;

function workDirBlock(userWorkDir: string): string {
    return `\n\n# User Work Directory
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

const VOICE_INPUT_BLOCK = `\n\n# Voice Input\nThe user's message was transcribed from speech. Be aware that:\n- There may be transcription errors. Silently correct obvious ones (e.g. homophones, misheard words). If an error is genuinely ambiguous, briefly mention your interpretation (e.g. "I'm assuming you meant X").\n- Spoken messages are often long-winded. The user may ramble, repeat themselves, or correct something they said earlier in the same message. Focus on their final intent, not every word verbatim.`;

const VOICE_OUTPUT_SUMMARY_BLOCK = `\n\n# Voice Output (MANDATORY — READ THIS FIRST)\nThe user has voice output enabled. THIS IS YOUR #1 PRIORITY: you MUST start your response with <voice></voice> tags. If your response does not begin with <voice> tags, the user will hear nothing — which is a broken experience. NEVER skip this.\n\nRules:\n1. YOUR VERY FIRST OUTPUT MUST BE A <voice> TAG. No exceptions. Do not start with markdown, headings, or any other text. The literal first characters of your response must be "<voice>".\n2. Place ALL <voice> tags at the BEGINNING of your response, before any detailed content. Do NOT intersperse <voice> tags throughout the response.\n3. Wrap EACH spoken sentence in its own separate <voice> tag so it can be spoken incrementally. Do NOT wrap everything in a single <voice> block.\n4. Use voice as a TL;DR and navigation aid — do NOT read the entire response aloud.\n5. After all <voice> tags, you may include detailed written content (markdown, tables, code, etc.) that will be shown visually but not spoken.\n\n## Examples\n\nExample 1 — User asks: "what happened in my meeting with Alex yesterday?"\n\n<voice>Your meeting with Alex covered three main things: the Q2 roadmap timeline, hiring for the backend role, and the client demo next week.</voice>\n<voice>I've pulled out the key details and action items below — the demo prep notes are at the end.</voice>\n\n## Meeting with Alex — March 11\n### Roadmap\n- Agreed to push Q2 launch to April 15...\n(detailed written content continues)\n\nExample 2 — User asks: "summarize my emails"\n\n<voice>You have five new emails since this morning.</voice>\n<voice>Two are from your team — Jordan sent the RFC you requested and Taylor flagged a contract issue.</voice>\n<voice>There's also a warm intro from a VC partner connecting you with someone at a prospective customer.</voice>\n<voice>I've drafted responses for three of them. The details and drafts are below.</voice>\n\n(email blocks, tables, and detailed content follow)\n\nExample 3 — User asks: "what's on my calendar today?"\n\n<voice>You've got a pretty packed day — seven meetings starting with standup at 9.</voice>\n<voice>The big ones are your investor call at 11, lunch with a partner from your lead VC at 12:30, and a customer call at 4.</voice>\n<voice>Your only free block for deep work is 2:30 to 4.</voice>\n\n(calendar block with full event details follows)\n\nExample 4 — User asks: "draft an email to Sam with our metrics"\n\n<voice>Done — I've drafted the email to Sam with your latest WAU and churn numbers.</voice>\n<voice>Take a look at the draft below and send it when you're ready.</voice>\n\n(email block with draft follows)\n\nREMEMBER: If you do not start with <voice> tags, the user hears silence. Always speak first, then write.`;

const VOICE_OUTPUT_FULL_BLOCK = `\n\n# Voice Output — Full Read-Aloud (MANDATORY — READ THIS FIRST)\nThe user wants your ENTIRE response spoken aloud. THIS IS YOUR #1 PRIORITY: every single sentence must be wrapped in <voice></voice> tags. If you write anything outside <voice> tags, the user will not hear it — which is a broken experience. NEVER skip this.\n\nRules:\n1. YOUR VERY FIRST OUTPUT MUST BE A <voice> TAG. No exceptions. The literal first characters of your response must be "<voice>".\n2. Wrap EACH sentence in its own separate <voice> tag so it can be spoken incrementally.\n3. Write your response in a natural, conversational style suitable for listening — no markdown headings, bullet points, or formatting symbols. Use plain spoken language.\n4. Structure the content as if you are speaking to the user directly. Use transitions like "first", "also", "one more thing" instead of visual formatting.\n5. EVERY sentence MUST be inside a <voice> tag. Do not leave ANY content outside <voice> tags. If it's not in a <voice> tag, the user cannot hear it.\n\n## Examples\n\nExample 1 — User asks: "what happened in my meeting with Alex yesterday?"\n\n<voice>Your meeting with Alex covered three main things.</voice>\n<voice>First, you discussed the Q2 roadmap timeline and agreed to push the launch to April.</voice>\n<voice>Second, you talked about hiring for the backend role — Alex will send over two candidates by Friday.</voice>\n<voice>And lastly, the client demo is next week on Thursday at 2pm, and you're handling the intro slides.</voice>\n\nExample 2 — User asks: "summarize my emails"\n\n<voice>You've got five new emails since this morning.</voice>\n<voice>Two are from your team — Jordan sent the RFC you asked for, and Taylor flagged a contract issue that needs your sign-off.</voice>\n<voice>There's a warm intro from a VC partner connecting you with an engineering lead at a potential customer.</voice>\n<voice>And someone from a prospective client wants to confirm your API tier before your call this afternoon.</voice>\n<voice>I've drafted replies for three of them — the metrics update, the intro, and the API question.</voice>\n<voice>The only one I left for you is Taylor's contract redline, since that needs your judgment on the liability cap.</voice>\n\nExample 3 — User asks: "what's on my calendar today?"\n\n<voice>You've got a packed day — seven meetings starting with standup at 9.</voice>\n<voice>The highlights are your investor call at 11, lunch with a VC partner at 12:30, and a customer call at 4.</voice>\n<voice>Your only open block for deep work is 2:30 to 4, so plan accordingly.</voice>\n<voice>Oh, and your 1-on-1 with your co-founder is at 5:30 — that's a walking meeting.</voice>\n\nExample 4 — User asks: "how are our metrics looking?"\n\n<voice>Metrics are looking strong this week.</voice>\n<voice>You hit 2,573 weekly active users, which is up 12% week over week.</voice>\n<voice>That means you've crossed the 2,500 milestone — worth calling out in your next investor update.</voice>\n<voice>Churn is down to 4.1%, improving month over month.</voice>\n<voice>The trailing 8-week compound growth rate is about 10%.</voice>\n\nREMEMBER: Start with <voice> immediately. No preamble, no markdown before it. Speak first.`;

const SEARCH_BLOCK = `\n\n# Search\nThe user has requested a search. Use the web-search tool to answer their query.`;

function codeModeBlock(codeMode: z.infer<typeof CodeMode>): string {
    const agentDisplay = codeMode === "claude" ? "Claude Code" : "Codex";
    return `\n\n# Code Mode (Active) — Agent: ${agentDisplay}
The user has turned on **code mode** and the composer chip is set to **${agentDisplay}** (\`${codeMode}\`). For EVERY coding task this turn, use **${agentDisplay}**, and narrate that agent ("Using ${agentDisplay} to …").

The chip is the single source of truth for which agent runs:
- Do NOT carry over a different agent from earlier in this thread — even if a previous run used the other agent, use **${agentDisplay}** now.
- Do NOT switch agents based on an in-chat text request ("use codex", "switch to claude"). The agent only changes when the user toggles the chip; if they ask in chat, tell them to toggle the chip.

**How to run coding work — call the \`code_agent_run\` tool** with:
- \`agent\`: \`${codeMode}\` (always — match the chip).
- \`cwd\`: the absolute project/working directory (resolve it per the code-with-agents skill — a path the user named, the "# User Work Directory" block, or ask once).
- \`prompt\`: a clear, self-contained coding instruction.

The tool runs the agent on-device and streams its tool calls, file diffs, and plan into the chat; any action needing approval surfaces as an inline permission card, so you do NOT pre-confirm with an in-chat "reply yes". This chat keeps ONE persistent agent session, so follow-up coding requests automatically resume with full context — just call \`code_agent_run\` again. Do NOT shell out to \`acpx\` or \`executeCommand\` for coding, and do NOT fall back to your own file tools.

If the user's message is clearly NOT a coding request (small talk, an unrelated question), answer directly without invoking the coding agent. Code mode signals readiness, not that every message must route through the agent.`;
}

// Assembles the full system prompt. workDirId is the chat scope used to look up
// a per-chat work directory (runId in the old runtime, sessionId in the new);
// null skips the work-dir block.
export function buildSystemInstructions(opts: {
    instructions: string;
    agentName: string | null | undefined;
    workDirId: string | null;
    voiceInput?: boolean;
    voiceOutput?: z.infer<typeof VoiceOutputMode> | null;
    searchEnabled?: boolean;
    codeMode?: z.infer<typeof CodeMode> | null;
}): string {
    let out = `${opts.instructions}\n\n${USER_CONTEXT_SYSTEM_INSTRUCTIONS}`;

    if (isCopilotLikeAgent(opts.agentName)) {
        const notes = loadAgentNotesContext();
        if (notes) out += `\n\n${notes}`;
        const userWorkDir = opts.workDirId ? loadUserWorkDir(opts.workDirId) : null;
        if (userWorkDir) out += workDirBlock(userWorkDir);
    }

    if (opts.voiceInput) out += VOICE_INPUT_BLOCK;
    if (opts.voiceOutput === "summary") out += VOICE_OUTPUT_SUMMARY_BLOCK;
    else if (opts.voiceOutput === "full") out += VOICE_OUTPUT_FULL_BLOCK;
    if (opts.searchEnabled) out += SEARCH_BLOCK;
    if (opts.codeMode) out += codeModeBlock(opts.codeMode);

    return out;
}
