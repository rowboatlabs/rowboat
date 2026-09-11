# OpenCode manual acceptance tests

This checklist covers the current stages 1–7 implementation and the stage 8 release gate. It is a test plan, not a record of completed manual testing. Start every case as **Not run**. Automated test results do not establish a manual pass.

Related contracts: [coding runtime](opencode-coding-runtime.md), [provider setup](opencode-provider-setup.md), [installation and isolation](opencode-integration-contract.md).

## 1. Test record and priorities

Create a separate result record for each build/platform combination. Use **Pass**, **Fail**, **Blocked**, **Not run**, or **Not applicable**. Record a reason for Blocked/Not applicable; neither counts as Pass.

| Field | Record |
| --- | --- |
| Tester and date | |
| Rowboat commit/build identifier | |
| Execution | Development / packaged application |
| OS version and CPU architecture | |
| OpenCode engine version | Expected pinned version: 1.18.30; record observed version |
| Provider and authentication method | Provider name/method only; no secrets |
| Models used | Exact provider-qualified IDs |
| Project/session/worktree | Test project path and Rowboat session identifier |
| Case ID and result | |
| Actual behavior and duration | |
| Evidence / issue link | Redacted screenshots, relevant output, file diff, process observations |

**P0:** Core flow, unintended execution, lost context, misleading readiness, or credential exposure; must pass before release. **P1:** Recovery, configuration, and supported platform behavior; required for the affected feature/platform. Fault-injection cases require a controlled test build or test harness when ordinary UI interaction cannot trigger the condition.

Use a disposable OS account or backed-up test profile for clean-state and corruption cases. Do not delete your everyday Rowboat/OpenCode state. Use a disposable repository and restricted test-provider credentials. Real verification and coding requests can consume provider usage. Never paste credentials into test prompts, screenshots, issue reports, or shared evidence.

## 2. Test fixtures

### Repository A: a small Node project

Create a directory whose path contains spaces, such as `C:\Rowboat QA\Project A` on Windows or `~/Rowboat QA/Project A` on macOS/Linux. Use a recent Node version supporting `node --test`.

Create `package.json`:

```json
{
  "name": "rowboat-opencode-qa",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
```

Create `sum.js`:

```js
export function sum(a, b) {
  return a - b; // Intentional defect for the edit-and-test case.
}
```

Create `sum.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { sum } from './sum.js';

test('adds positive numbers', () => assert.equal(sum(2, 3), 5));
test('adds a negative number', () => assert.equal(sum(-2, 3), 1));
```

Create `heartbeat.cjs`:

```js
const fs = require('node:fs');
console.log(`QA heartbeat PID=${process.pid}`);
setInterval(() => fs.appendFileSync('heartbeat.log', `${Date.now()}\n`), 500);
```

Create `.gitignore` containing `heartbeat.log`. Initialize Git, stage these fixture files, and create an initial commit using your test identity. Run `npm test`: both tests must fail initially. Record the initial branch, commit and clean working-tree status. Register this repository in Rowboat's Code section.

Create a second independent repository, **Project B**, with the same initial fixture. Do not reuse Project A's worktree as Project B.

For project-specific mode tests, add this `opencode.json` to Project A only and commit it **before creating the test worktree**:

```json
{
  "agent": {
    "qa-review": {
      "description": "Review the QA project without modifying files",
      "mode": "primary",
      "permission": { "edit": "deny", "bash": "deny" }
    }
  }
}
```

For configuration changes after session creation, edit the configuration inside the **session's actual working directory**. Editing the original checkout does not automatically update an existing worktree.

### Provider fixtures

- A currently available OpenCode public free model, plus optional Go and Zen test accounts with model access.
- A second available model; preferably one model with advertised effort and one without. If no available model advertises effort, mark effort-positive cases Blocked and record the catalog observed.
- An invalid dummy key for negative tests. Do not invalidate the account's real key merely to simulate a failure.
- Go and Zen account API keys for paid-account cases. Generic provider/OAuth/login-terminal flows are outside the shipped UI scope.
- Optional controlled provider/MCP fixture for deterministic network, authentication, malformed-response and tool-approval tests. Never use production infrastructure for fault injection.

### Evidence to capture

