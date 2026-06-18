# Coding-from-Meetings — Background Tasks that write code

> Status: Phase 1 implementation. Branch: `feat/coding-from-meetings` (off `dev`).

## Goal

Let a user create a background task that, **after a meeting's notes land**, scans them
for actionable coding items, and **autonomously implements them** in an isolated git
worktree (full-auto / `yolo`), leaving behind:

- one or more **resumable code-mode sessions** (each on its own branch), and
- a **summary** in the task's `index.md` (what changed, where, which branch, which session).

**Phase 2 (not in this branch):** a deep-link from the summary into the Code tab so the
user can open that exact session and continue.

## Why this is mostly wiring, not new infra

Two existing systems already carry ~80% of the weight:

- **Background tasks** (`packages/core/src/background-tasks/`): persistent agent +
  cron/window/event triggers + 15s scheduler + event consumer + `index.md` artifact +
  builtin tools + IPC + UI. The runner already does `createRun('background-task-agent')`
  → `createMessage` → `waitForRunCompletion` → `extractAgentResponse`.
- **Code mode** (`packages/core/src/code-mode/`): a code session **is a run**.
  `CodeSessionService.create({ isolation: 'worktree', policy: 'yolo', mode: 'direct',
  agent: 'claude' })` already creates the worktree + branch `rowboat/<sessionId>`, and
  `sendMessage()` drives the engine and resolves when the turn settles, publishing
  `run-processing-end`. `mergeBack()` / `cleanupWorktree()` already exist (Phase 2 fodder).

So the genuinely new code is small and additive.

## Decisions (locked with the user)

| Question | Decision |
|---|---|
| Trigger | **On notes/transcript ready** — emit a new `meeting.notes_ready` event when a meeting note is written. (Calendar end-time has no content yet.) |
| Autonomy | **`yolo` + isolated worktree/branch** — full-auto, never touches the user's checkout. |
| Phase 1 endpoint | **Branch changes + summary md.** No PR / push. |
| Execution | **Async + completion hook** — launch the code run, return immediately; a detached watcher writes the summary on completion. |
| Gating | **Agent decides, conservative** — only launch for clearly-scoped items; ambiguous → note as "needs review", don't code. |
| Grouping | **Agent decides** — may group similar items into one session or split into several (0..N launches per run). |
| Repo scope | **One repo per task** (a registered code project). Out-of-repo items → noted, not coded. |
| Surfacing | **"Coding from meetings" preset** in the bg-tasks New Task dialog (repo picker + prefilled trigger/instructions). |
| Cleanup | **Keep until user dismisses** (existing `cleanupWorktree` / `mergeBack`). |

## End-to-end flow

```
Fireflies/Granola sync writes a NEW meeting note
        │  (emit)
        ▼
events/pending/<id>.json  type=meeting.notes_ready  payload=title + path + hint
        │  (existing event processor, 5s poll, Pass-1 LLM routing)
        ▼
bg-task whose eventMatchCriteria matches  →  runBackgroundTask(slug,'event',payload)
        │
        ▼
background-task-agent run:
  - reads the meeting note (file-readText on the path in the payload)
  - decides actionable coding items, conservatively; groups them
  - for each group: calls launch-code-task(taskSlug, title, items, prompt)
        │
        ▼  (per launch — async)
launch-code-task tool:
  - fetchTask(slug) → projectId → codeProjectsRepo.get → repo path
  - CodeSessionService.create({ isolation:'worktree', policy:'yolo', mode:'direct', agent:'claude' })
  - wraps the agent's prompt in an autonomous-coding scaffold
  - fires sendMessage(sessionId, wrapped)  [NOT awaited]
  - appends a "⏳ running" block to index.md  (## Code Sessions, withFileLock)
  - registers a detached completion watcher
  - returns { sessionId, branch, worktreePath } to the agent
        │
        ▼  (later, per session)
completion watcher:
  - waitForRunCompletion(sessionId)
  - gitService.status(worktreePath) → files changed + ins/del
  - extractAgentResponse(sessionId) → code agent's final summary
  - replaces that session's block in index.md with ✅/❌ + summary + files + branch
```

## What we build (by package, dependency order)

### 1. shared
- `packages/shared/src/background-task.ts`: add optional `projectId` to `BackgroundTask`
  type + `BackgroundTaskSchema` (and the summary type/schema). Marks a task as a
  coding task and pins its repo.
- `packages/shared/src/ipc.ts`: add `projectId?` to the `bg-task:create` request.

