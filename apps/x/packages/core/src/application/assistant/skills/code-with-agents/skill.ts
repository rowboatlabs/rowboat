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

**Confirm briefly** with the user (one short line):

> I'll use [Claude Code / Codex] to [task description] in \`[folder]\`. Permission requests from the coding agent will be auto-approved. Reply "yes" to proceed.

**Execute** with the chosen agent. Call \`executeCommand\` with this exact shape:

\`\`\`
npx acpx@latest --approve-all --cwd <folder> <agent> exec "<prompt>"
\`\`\`

Where \`<agent>\` is \`claude\` or \`codex\`, picked by (in priority order):
- An explicit in-chat override from the user this turn ("use codex", "switch to claude") — honor it.
- The agent chosen in Step 1 / the "# Code Mode (Active)" block.

Concrete examples:

\`\`\`
npx acpx@latest --approve-all --cwd ~/projects/myapp claude exec "fix the off-by-one bug in foo.ts"
npx acpx@latest --approve-all --cwd "G:/4th sem/CN" codex exec "create a C program that divides two numbers with divide-by-zero handling"
\`\`\`

### Critical: flag order

\`--approve-all\` and \`--cwd\` are GLOBAL flags and MUST appear BEFORE the agent name:

- ✓ Correct: \`npx acpx@latest --approve-all --cwd <folder> <agent> exec "<prompt>"\`
- ✗ Wrong:  \`npx acpx@latest <agent> --approve-all exec "..."\` (will fail)

### Writing good prompts for the agent

- Be specific: file names, function signatures, expected behavior.
- Mention constraints (language, framework, style).
- Expand short user requests into clear, actionable prompts.

---

## STEP 3 — Report results

After the command finishes:
- Pass through the coding agent's summary as-is. Do not rewrite.
- Refer to file paths as plain text. Do NOT use \`\`\`file:path\`\`\` reference blocks.
- Only add your own explanation if the command failed (non-zero exit). If exit code is 5, permissions were denied (shouldn't happen with \`--approve-all\` — flag this).

---

## Once delegating: delegate fully

After Step 2 fires, delegate ALL related coding tasks for this turn to the coding agent — writing, editing, reading, debugging, exploring structure, running tests. You are the coordinator; the agent does the work.

## Prerequisites (informational)

The user must have one of these installed locally — these are external tools you cannot install:
- Claude Code — https://claude.ai/code
- Codex — https://codex.openai.com
`;

export default skill;