Record the session's displayed cwd/worktree path, selected model/mode, approval decisions, relevant timeline rows and `git diff` in the actual session directory. For process cleanup, inspect executable path, parent/child relationships and the heartbeat file; a process name alone cannot distinguish a global OpenCode instance from Rowboat's owned engine.

State locations to inspect locally when needed:

```text
~/.rowboat/engines/opencode/<version>/
~/.rowboat/opencode/config/
~/.rowboat/opencode/data/
~/.rowboat/opencode/cache/
~/.rowboat/opencode/state/
~/.rowboat/code-mode/sessions/
~/.rowboat/code-mode/sessions-meta/
```

The managed auth file contains secrets. Inspect credential presence locally without copying its contents into evidence. Never record the private HTTP listener's password or Authorization header.

## 3. Recommended execution order

For a quick stage 7 check on an existing installation, run **MOD-01 through MOD-09**, then **PERM-06**. For first-release acceptance, run the entire P0 sequence first: installation → API setup → model choice → worktree coding → approve/reject → stop → restart/resume → disconnect → remove/reinstall. Then run optional Go/Zen account cases, failure injection, and each intended packaged platform.

If a prerequisite fails, mark dependent cases Blocked rather than treating the same failure as an independent result for every case. Restore the fixture or create a fresh Code session between destructive/corruption scenarios.

## 4. Installation and isolated state

### INS-01 — Fresh install without a global CLI [P0]

**Precondition:** Fresh test profile; no managed engine/state and no global OpenCode executable.

1. Open Settings → Code Mode → OpenCode.
2. Confirm Not installed, then click Enable.
3. Observe download/provisioning phases until completion.
4. Inspect the running executable path when opening provider setup.

**Expected:** The pinned managed engine installs successfully. Progress ends in Installed with an optional Connect Go / Zen action, not Ready. Executable selection is inside the managed engine directory. No global CLI installation is required.

**Evidence:** Initial/final Settings state, version, executable path and approximate install time.

### INS-02 — Repeated/concurrent Enable requests [P1]

**Precondition:** No managed engine; use a sufficiently slow connection to observe installation.

1. Trigger Enable twice through available UI entry points, or issue two provisioning requests using the development IPC harness.
2. Observe progress and final status for both subscribers.
3. After completion, request Enable again.

**Expected:** Concurrent requests share one backend installation. Both callers settle accurately. Re-enabling an intact engine does not download another copy. No partial engine is marked installed.

### INS-03 — Interrupted or failed installation [P0]

1. Begin a fresh download, then disconnect the test machine's network.
2. Observe the failure; restore networking and choose Retry.
3. Repeat with an application shutdown during download/extraction, then reopen.

**Expected:** Interrupted installation never reports success. Restart shows either a fully validated engine or a recoverable not-installed/failed state. Retry completes without manually repairing metadata.

### INS-04 — Integrity, extraction and version failures [P0; harness]

1. Supply a truncated archive or an archive whose bytes do not match the manifest hash.
2. Separately simulate extraction failure and an executable that fails or hangs during the bounded version check.
3. Restore the normal package source and Retry.

**Expected:** Each invalid artifact is rejected before installation metadata is activated. Error state is recoverable; no corrupt executable becomes the selected engine. The version-check failure does not hang indefinitely.

### INS-05 — Missing executable and repair [P0]

**Precondition:** Installed engine; all owned OpenCode processes stopped.

1. Move the managed executable to a backup location within the disposable test profile.
2. Click Re-check in Settings.
3. Enable/reinstall again.

**Expected:** Re-check reports Not installed despite any stale metadata. Repair downloads/validates the managed executable and restores installation status. Credentials/conversations remain intact.

### INS-06 — Global installation and state are untouched [P0]

1. In the disposable account, prepare a separate global OpenCode installation/configuration with distinctive nonsecret settings. Record config hashes and global credential-file modification times without opening secrets in shared tooling.
2. Launch managed provider setup and a coding turn.
3. Inspect managed process executable paths and compare global files afterward.

**Expected:** Rowboat selects its pinned executable, does not import global credentials automatically, and does not modify global OpenCode configuration/authentication state. Deliberate project configuration remains visible to coding.

