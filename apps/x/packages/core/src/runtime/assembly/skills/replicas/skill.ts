// The Replicas skill (2026-09-28): how to hand coding work to a Replicas
// cloud workspace and steer it — alone in a chat, or with a whole Space
// thread watching. Tools: runtime/tools/domains/replicas.ts.
export const skill = String.raw`
# Replicas (cloud coding workspaces)

Replicas runs Claude Code, Codex and other coding agents in isolated cloud
VMs against your team's GitHub/GitLab repos. One **workspace** = one VM with
the repo cloned, working on one branch, whose output is a **pull request**.
Nothing runs on this machine; the code never touches the user's disk.

Use Replicas ONLY when the person asked for it: the composer's strip is set to
**Run on Replicas** (a \`# Run on Replicas\` block is in your instructions),
or the message names Replicas / "in the cloud". Never move local coding work
to the cloud on your own judgment, and when Replicas IS chosen never do the
work locally instead (no \`code_agent_run\`, no \`executeCommand\`, no file
tools on the repo).

## Tools

- \`replicas-dispatch\` — start a workspace and give it the task. Returns a
  \`handle\` line. Binds this conversation to the workspace.
- \`replicas-send\` — a follow-up into an existing workspace (queued behind
  the running turn, or steering it). Takes a handle / URL / id, or defaults
  to the bound workspace.
- \`replicas-wait\` — follow the workspace's live events until a PR appears,
  the turn ends, or it goes quiet. Returns PR links and the last assistant
  text.
- \`replicas-status\` — status + URL, no waiting.
- \`replicas-environments\` — the repos this account can dispatch into (only
  when no environment was given).

## The task text

Forward the person's request nearly verbatim (fix typos and speech
artifacts only). Do not expand it or guess files — the workspace explores
the repo itself. When the ask refers to the discussion ("fix what Priya
reported above"), \`read_thread\` and append the relevant messages under a
labeled **Context from the thread:** section. Never paste private material
(DMs, emails, notes) into the task.

## In a Space thread — the handle IS the shared state

The thread is what teammates see; Replicas is what one member's Rowboat
talks to. The bridge is one line, posted verbatim from the tool result:
\`Replicas workspace \\\`<id>\\\` — <url>\`. Any member's Rowboat can later
read the thread, find that line, and steer the same workspace.

1. \`react\` 👀 on the invoking message (the thread procedure's receipt).
2. \`read_thread\`. If a \`Replicas workspace\` handle line already exists in
   this thread, this is a follow-up: \`replicas-send\` with that handle. Do
   NOT start a second workspace for the same thread.
3. Otherwise \`replicas-dispatch\` with the environment from the Run-on-Replicas
   block (or the one the person named). Then \`post_message\` exactly ONE
   message: the \`handle\` line verbatim, plus one short line saying what was
   sent ("Sent to Replicas on rowboat: fix the login timeout.").
4. \`replicas-wait\`.
   - \`pr_opened\`: swap 👀 for ✅ and post ONE message: the PR link, one line
     on what changed and how it was verified (from \`answer\` if useful),
     nothing else. Do not summarize diffs.
   - \`completed\` with no PR: \`answer\` is the agent's final message. For a
     question-shaped ask ("summarize the last commit", "how does X work")
     that IS the result: swap 👀 for ✅ and post it as the one reply,
     trimmed to what the room needs. For coding work it says what happened
     or what it needs: post one line, ✅ if finished, 👀 if not.
   - \`still_running\` / \`timeout\`: call \`replicas-wait\` again. If it is
     still running after that, post one line "Still running on Replicas —
     <handle>" and leave 👀.
   - \`error\` / \`cancelled\`: swap 👀 for ❗ and explain privately in this chat.
5. A later \`@rowboat\` follow-up in the same thread (yours or a teammate's):
   👀, \`replicas-send\` with the thread's handle, \`replicas-wait\`, then the
   same reporting rules. Say "Steered the Replicas workspace" in your one
   line, not "started".

**Plan mode** (the strip's Manual, or \`planMode\` in the block): dispatch
with \`planMode: true\`, wait, and post the plan from \`answer\` as ONE
message (trim it to the steps). Then stop and leave 👀. When someone in the
thread says go / 👍 / "proceed" with \`@rowboat\`, \`replicas-send\`
"Proceed with the plan." and continue from step 4.

## In a plain chat (no thread)

Dispatch, then \`replicas-wait\`, then reply in two lines: what was sent and
the PR link (or the workspace URL if it is still running). Follow-ups in the
same chat resume the bound workspace through \`replicas-send\`.

## Never

- Never run shell commands, search local files, or read Rowboat's own source
  to understand a Replicas result. Nothing about the run exists on this
  machine. A puzzling result means: call \`replicas-status\` or
  \`replicas-wait\` again, then report what they say.
- Never do the coding work yourself when Replicas was chosen.

## Facts to keep straight

- A workspace sleeps after an hour idle and wakes on the next message (a
  few seconds); it is archived after a week and can still be restored.
- The PR is opened by the person whose Replicas key this Rowboat holds. The
  workspace bills their Replicas org per awake minute.
- Two workspaces on one repo are two independent clones and branches — fine
  for two features, wrong for one thread. One thread, one workspace.
- Replicas queues concurrent messages per chat and can steer a running turn;
  there is no lock. Several teammates sending into one workspace is expected.
`;
export default skill;
