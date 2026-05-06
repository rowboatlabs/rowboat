export const skill = String.raw`
# Code with Agents Skill

Use this skill when the user asks you to write code, build a project, create scripts, fix bugs, or do any software development task that should be delegated to a coding agent (Claude Code or Codex).

## Important: delegate ALL coding work

Once the user has chosen to use Claude Code or Codex, you MUST delegate ALL code-related tasks to the coding agent. This includes:
- Writing, editing, or refactoring code
- Reading, summarizing, or explaining code
- Debugging and fixing bugs
- Running tests or build commands
- Exploring project structure
- Any other task that involves interacting with a codebase

Do NOT attempt to do any of these yourself — no reading files, no running commands, no writing code. You are the coordinator; the coding agent does the work. Your job is to translate the user's request into a clear prompt and pass it to the agent.

## Prerequisites

The user must have one of the following installed on their machine:
- **Claude Code** — https://claude.ai/code
- **Codex** — https://codex.openai.com

These are external tools that you cannot install for the user.

## Workflow

### Step 1: Gather requirements

Before running anything, confirm the following with the user:

1. **Working directory** — Ask which folder the code should be written in, unless the user has already specified it. Example: "Which folder should I work in?"
2. **Agent choice** — Ask whether to use **Claude Code** or **Codex**. Mention that the chosen agent must already be installed on their machine.

### Step 2: Confirm execution plan

Once you know the folder and agent, tell the user:

> I'll use [Claude Code / Codex] to [description of the task] in \`[folder]\`. Permission requests from the coding agent itself (file writes, command execution, etc.) will be automatically approved once it starts. Wait for the user's confirmation before you execute anything.

### Step 3: Execute with acpx

Use the \`executeCommand\` tool to run the coding agent via acpx. The command format is:

**For Claude Code:**
` + "`" + `
npx acpx@latest --approve-all --cwd <folder> claude exec "<prompt>"
` + "`" + `

**For Codex:**
` + "`" + `
npx acpx@latest --approve-all --cwd <folder> codex exec "<prompt>"
` + "`" + `

### Critical: flag order

The \`--approve-all\` and \`--cwd\` flags are global flags and MUST come before the agent name (\`claude\` or \`codex\`). This is the correct order:

` + "`" + `
npx acpx@latest [global flags] <agent> exec "<prompt>"
` + "`" + `

**Correct:**
` + "`" + `
npx acpx@latest --approve-all --cwd ~/projects/myapp claude exec "fix the bug"
` + "`" + `

**Wrong (will fail):**
` + "`" + `
npx acpx@latest claude --approve-all exec "fix the bug"
` + "`" + `

### Writing good prompts

When constructing the prompt for the coding agent:
- Be specific and detailed about what to build or fix
- Include file names, function signatures, and expected behavior
- Mention any constraints (language, framework, style)
- If the user gave you a short request, expand it into a clear, actionable prompt for the agent

### Step 4: Report results

After the command finishes, look for the summary that the coding agent produced at the end of its output and pass that along to the user as-is. Do not rewrite or add to it. Only add your own explanation if the command failed or the exit code is non-zero.

Do NOT use file reference blocks (e.g. \`\`\`file:path/to/file\`\`\`) when mentioning code files — they may not open correctly. Just refer to file paths as plain text.

- If the exit code is 5, it means permissions were denied — this should not happen with \`--approve-all\`, but if it does, let the user know
`;

export default skill;