### INS-07 — Paths and inherited environment [P1]

1. Launch Rowboat from a path/profile and project path containing spaces.
2. In the disposable launch environment, set an OpenCode config override pointing at a harmless distinctive test config and a dummy provider-key environment variable.
3. Start setup and coding; run a harmless project command such as `node --version` after approval.

**Expected:** Managed launches work without shell quoting failures. Inherited overrides/dummy credentials do not silently optionally connect Go or Zen or change managed configuration. Project tools remain reachable on PATH.

## 5. Provider setup

### AUTH-01 - Start without an OpenCode account [P0]

1. Use a clean disposable Rowboat profile without OpenCode credentials, and configure a Rowboat chat model.
2. Enable OpenCode and create a Code session in Repository A.
3. Open the model picker in the Code header and choose an advertised free model.
4. Ask it to inspect the project; approve any requested reads.

Expected: no OpenCode account gate or provider wizard. The composer displays the Rowboat chat model and the Code header displays the separate OpenCode coding model. Native activity and response appear. If the upstream public service is unavailable, record Blocked with the error; installation must not be reported missing.

### AUTH-02 - Optional Go account [P0]

1. Open Settings - Code Mode - OpenCode - Connect Go / Zen (optional).
2. Open the account page, choose Go and paste its account key. Save.
3. Return to Code mode and choose a Go model; send a short request.

Expected: the field clears immediately. Settings says key saved, never verified/Ready merely from saving. The Code picker refreshes without app restart, labels Go, and the request uses that exact model.

### AUTH-03 - Optional Zen account [P0]

1. Choose Zen in account setup and save a valid account key.
2. Select a Zen model in Code mode and send a short request.
3. If Go is also connected, switch explicitly between Go and Zen models.

Expected: billing distinctions are visible. Saving one service does not silently connect the other. Rowboat never automatically falls back from Go to Zen or changes the selected model after an error.

### AUTH-04 - Invalid key and entitlement failure [P0]

1. Save a dummy invalid key for a test account option.
2. Choose a model requiring that account and submit a prompt.
3. Replace it with a valid key and retry; separately test a model outside the account entitlement if available.

Expected: saving alone makes no success claim about inference. The coding error is readable and secret-free. A failed request does not silently switch models. A corrected key refreshes options without app restart.

### AUTH-05 - Free model disappears or is rate limited [P1]

1. Use a controlled response fixture to return unavailable-model or rate-limit failure for a selected public model.
2. Refresh the picker and choose another advertised free model.

Expected: a visible recoverable error; no forced paid upgrade, automatic paid fallback, or hardcoded stale free-model list.

### AUTH-06 - No unrelated providers in the picker [P0]

1. Seed an unrelated provider credential in a disposable managed profile, or use retained state from an earlier build.
2. Reopen Settings and the Code model picker.
3. Open an old session that selected that unrelated provider.

Expected: Settings offers only Go/Zen, Code discovery only OpenCode models. The old selection requires an explicit supported choice; conversations and unrelated credential files are not deleted.

### AUTH-07 - Switch account form with an unsaved key [P0]

1. Type a dummy key into Go, then switch the account option to Zen.
2. Repeat in reverse, then close and reopen setup.

Expected: every switch clears the password field. No key is saved until Save account key is clicked; no key appears in storage, logs or conversation events.

### AUTH-08 - Setup failure and retry [P1]

1. Interrupt setup-service startup using a controlled test harness or remove the executable in a disposable profile.
2. Open account setup and inspect the error, then repair/re-check installation and retry.

Expected: a useful retry action, no false connected state, and no orphaned setup processes. No raw executable path is presented as a login action.

### AUTH-09 - Close setup and competing windows [P1]

1. Open account setup, close it while starting, then reopen it.
2. Open another Rowboat window and attempt setup concurrently.
3. Close the owning window and inspect native processes.

Expected: stale start responses clean up their own leases, ownership errors are clear, and closing the owner terminates its setup process without leaving secrets in the renderer.

### AUTH-10 - Disconnect and reconnect [P0]

1. Disconnect Go while Zen is connected; verify only Go credentials are removed.
2. Disconnect Zen, refresh Code model options and choose a public free model.
3. Send a request, then reconnect the desired account.

