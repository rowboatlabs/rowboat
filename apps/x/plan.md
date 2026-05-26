# Plan: Make the chat "work directory" per-chat instead of global

## 1. Problem / current behavior

In the Electron app (`apps/x`), a chat can have a **work directory** — a folder the
agent treats as the default location for file operations. The user sets it from the
chat input's dropdown ("Set / Change / Clear work directory").

**Bug:** the work directory is **global**, not per-chat. Setting it in one chat changes
it for *every* chat — new chats and previously-created chats alike. Opening a different
chat shows (and uses) whatever directory was last set anywhere.

**Desired behavior:**
- The work directory belongs to a single chat (run). Setting it in chat A must not affect
  chat B.
- A brand-new chat starts with **no** work directory.
- The user can **set, change, or clear** the work directory at any point in a chat, and
  the change applies to that chat only and to its subsequent messages.

## 2. Root cause

The work directory lives in one shared file — `config/workdir.json` in the Rowboat
workspace — and there is no per-run storage for it.

| Concern | Location | What it does |
|---|---|---|
| Write (UI) | `apps/renderer/src/components/chat-input-with-mentions.tsx:275-306` (`handleSetWorkDir` / `handleClearWorkDir`) | Writes the chosen path to the global `config/workdir.json`. |
| Read for display (UI) | `apps/renderer/src/components/chat-input-with-mentions.tsx:259-273` (`loadWorkDir`, called on `isActive`) | Re-reads the same global file whenever any tab becomes active. |
| Read for the agent | `packages/core/src/agents/runtime.ts:41-51` (`loadUserWorkDir`) injected at `runtime.ts:1125-1146` | On every message, reads the same global file and injects it into the prompt, regardless of which run the message belongs to. |

The data model has nowhere to store it per chat:
- `Run` / `StartEvent` schema: `packages/shared/src/runs.ts:19-34` and `147-157` — no work-dir field.
- `CreateRunOptions`: `packages/shared/src/runs.ts:169-175` — not accepted at creation.
- The run is created in the renderer at `apps/renderer/src/App.tsx:2357` (`runs:create`) and the work dir is never passed through.

## 3. Design

Make the work directory **run-scoped metadata**, captured at run creation and updatable
mid-chat via an appended event (run logs are append-only JSONL, so "change" = append a new
event; readers use the latest one).

Three moving parts:

1. **Schema** — add an optional `workingDirectory` to `StartEvent` (initial value) and add a
   new `WorkdirChangedEvent` to the run-event union (later changes). Derive a
   `workingDirectory` field on the `Run` object from the latest of these.
2. **Runtime** — `AgentState` tracks `workingDirectory` (set by the start event, overwritten
   by each `workdir-changed` event). The prompt injection uses `state.workingDirectory`
   instead of reading the global file.
3. **Renderer** — the chat input reads the work dir from the active run (via `runs:fetch`),
   not the global file. For a new chat (no run yet), the chosen dir is held in tab-local
   state and passed into `runs:create`. Set/Change/Clear on an existing run calls a new
   `runs:setWorkdir` IPC that appends a `workdir-changed` event.

The global `config/workdir.json` is no longer read or written. New chats therefore start
empty, which is what fixes the reported bug. (No migration needed — old runs simply have no
stored work dir and start empty going forward. Optionally delete the stale file; see step 7.)

## 4. Execution steps

### Step 1 — Schema (`packages/shared/src/runs.ts`)

1. Add `workingDirectory` to `StartEvent` (after `subUseCase`, line ~33):
   ```ts
   workingDirectory: z.string().optional(),
   ```
2. Add a new event type near the other event definitions (e.g. after `RunStoppedEvent`,
   line ~106):
   ```ts
   export const WorkdirChangedEvent = BaseRunEvent.extend({
       type: z.literal("workdir-changed"),
       // empty string / undefined means "cleared"
       workingDirectory: z.string().optional(),
   });
   ```
3. Add `WorkdirChangedEvent` to the `RunEvent` union (line ~108-124).
4. Add the derived field to the `Run` schema (line ~147-157):
   ```ts
   workingDirectory: z.string().optional(),
   ```
5. Add it to `CreateRunOptions` (line ~169-175):
   ```ts
   workingDirectory: z.string().optional(),
   ```

> Note: the read-side `LegacyStartEvent` in `packages/core/src/runs/repo.ts:21-30` extends
> `StartEvent`, so the new optional field is picked up automatically. No legacy change needed.

### Step 2 — Persist work dir at run creation (`packages/core/src/runs/`)

1. `runs/repo.ts` — extend `CreateRunRepoOptions` (line ~34) with
   `workingDirectory?: string;`. In `create()` (the `start` event object, ~where
   `subUseCase` is spread), include:
   ```ts
   ...(options.workingDirectory ? { workingDirectory: options.workingDirectory } : {}),
   ```
   Add the same spread to the returned `Run` object literal.
