export const skill = String.raw`
# Code with Agents Skill

Use this skill whenever the user asks you to write code, build a project, create scripts, fix bugs, read/explain code, or do any software development task — even simple file creations like "make a .c file".

Coding agents operate on **arbitrary file paths** (including paths outside the Rowboat workspace root, like \`G:/4th sem/CN\` or \`~/projects/foo\`). Do NOT raise "outside workspace" concerns, and do NOT fall back to your own \`executeCommand\` (PowerShell / bash) or workspace file tools to do code work yourself.

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

## STEP 2 — Resolve workdir, confirm, execute

**Resolve the workdir** (in this priority order):
1. A path the user named in their original message (e.g. \`G:/4th sem/CN\`).
2. The path from a "# User Work Directory" block in your context.
3. Ask once in plain text: "Which folder should I work in?"

**State your intent in one line, then execute immediately — do NOT wait for a "yes".** The \`executeCommand\` call surfaces a permission card that is itself the user's confirmation, so an extra in-chat "reply yes to proceed" is redundant friction. Say something like:

> Using [Claude Code / Codex] to [task description] in \`[folder]\`.

…and then immediately make the \`executeCommand\` call in the same turn.

**Execute** with the chosen agent using a **persistent named session** so follow-up coding requests in this chat resume the same agent and keep context.

Pick \`<agent>\` (\`claude\` or \`codex\`) by, in priority order:
- An explicit in-chat override from the user this turn ("use codex", "switch to claude") — honor it.
- The agent chosen in Step 1 / the "# Code Mode (Active)" block.

Pick \`<session-name>\` — **stable for this whole chat**:
- If the "# Code Mode (Active)" block gives a session name (e.g. \`rowboat-<runId>\`), use that exact name.
- Otherwise pick one short, kebab-case name and **reuse it for every coding call this turn and in follow-ups** — never a new name each time.

**\`-s\` resumes an existing session; it does NOT create one.** So create the session once at the start, then prompt:

**1. First coding action in this chat — create the session:**

\`\`\`
npx acpx@latest --approve-all --cwd <folder> <agent> sessions new --name <session-name>
\`\`\`

**2. Then run the prompt:**

\`\`\`
npx acpx@latest --approve-all --cwd <folder> <agent> -s <session-name> "<prompt>"
\`\`\`

**3. Every follow-up coding request in this chat — reuse the same session (do NOT create again):**

\`\`\`
npx acpx@latest --approve-all --cwd <folder> <agent> -s <session-name> "<prompt>"
\`\`\`

Do NOT use \`exec\` — it is one-shot and forgets everything.

Concrete example:

\`\`\`
# First coding message in the chat — create, then prompt:
npx acpx@latest --approve-all --cwd "G:\\Blogging\\myblog" claude sessions new --name diskspace-check
npx acpx@latest --approve-all --cwd "G:\\Blogging\\myblog" claude -s diskspace-check "Check the system disk space and report total, used, and free space."

# Follow-up in the same chat — reuse the session, no create:
npx acpx@latest --approve-all --cwd "G:\\Blogging\\myblog" claude -s diskspace-check "Summarize what we did and the final findings."
\`\`\`

### Critical: flag order

\`--approve-all\` and \`--cwd\` are GLOBAL flags and MUST appear BEFORE the agent name. \`sessions new --name <name>\` and \`-s <session-name>\` come AFTER the agent name:

- ✓ Correct: \`npx acpx@latest --approve-all --cwd <folder> <agent> -s <session-name> "<prompt>"\`
- ✗ Wrong:  \`npx acpx@latest <agent> --approve-all -s <name> "..."\` (will fail)

### Writing good prompts for the agent

- Be specific: file names, function signatures, expected behavior.
- Mention constraints (language, framework, style).
- Expand short user requests into clear, actionable prompts.

---

## STEP 3 — Report results

After the command finishes:
- Pass through the coding agent's summary as-is. Do not rewrite.
- Refer to file paths as plain text. Do NOT use \`\`\`file:path\`\`\` reference blocks. (This overrides the global "always wrap paths in filepath blocks" rule — for code-mode output, plain text.)
- Only add your own explanation if the command failed (non-zero exit):
  - Exit code 5 — permissions were denied (shouldn't happen with \`--approve-all\`; flag it).
  - Exit code 4 / "No acpx session found" — the \`-s <session-name>\` session doesn't exist yet. Create it once with \`npx acpx@latest --cwd <folder> <agent> sessions new --name <session-name>\`, then retry the prompt. (\`-s\` only resumes; it never creates.)
  - "command not found" / agent not installed, or an auth/sign-in error — the agent isn't set up. Tell the user to install or sign in to the agent via **Settings → Code Mode**, where Rowboat shows the install and sign-in status.

---

## Once delegating: delegate fully

After Step 2 fires, delegate ALL related coding tasks for this turn to the coding agent — writing, editing, reading, debugging, exploring structure, running tests. You are the coordinator; the agent does the work.

## Prerequisites (informational)

The user must have one of these installed locally — these are external tools you cannot install:
- Claude Code — https://claude.ai/code
- Codex — https://codex.openai.com
`;

export default skill;