Expected: free coding still works without account keys. An old paid selection reports unavailability until explicitly changed. Reconnection refreshes the picker without restart.

Also verify all picker states: neither connected shows only free models; Go-only hides all Zen models; Zen-only hides Go models. When both are connected, switching Go/Zen changes the displayed list without sending a model update until a model is chosen. Disconnect the displayed service while the picker is open and verify the list refreshes to the remaining service. Submit a stale model selection through the test harness and confirm the backend rejects it before inference.

### AUTH-11 - Secret handling and model delegation audit [P0]

1. Save a distinctive dummy key; inspect renderer persistence, conversation events and logs without publishing actual secrets.
2. Select a Rowboat chat model in the composer and a free OpenCode model in the Code header, then send a coding request.
3. Inspect transport records using the controlled harness and restart/resume the session.

Expected: no account key appears in those stores. Rowboat uses the selected chat model to delegate to OpenCode and provide a brief response. Native coding uses the separately selected OpenCode model; session history resumes without duplicate replay. Normal title generation may use the configured Rowboat model.

## 6. Coding, history and workspace

### CODE-01 — Select OpenCode across entry points [P0]

1. Confirm OpenCode is available through onboarding setup, Settings, composer agent selection, new Code session selection, session header and session list.
2. Create a session explicitly using OpenCode.
3. Send a prompt and inspect the run's agent label.

**Expected:** Selection reaches the runtime as OpenCode and labels remain consistent. No surface labels an OpenCode run as Codex/Claude. Installation/connection failures lead back to usable Settings actions.

### CODE-02 — Inspect the actual worktree [P0]

1. Create a Code session for Project A with worktree isolation.
2. Record the displayed worktree path and branch.
3. Prompt: `Inspect sum.js and sum.test.js. Report the defect and the working directory. Do not edit files or run tests yet.`
4. Approve read actions as needed under Ask; inspect original checkout and worktree afterward.

**Expected:** The session uses the recorded worktree, not the original checkout. Inspection is reflected in the timeline. No files change. Do not use the model's claimed cwd as sole proof: compare session metadata and later file changes.

### CODE-03 — Approve an edit and run tests [P0]

1. Prompt: `Fix only the sum function, then run npm test. Ask through the approval cards before actions that require approval.`
2. Inspect the proposed edit and approve it once.
3. Inspect the command and approve `npm test`.
4. Inspect timeline output and the repository Changes view.

**Expected:** The worktree's `sum.js` changes from subtraction to addition. Tests pass and their output is visible. The correct file appears in Changes. The original checkout remains unchanged until an explicit merge action.

### CODE-04 — Failure output and previews [P0]

1. In a fresh defective fixture, ask to run `npm test` without fixing anything and approve the command.
2. Expand command output.
3. Request the fix and inspect its before/after preview before approving.
4. With a controlled fixture, produce output larger than 64 KiB.

**Expected:** Failed-tool status and useful failure text remain visible. The preview shows the actual file/content change. Oversized output has an explicit truncation marker, not an unexplained empty/generic event.

### CODE-05 — Follow-up and app restart [P0]

1. Tell the coding agent: `Remember the project marker QA-RESUME-742 for this conversation; do not write it to a file.`
2. Complete another turn, then stop/quit Rowboat normally.
3. Reopen the same session and ask: `What project marker did I give you, and what file did we change? Inspect the current file if needed.`
4. Compare native session IDs before/after locally and count existing transcript entries.

**Expected:** The same native session resumes and retains useful context. Prior user/agent messages are not replayed as duplicate Rowboat entries. Native ID/cwd evidence is authoritative; a correct marker answer alone is insufficient proof.

### CODE-06 — Missing/corrupt native session metadata [P0; disposable profile]

1. Back up the test session state while Rowboat is closed.
2. With a controlled harness, remove its native session while keeping Rowboat metadata/history, then reopen and submit a follow-up.
3. Separately corrupt the test Rowboat ACP session metadata JSON or change its state-namespace/cwd association.

**Expected:** Explicit recovery errors identify that the saved session cannot be used. Rowboat does not silently create a replacement and claim continuity. Existing conversation evidence remains intact. Restore the backup or create a new Code session for recovery.

