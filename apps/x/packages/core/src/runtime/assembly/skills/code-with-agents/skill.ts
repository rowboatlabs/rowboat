export const skill = String.raw`
# Code with Agents Skill

Use this skill whenever the user asks you to write code, build a project, create scripts, fix bugs, read/explain code, or do any software development task — even simple file creations like "make a .c file".

Coding agents operate on **arbitrary file paths** (including paths outside the Rowboat workspace root, like \`G:/4th sem/CN\` or \`~/projects/foo\`). Do NOT raise "outside workspace" concerns, and do NOT fall back to your own \`executeCommand\` (PowerShell / bash) or workspace file tools to do code work yourself.

All coding work runs through the **\`code_agent_run\`** tool. It launches the selected on-device coding agent (Claude Code / Codex), streams its tool calls, file diffs, and plan into the chat, and surfaces any action needing approval as an inline permission card. One persistent session is kept per chat, so follow-up requests resume with full context automatically.

---

## STEP 1 — MANDATORY FIRST ACTION

Look in your **system context** for a section titled **"# Code Mode (Active)"**.

### Case A — "# Code Mode (Active)" IS present

Code mode is on and the user has selected an agent. Skip directly to Step 2. Do NOT call ask-human.

### Case B — "# Code Mode (Active)" is NOT present

No chip is set, but code mode is enabled (this skill only loads when it is). **Proceed to Step 2 with agent = \`claude\` — do NOT ask.** Coding requests dispatch immediately; a question here is friction, especially on voice. Mention the choice in your one-line narration ("Using Claude Code — toggle the composer's code chip for Codex") and move on. Only if this conversation's earlier coding turns used \`codex\`, stay with \`codex\`.

---

## STEP 2 — Resolve workdir, then run

**Resolve the workdir** (in this priority order):
1. A path the user named in their original message (e.g. \`G:/4th sem/CN\`).
2. The path from a "# User Work Directory" block in your context.
3. **Neither exists → OMIT \`cwd\` entirely.** The run lands in the user's default code repo (their registered project), isolated on its own branch — this is the normal case when the user just says what they want ("take down the overview tab") without naming a folder. Do NOT ask "which folder?" — only if the tool errors that no default repo exists, relay that error (it tells the user how to set one up).

**Pick the agent** (\`claude\` or \`codex\`): use the agent from the "# Code Mode (Active)" block (the composer chip) / the Step 1 choice. The chip is authoritative — do NOT carry over a different agent from earlier in this thread, and do NOT switch on an in-chat text request ("use codex"); tell the user to toggle the chip instead.

**State your intent in one line, then call the tool immediately — do NOT wait for a "yes".** The tool's own permission cards are the user's confirmation, so an extra in-chat "reply yes to proceed" is redundant friction. Say something like:

> Using [Claude Code / Codex] to [task description] in \`[folder]\` — or "in your default repo" when cwd is omitted.

…and then immediately call:

\`\`\`
code_agent_run({
  agent: "<claude|codex>",
  cwd: "<resolved absolute folder — OMIT when unresolved, see above>",
  prompt: "<clear, self-contained coding instruction>"
})
\`\`\`

**Writing good prompts for the agent:**
- Be specific: file names, function signatures, expected behavior.
- Mention constraints (language, framework, style).
- Expand short user requests into clear, actionable instructions.

**Follow-ups:** for every later coding request in this chat, just call \`code_agent_run\` again with the same \`cwd\` (or omitted again, same as the first call) and the chip's current agent. The session resumes automatically — do NOT start over or re-explain prior context.

---

## STEP 3 — Report results

After \`code_agent_run\` returns:
- Pass through the agent's \`summary\` as-is. Do not rewrite it.
- Refer to file paths as plain text. Do NOT use \`\`\`file:path\`\`\` reference blocks. (This overrides the global "always wrap paths in filepath blocks" rule — for code-mode output, plain text.)
- Only add your own explanation if it failed:
  - A tool error with a message — surface the message. If it mentions the agent isn't installed or signed in, tell the user to install or sign in via **Settings → Code Mode**.
  - \`stopReason: "cancelled"\` — the run was stopped; acknowledge briefly and ask if they want to continue.

---

## Once delegating: delegate fully

After Step 2 fires, delegate ALL related coding tasks for this turn to \`code_agent_run\` — writing, editing, reading, debugging, exploring structure, running tests. You are the coordinator; the agent does the work.

## Prerequisites (informational)

The user must have one of these installed locally — these are external tools you cannot install:
- Claude Code — https://claude.ai/code
- Codex — https://codex.openai.com
`;

export default skill;