### 2. core
- **Event producer** — `meeting.notes_ready`:
  - `knowledge/sync_fireflies.ts` (after the write ~line 583) and
    `knowledge/granola/sync.ts` (after the write ~line 434).
  - **Guarded to genuinely new notes** (don't fire on re-sync overwrites): check file
    existence before writing.
  - Payload: human-readable markdown with title + absolute path + a hint that it may
    contain coding action items (so Pass-1 routing + the agent can use it).
- **`launch-code-task` builtin tool** — `application/lib/builtin-tools.ts`:
  - Input: `{ taskSlug, title, items, prompt, context? }`.
  - Resolves `codeSessionService` + `codeProjectsRepo` from `container`.
  - `fetchTask(taskSlug)` → `projectId`; error clearly if absent.
  - Creates the worktree/yolo/direct/claude session, wraps `prompt` with the autonomous
    scaffold, fires `sendMessage` detached, appends the running block, registers the
    watcher. Returns session info.
  - The scaffold guarantees prompt quality regardless of the agent: "no human present,
    implement end-to-end, verify (build/typecheck/lint/tests), commit in small steps,
    stay in scope, summarize at the end."
- **Completion watcher + index.md section ownership** — small new module
  `background-tasks/code-sessions.ts`:
  - `appendRunningBlock(slug, {...})`, `finalizeBlock(slug, sessionId, {...})` — both
    under `withFileLock(taskIndexPath(slug))`, editing only a `## Code Sessions` section
    delimited per-session by `<!-- cs-start:<id> -->` / `<!-- cs-end:<id> -->` markers.
  - The **agent does not edit these rows** — the tool/watcher own them. (Instruction
    reinforces this.)
- **bg-task agent** — `background-tasks/runner.ts` + `background-tasks/agent.ts`:
  - `buildMessage`: when `task.projectId` is set, inject a **"# Coding task"** block —
    explains the repo is configured, tells the agent to detect/group items and call
    `launch-code-task` (with how to write an excellent self-contained prompt), and to
    leave the Code Sessions section to the tool.
  - `BACKGROUND_TASK_AGENT_INSTRUCTIONS`: add a short **CODE MODE** section describing
    the capability and the conservative-gating rule.
  - `launch-code-task` is auto-included by `buildBackgroundTaskAgent` (the loop adds all
    builtins except `executeCommand` / `code_agent_run`). It no-ops with a clear error
    if a non-coding task ever calls it.

### 3. main
- `apps/main/src/ipc.ts`: `bg-task:create` handler passes `projectId` through to
  `createTask`. `fileops.createTask` persists it.

### 4. renderer
- `apps/renderer/src/components/bg-tasks-view.tsx`: add a **"Coding from meetings"**
  preset in the New Task dialog:
  - repo picker → `codeProject:add` (returns `projectId`),
  - prefilled `eventMatchCriteria` (engineering/standup/planning meetings with coding
    action items) + prefilled instructions,
  - `bg-task:create` with `projectId`.

## The code-agent prompt (quality matters)

The agent writes the task-specific body; the **tool wraps it** so every launch gets a
strong, self-contained first message:

- Role: autonomous, no human, cannot ask — decide and finish.
- Scope: this repo only; you are on isolated branch `<branch>`.
- Definition of done: implement end-to-end, no TODOs/stubs left for the user.
- Verify: run build/typecheck/lint and relevant tests; fix regressions you cause.
- Hygiene: small logically-scoped commits; stay in scope; no unrelated refactors.
- Blocked path: do the safe partial, clearly flag blockers in the final summary — never
  guess destructively.
- Output: end with a concise summary (what / where / how verified / follow-ups).

## Known Phase-1 limitations (revisit later)

- If the app quits mid-run, the watcher dies and a row can stay "⏳ running". Sessions are
  resumable, so a restart-reconciliation pass can fix this later.
- No concurrency cap yet — a chatty meeting could spawn several `yolo` sessions. Likely
  want a per-fire cap. (Decide a number during build/testing.)
- No PR/push; local branches only.
- One repo per task; cross-repo items are noted, not coded.
- `index.md` Code Sessions section is tool-owned; the agent is instructed not to edit it
  (soft guarantee via prompt, not enforced).

## Phase 2 (later)
- Deep-link `index.md` session id → open that resumable session in the Code tab.
- "Continue from here" + `mergeBack` surfaced in the UI.
- Optional: PR/push, multi-repo routing, worktree GC, restart reconciliation.