### CODE-07 — Stop and quit during a running command [P0]

1. Prompt the agent to run `node heartbeat.cjs`, and approve the exact command.
2. Confirm `heartbeat.log` is growing in the worktree and record the child PID.
3. Click Stop; wait at least five seconds and observe the file and process tree.
4. Repeat in a fresh turn, quitting Rowboat instead of clicking Stop.

**Expected:** The operation unwinds, the composer becomes usable after Stop, and the owned process tree exits. Heartbeat growth stops. Reopening Rowboat does not leave a stale running state or orphan command. A process that continues writing is a release-blocking failure.

### CODE-08 — Stop during startup and simultaneous prompts [P1; harness if needed]

1. Send a prompt with a cold engine and immediately click Stop during startup/model configuration.
2. Confirm no delayed project edit begins after cancellation.
3. Attempt two simultaneous prompts against the same Code session using a controlled dispatcher harness.

**Expected:** Cancellation also covers preparation, not just streaming. One session cannot run two overlapping operations; the second request receives a clear error. No extra native conversation or orphan process is created.

## 7. Permission behavior

For each case, record the chosen policy and actual approval card. If the model refuses to attempt the requested test action or chooses a different tool, record **Blocked** and use a deterministic test provider/harness; a model refusal is not proof that the permission system denied execution.

### PERM-01 — Reject an edit [P0]

1. Select Ask and record the hash/content of `sum.js`.
2. Request a specific change to that file.
3. Inspect the proposed change, then click Deny.
4. Compare file contents and Git diff.

**Expected:** The rejected edit does not occur. The timeline records the rejection/failed action accurately. A proposed diff alone must not mark the filesystem edit as applied.

### PERM-02 — Reject a command [P0]

1. Under Ask, request the explicit command `node -e "require('fs').writeFileSync('denied-command.txt','unexpected')"` in the disposable project.
2. Deny the command approval and inspect the directory.

**Expected:** `denied-command.txt` is absent. No alternative command performs the rejected action silently. The denied command remains identifiable in the timeline.

### PERM-03 — Allow once stays local [P0]

1. Under Ask, approve one write to `first.txt`.
2. Request a write to `second.txt`; deny it.
3. Request another write to `first.txt` on the next turn.

**Expected:** The second and third actions require fresh approval. Approving one edit does not approve the entire edit tool kind. OpenCode's card has no Always allow button. A forced persistent decision through the harness rejects safely.

### PERM-04 — Auto-approve reads [P1]

1. Select Auto-approve reads while idle.
2. Request a file inspection, then an edit and a test command.
3. Observe which actions proceed automatically and which display cards.

**Expected:** Eligible read/search/fetch/think requests can receive automatic allow-once. Edits and commands still require approval. Explicit configured denial rules are never converted to approvals.

### PERM-05 — YOLO → Ask [P0]

1. In an idle session, select YOLO and request a harmless marker-file edit.
2. After the turn finishes, switch to Ask.
3. Request another edit of the same file using the same tool; deny it.

**Expected:** The YOLO action runs automatically, subject to explicit denials. The later Ask action requires a fresh card and rejection prevents the edit. No remembered upstream approval survives the policy change.

### PERM-06 — Plan → Build and explicit denial preservation [P0]

1. Select Plan and request a proposed fix; confirm no unapproved implementation occurs.
2. Switch to Build while idle, request the implementation and approve it.
3. In Project A, select `qa-review` and request an edit/command; repeat under YOLO.

**Expected:** Leaving Plan permits Build actions through the current approval policy. The custom mode's explicit edit/bash denials still prevent those actions, including in YOLO. Rowboat removes only its own obsolete mode restrictions, not project/session denials.

### PERM-07 — Policy change or shutdown while approval is pending [P0]

1. Leave an edit approval unanswered.
2. Attempt to change approval policy/model/mode during the running operation.
3. Click Stop, then try responding to the old card.
4. Repeat with application shutdown while the card is pending.

**Expected:** Configuration changes during a running operation request that it be stopped first. Stop/disconnect rejects pending requests. An old or late Allow cannot execute the edit after the operation has ended. Restart does not restore a live approval against a dead process.

### PERM-08 — Subagents and structured questions remain unavailable [P0]