2. `runs/repo.ts` — in `fetch()`, derive the current work dir as **the last
   `workdir-changed` event's value, falling back to the start event's
   `workingDirectory`**, and include it on the returned `Run`:
   ```ts
   const lastWorkdirEvent = [...events].reverse()
       .find((e) => e.type === 'workdir-changed') as
       | z.infer<typeof WorkdirChangedEvent> | undefined;
   const workingDirectory = lastWorkdirEvent
       ? (lastWorkdirEvent.workingDirectory || undefined)
       : (start.workingDirectory || undefined);
   // ...
   ...(workingDirectory ? { workingDirectory } : {}),
   ```
   (Import `WorkdirChangedEvent` from `@x/shared/dist/runs.js`.)
3. `runs/runs.ts` — `createRun()` (line ~31) passes `workingDirectory` through to
   `repo.create({ ... })`:
   ```ts
   ...(opts.workingDirectory ? { workingDirectory: opts.workingDirectory } : {}),
   ```
4. `runs/runs.ts` — add a new exported function to change the work dir mid-chat:
   ```ts
   export async function setWorkdir(runId: string, workingDirectory: string | null): Promise<void> {
       const repo = container.resolve<IRunsRepo>('runsRepo');
       const event: z.infer<typeof WorkdirChangedEvent> = {
           runId,
           type: "workdir-changed",
           subflow: [],
           ...(workingDirectory ? { workingDirectory } : {}),
       };
       await repo.appendEvents(runId, [event]);
   }
   ```
   (No `runtime.trigger()` — this only updates metadata; it'll be read on the next message.)

### Step 3 — Runtime reads per-run work dir (`packages/core/src/agents/runtime.ts`)

1. Add a field to `AgentState` (class at line 668, near `runSubUseCase`, line ~675):
   ```ts
   workingDirectory: string | null = null;
   ```
2. In `AgentState.ingest()` (line 773):
   - In the `case "start":` block (line ~786-793) add:
     ```ts
     this.workingDirectory = event.workingDirectory ?? null;
     ```
   - Add a new case:
     ```ts
     case "workdir-changed":
         this.workingDirectory = event.workingDirectory ?? null;
         break;
     ```
3. Replace the global-file read at the injection site. At `runtime.ts:1125`, change:
   ```ts
   const userWorkDir = loadUserWorkDir();
   ```
   to:
   ```ts
   const userWorkDir = state.workingDirectory;
   ```
   Leave the rest of the prompt block (lines 1126-1146) unchanged.
4. Delete the now-unused `loadUserWorkDir` function (lines 41-51) and the
   `WORKDIR_CONFIG_FILE` constant (line 39).

### Step 4 — IPC surface (`packages/shared/src/ipc.ts`)

1. `runs:create` already uses `CreateRunOptions` as its `req` (line 176-179) — the new
   optional field flows through automatically once Step 1 lands. No change needed there.
2. Add a new channel `runs:setWorkdir`:
   ```ts
   'runs:setWorkdir': {
     req: z.object({
       runId: z.string(),
       workingDirectory: z.string().nullable(),
     }),
     res: z.object({ success: z.literal(true) }),
   },
   ```
3. Wire the handler in `apps/main/src/ipc.ts` (alongside the other `runs:*` handlers,
   e.g. near line 509):
   ```ts
   'runs:setWorkdir': async (_event, args) => {
     await runsCore.setWorkdir(args.runId, args.workingDirectory);
     return { success: true as const };
   },
   ```
   (Confirm the import name used for the runs core module — it's `runsCore` in the existing
   `runs:createMessage` handler.)

### Step 5 — Renderer: chat input reads/writes per-run (`apps/renderer/src/components/chat-input-with-mentions.tsx`)

The component already has `runId` as a prop (lines 119/146/777/806) and already loads
run-scoped data via `runs:fetch` for model-locking (lines 178-192) — mirror that pattern.

1. **Load from the run, not the global file.** Replace `loadWorkDir` (lines 259-273) so it:
   - If `runId` is set: `runs:fetch` and `setWorkDir(run.workingDirectory ?? null)`.
   - If `runId` is null: do **not** read any global file. Instead reflect the tab-local
     pending value supplied by the parent (see new props below). Default `null`.
   Remove the `workspace:readFile` call on `config/workdir.json`.
2. **Set / change.** In `handleSetWorkDir` (lines 275-292), after the user picks a folder:
   - If `runId` is set: `await window.ipc.invoke('runs:setWorkdir', { runId, workingDirectory: chosen })`.
   - If `runId` is null: call a new prop `onPendingWorkDirChange(chosen)` so the parent stores
     it for this tab until the run is created.
   - In both cases `setWorkDir(chosen)`.
   Remove the `workspace:writeFile` to `config/workdir.json`.
3. **Clear.** In `handleClearWorkDir` (lines 294-306), same branching with
   `workingDirectory: null` / `onPendingWorkDirChange(null)`, then `setWorkDir(null)`.
4. **Props.** Add to `ChatInputInnerProps` (line 111) and `ChatInputWithMentionsProps`
   (line 766), and thread through the wrapper (line 795-833):
   ```ts
   pendingWorkDir?: string | null
   onPendingWorkDirChange?: (dir: string | null) => void
   ```
   When `runId` is null, drive the displayed `workDir` from `pendingWorkDir`.

### Step 6 — Renderer: hold pending work dir per tab + pass to run creation (`apps/renderer/src/App.tsx`)

Mirror the existing per-tab model pattern (`selectedModelByTabRef`, line 972; cleared on
tab close at line 2668; set/read at 2356, 5298-5300, 5358-5360).

1. Add a tab-keyed store for the pending (pre-run) work dir. A ref works, but since the UI
   must re-render when it changes, prefer state keyed by tab id, e.g.
   `const [pendingWorkDirByTab, setPendingWorkDirByTab] = useState<Record<string, string | null>>({})`.
2. Pass to each `<ChatInputWithMentions>` (lines 5282 and 5347):
   ```tsx
   pendingWorkDir={pendingWorkDirByTab[tab.id] ?? null}
   onPendingWorkDirChange={(dir) =>
     setPendingWorkDirByTab((prev) => ({ ...prev, [tab.id]: dir }))}
   ```
3. In the submit handler where the run is created (lines 2355-2372), pass the pending dir
   into `runs:create`:
   ```ts
   const pendingWorkDir = pendingWorkDirByTab[submitTabId] ?? undefined
   const run = await window.ipc.invoke('runs:create', {
     agentId,
     ...(selected ? { model: selected.model, provider: selected.provider } : {}),
     ...(pendingWorkDir ? { workingDirectory: pendingWorkDir } : {}),
   })
   ```
   After the run is created, the work dir lives on the run; clear the pending entry for that
   tab (optional, keeps state tidy).
4. On tab close (near line 2668) delete the tab's entry from `pendingWorkDirByTab`.

### Step 7 — Cleanup / backward compatibility

- No data migration required. Existing runs have no stored work dir → they show empty and
  behave correctly going forward.
- The global `config/workdir.json` is no longer read or written. Optionally delete it once
  on startup so the stale value doesn't linger (low priority; safe to skip).
- Grep to confirm no remaining readers/writers of `config/workdir.json` outside the files
  changed above:
  ```bash
  grep -rn "workdir.json\|loadUserWorkDir\|WORKDIR_CONFIG_FILE" apps/x
  ```

## 5. Build & verify

```bash
cd apps/x && npm run deps     # rebuild shared -> core -> preload (schema + IPC changes)
cd apps/x && npm run lint
```

Manual checks in dev (`cd apps/x && npm run dev`):
1. New chat A → set work dir to /pathA. Open a new chat B → it shows **no** work dir.
2. In chat A, send a message → agent should treat /pathA as the work dir (check the
   injected "User Work Directory" block / `loopLogger` "injecting user work directory").
3. Reopen chat B, set /pathB → chat A still shows /pathA (reopen A to confirm).
4. In chat A, change to /pathC mid-conversation → next message uses /pathC; earlier behavior
   unaffected. Clear it → subsequent messages have no work dir injected.
5. Reload the app and reopen chat A → it still shows its last work dir (persisted on the run
   log via `workdir-changed` / start event).

## 6. Touched files summary

| File | Change |
|---|---|
| `packages/shared/src/runs.ts` | Add `workingDirectory` to `StartEvent`, `Run`, `CreateRunOptions`; add `WorkdirChangedEvent` + add to union. |
| `packages/shared/src/ipc.ts` | Add `runs:setWorkdir` channel. |
| `packages/core/src/runs/repo.ts` | Persist `workingDirectory` in `create()`; derive latest in `fetch()`. |
| `packages/core/src/runs/runs.ts` | Pass through in `createRun()`; add `setWorkdir()`. |
| `packages/core/src/agents/runtime.ts` | `AgentState.workingDirectory`; ingest start + `workdir-changed`; inject `state.workingDirectory`; remove `loadUserWorkDir` + `WORKDIR_CONFIG_FILE`. |
| `apps/main/src/ipc.ts` | Handler for `runs:setWorkdir`. |
| `apps/renderer/src/components/chat-input-with-mentions.tsx` | Read/write per-run (via `runs:fetch` / `runs:setWorkdir`); new `pendingWorkDir` + `onPendingWorkDirChange` props; drop global-file I/O. |
| `apps/renderer/src/App.tsx` | Per-tab pending work dir state; pass to `runs:create`; clear on tab close. |
