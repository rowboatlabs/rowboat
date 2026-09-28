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

## In a Space thread

Spaces uses a shared Replicas member and a Harbor-owned workspace/chat binding
(2026-09-28). Do not dispatch a personal workspace or parse a workspace handle
from prose in a Space thread. Use the Space's \`get_replicas_config\` and
\`get_replicas_task\` tools to inspect the connection and shared task. When the
person explicitly asks you to delegate cloud work, address the configured
Replicas member in \`post_message\` in that thread; Harbor queues and delivers
it. If no shared connection exists, explain that an org admin can connect it
from Replicas Settings above the Space composer. Do not copy a personal key
into shared settings without an explicit request to share that account.

The shared agent posts its own results. Do not wait through the personal
\`replicas-wait\` tool or post a second completion summary. Environment
selection, retry, and fork are exposed by \`act_on_replicas_task\`.

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
  there is no lock. Spaces coordinates teammate requests through its shared queue.
`;
export default skill;