1. Ask OpenCode to delegate a task to a subagent, first under Ask and then YOLO.
2. Where a deterministic fixture exists, attempt the upstream `task` and structured `question` tools directly.
3. Inspect the header's capability note and the resulting turn.

**Expected:** Subagent task execution is denied, rather than running without Rowboat approvals. Structured questions cannot leave the session hanging on an unsupported question interface. Ordinary textual questions remain possible. The UI states the subagent limitation.

### PERM-09 — MCP and external permission changes [P1; controlled fixture]

1. Configure a trusted local test MCP server with observable harmless read/write tools.
2. Under Ask, invoke its write tool and deny it; repeat after configuring an explicit denial, including under YOLO.
3. In a disposable session, replace the native permission rules outside Rowboat using the test harness, then send a new turn.

**Expected:** An MCP write requiring approval cannot proceed after denial; explicit denials remain effective. Unexpected replacement of Rowboat-tracked native rules causes a safe recovery error before another prompt, rather than silently widening permissions. Record the exact tool name and matched configuration rule.

## 8. Stage 7: model, effort and mode selection

### MOD-01 — Qualified model IDs and accepted selection [P0]

1. Create an OpenCode session without an account and select a free model in Code mode. Repeat with optional Go/Zen accounts.
2. Open the session header's Model menu and record labels and full IDs.
3. Select another accessible model, close/reopen the menu and send a short coding prompt.
4. Inspect accepted session metadata and, where available, provider request/model evidence.

**Expected:** Provider-qualified IDs are preserved. New sessions expose the native available choices; existing sessions keep their own accepted choice. Old Settings selections do not seed new sessions. The backend accepts the change before saving it. A label alone is not sufficient evidence of the model actually used.

### MOD-02 — Advertised effort appears [P1]

1. Select a model known to advertise effort through this engine/provider.
2. Open Effort and select each intended supported level, sending a short turn with at least two levels.
3. Close/reopen the session settings.

**Expected:** Only engine-advertised values appear. The selected value is accepted and persisted. No fabricated effort option or OpenCode synthetic Default value is inserted.

### MOD-03 — Unsupported effort disappears [P0]

1. Start with a model and effort selected in MOD-02.
2. Switch to a model that advertises no effort option.
3. Reopen settings and send a turn.

**Expected:** Effort selection disappears and stale effort is cleared. The turn does not send an unsupported old effort value. The header does not continue claiming that value is active.

### MOD-04 — Build, Plan and custom primary modes [P0]

1. In Project A's session, open Mode and select Build, then Plan, then `qa-review`, while idle.
2. Close/reopen settings after each selection and send an appropriate inspection prompt.
3. Run PERM-06 for behavioral confirmation.

**Expected:** Modes are separate from engine/model selectors. Advertised custom primary modes appear and the accepted mode persists. Mode behavior respects its resolved restrictions.

### MOD-05 — Project/worktree isolation of discovery [P0]

1. Open Project A and Project B sessions alternately.
2. Confirm `qa-review` appears only in Project A's configured working directory.
3. Add a distinctly named custom mode to one session's worktree configuration, then reopen its picker.
4. Reopen the other session's picker.

**Expected:** Choices follow the actual cwd/worktree. No per-agent shared cache leaks one project's options into another. A committed original-checkout configuration is not mistaken for a later worktree-only change.

### MOD-06 — Provider/configuration changes without app restart [P0]

1. Keep a Code session available, then connect an optional Go or Zen account through Settings.
2. Return to the session and reopen the model picker.
3. Disconnect that provider and reopen again.
4. Modify the session worktree's supported configuration and reopen the picker once more.

**Expected:** Discovery runs against current credentials/configuration without restarting Rowboat. Record what the engine advertises: some catalogs may include models from disconnected providers, but attempting to use them must not silently succeed under another provider. Existing invalid selections produce a clear error/recovery path.

### MOD-07 — Unavailable model and recovery [P0]

1. Select a valid model, then make it unavailable using a controlled project/provider configuration or fixture.
2. Reopen the picker and attempt a turn.
3. Choose a valid advertised alternative.

