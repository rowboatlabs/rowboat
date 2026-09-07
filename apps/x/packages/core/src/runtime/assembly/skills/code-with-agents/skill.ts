export const skill = String.raw`
# Code with Agents Skill

Use this skill whenever the user asks you to write code, build a project, create scripts, fix bugs, read/explain code, or do any software development task — even simple file creations like "make a .c file". It ALSO covers questions: design, product, architecture, and infra questions about a project ("how does X work?", "should we do A or B?", "what would it take to add Y?") route through the coding agent too — it has the repo in front of it and answers from the actual code.

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
  prompt: "<the user's request, forwarded almost verbatim>"
})
\`\`\`

**Writing \`prompt\` — forward, don't rewrite.** Pass the user's coding request through nearly verbatim:
- Fix only speech-to-text / transcription artifacts, obvious typos, and minor grammar; light formatting (e.g. breaking a run-on spoken sentence into lines) is fine.
- Do NOT expand, rephrase, or reinterpret the request, and do NOT add speculative implementation details, file guesses, or constraints the user never stated — the coding agent explores the repo itself and is better placed to interpret the request in context.
- ONE exception: when the user explicitly asks you to gather outside context first ("fetch the error from my email and send it to Claude Code", "pull the spec from my knowledge base for Codex"), collect that context, then send their verbatim request followed by the gathered material under a clearly labeled section (e.g. "Context the user asked me to include:").

**Follow-ups:** for every later coding request in this chat, just call \`code_agent_run\` again with the same \`cwd\` (or omitted again, same as the first call) and the chip's current agent. The session resumes automatically — do NOT start over or re-explain prior context.

---

## STEP 3 — Report results

After \`code_agent_run\` returns:
- **Reply in ~2 lines, nothing more.** The agent's ENTIRE output — every message, plan step, tool call, and file diff — is directly visible to the user, fully formatted, in the run card right above your reply; the user reads the results THERE. On success your reply is exactly: (1) one line stating what was done — "I used Claude Code to implement [task]." — and (2) at most one more line with a key outcome the user needs, when applicable: a PR link (if the run created one), or the changes' status / next step.
- **STRICTLY FORBIDDEN:** re-summarizing or reiterating what the agent said, listing the files it touched, explaining implementation details, or repeating diffs — the user can already read all of that in the card, and repeating it is pure noise.
- Refer to file paths as plain text. Do NOT use \`\`\`file:path\`\`\` reference blocks. (This overrides the global "always wrap paths in filepath blocks" rule — for code-mode output, plain text.)
- Only add your own explanation if it failed:
  - A tool error with a message — surface the message. If it mentions the agent isn't installed or signed in, tell the user to install or sign in via **Settings → Code Mode**.
  - \`stopReason: "cancelled"\` — the run was stopped; acknowledge briefly and ask if they want to continue.

---

## Once delegating: delegate fully

After Step 2 fires, delegate ALL related work for this turn to \`code_agent_run\` — writing, editing, reading, debugging, exploring structure, running tests, AND answering design, product, architecture, and infra questions about the project. Do NOT answer those questions yourself even when you think you know — the agent answers from the actual code. You are the coordinator; the agent does the work. The ONLY reason to skip the agent is that the user EXPLICITLY asks YOU to do it yourself ("don't use Claude Code", "you answer this") — then answer directly and say you're answering without the agent.

## Prerequisites (informational)

The user must have one of these installed locally — these are external tools you cannot install:
- Claude Code — https://claude.ai/code
- Codex — https://codex.openai.com
`;

export default skill;
