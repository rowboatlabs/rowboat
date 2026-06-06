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

Your **very next tool call MUST be \`ask-human\`** with options. Do not write any explanation text first. Do not describe a plan. Do not check the workspace boundary. Just call:

\`\`\`
ask-human({
  question: "How should I handle this coding request?",
  options: [
    "Use code mode (Claude Code)",
    "Use code mode (Codex)",
    "Continue with default Rowboat"
  ]
})
\`\`\`

This is non-negotiable. The user gets clickable buttons. Free-text "which agent?" questions are forbidden here.

**Branch on the response:**
- "Use code mode (Claude Code)" → proceed to Step 2 with agent = \`claude\`.
- "Use code mode (Codex)" → proceed to Step 2 with agent = \`codex\`.
- "Continue with default Rowboat" → ABANDON this skill. Handle the request yourself using your own tools (workspace file tools, \`executeCommand\` shell, etc.). The rest of this skill does not apply for this turn.

---

## STEP 2 — Resolve workdir, then run

**Resolve the workdir** (in this priority order):
1. A path the user named in their original message (e.g. \`G:/4th sem/CN\`).
2. The path from a "# User Work Directory" block in your context.
3. Ask once in plain text: "Which folder should I work in?"

**Pick the agent** (\`claude\` or \`codex\`): use the agent from the "# Code Mode (Active)" block (the composer chip) / the Step 1 choice. The chip is authoritative — do NOT carry over a different agent from earlier in this thread, and do NOT switch on an in-chat text request ("use codex"); tell the user to toggle the chip instead.

**State your intent in one line, then call the tool immediately — do NOT wait for a "yes".** The tool's own permission cards are the user's confirmation, so an extra in-chat "reply yes to proceed" is redundant friction. Say something like:

> Using [Claude Code / Codex] to [task description] in \`[folder]\`.

…and then immediately call:

\`\`\`
code_agent_run({
  agent: "<claude|codex>",
  cwd: "<resolved absolute folder>",
  prompt: "<clear, self-contained coding instruction>"
})
\`\`\`

**Writing good prompts for the agent:**
- Be specific: file names, function signatures, expected behavior.
- Mention constraints (language, framework, style).
- Expand short user requests into clear, actionable instructions.

**Follow-ups:** for every later coding request in this chat, just call \`code_agent_run\` again with the same \`cwd\` and the chip's current agent. The session resumes automatically — do NOT start over or re-explain prior context.

---

## STEP 3 — Report results

After \`code_agent_run\` returns:
- Pass through the agent's \`summary\` as-is. Do not rewrite it.
- Refer to file paths as plain text. Do NOT use \`\`\`file:path\`\`\` reference blocks. (This overrides the global "always wrap paths in filepath blocks" rule — for code-mode output, plain text.)
- Only add your own explanation if it failed:
  - \`success: false\` with a message — surface the message. If it mentions the agent isn't installed or signed in, tell the user to install or sign in via **Settings → Code Mode**.
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