**Expected:** An unavailable-model/selection error is visible. Rowboat does not silently run a default model while claiming the old one. Discovery still offers valid alternatives where the engine can load its catalog. Selecting an alternative clears the problem after backend acceptance.

### MOD-08 — Rejected selection does not persist [P0; harness for deterministic rejection]

1. Record the current accepted model/effort/mode and stored session metadata.
2. Make the engine reject one proposed change, or remove the selected option between discovery and submission.
3. Attempt the change and reopen settings.

**Expected:** An error appears and the previous accepted value remains stored. The UI does not claim that the rejected choice became active. A subsequent valid selection succeeds without recreating the Rowboat conversation.

### MOD-09 — Refresh latency, repeated opening and idle cleanup [P1]

1. Open/close the picker repeatedly, including shortly after a provider/configuration change.
2. Observe loading/error states and the managed OpenCode process list.
3. After discovery settles and no coding/setup is active, check for lingering discovery processes.

**Expected:** Cold discovery can take several seconds; the UI remains responsive and never fabricates options to hide failures. Discovery sessions/processes are cleaned up. Results from an older UI request do not overwrite newer project/model selections.

## 9. Retention, release and platform coverage

### REL-01 — Remove/reinstall with retained state [P0]

1. Finish a coding turn and record session IDs, selected model and conversation history.
2. Remove the engine through Settings.
3. Confirm installation becomes Not installed and managed processes stop.
4. Reinstall, reopen provider setup and resume the existing Code session.

**Expected:** Engine files are removed separately from managed credentials/conversations. Retained credentials remain configured but require a fresh verification to claim Ready. An intact native session resumes after reinstall. Reinstallation does not import global state or replay duplicate history.

### REL-02 — Engine removal/shutdown during activity [P0]

1. In separate disposable runs, remove the engine or quit while setup, model discovery, an approval, and a heartbeat command are active.
2. Inspect process trees, listener closure and heartbeat growth.
3. Restart and inspect installation/connection/session states.

**Expected:** Owned operations fail/cancel coherently and no child process or authenticated setup listener remains orphaned. Installation status follows validated files, not stale metadata. Preserved state supports explicit recovery.

### REL-03 — Packaged Windows acceptance [P0]

1. Install/run the packaged build from a path containing spaces with ordinary user permissions.
2. Run INS-01, AUTH-01, CODE-01 through CODE-07, PERM-01 through PERM-07, MOD-01 through MOD-08 and REL-01.
3. Exercise public free-model access and optional Go and Zen accounts.

**Expected:** The complete flow works without a development checkout, global OpenCode or developer-only PATH assumptions. Native login dependencies are packaged correctly. Record the installer/build identity separately from development-mode results.

### REL-04 — macOS and Linux acceptance [P0 for each claimed platform]

1. Repeat REL-03's applicable sequence on each OS/architecture you intend to support, using actual packaged builds.
2. Launch from the desktop/application launcher, not only from a terminal; check project-tool PATH and executable permissions.
3. Verify process-tree cleanup and native login on that OS.
4. For Linux, record distribution/libc and extraction/runtime prerequisites. Test musl only if the application itself claims support for that environment.

**Expected:** Native behavior is demonstrated on each claimed platform. Registry package availability or mocked platform tests do not count as execution evidence. Untested architectures remain explicitly unverified.

### REL-05 — Claude/Codex regression [P1]

1. Open existing Claude and Codex Code sessions in the test profile.
2. Run a short inspection and approved/rejected action; check model selection and resume.
3. Switch a disposable session between engines and inspect labels/model selections.

**Expected:** Existing engines still function. Agent-specific selections do not leak across engines. Shared broker changes never widen allow-once or fall back to an unrelated permission option. Cross-engine switching is a new native conversation, not a promised history migration.

## 10. Release sign-off

- All applicable P0 cases pass on the actual release build/platform.
- P1 failures/blocks have an explicit disposition and do not contradict advertised support.
- Real-account Go/Zen and public-model results are recorded separately.
- No known secret exposure, denied-action execution, orphan process or silent session replacement remains.
- The product and release notes retain the current limitations: one-time OpenCode approvals; subagent tasks and structured question UI unavailable.
- Attach the completed run records and issues. Leave untested platforms/methods marked unverified; do not replace missing evidence with automated-test results.
