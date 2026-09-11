# OpenCode coding runtime — stages 5–7

Enable OpenCode and create a Code session, choose a free model in the session header, and start coding without an account. Optionally connect Go or Zen in Settings for additional models. Model/effort/mode selection lives in Code mode and uses the actual worktree. Old Settings model selections are ignored. The native engine advertises available OpenCode models; Rowboat does not hardcode free model IDs.

OpenCode uses the same two-model flow as Codex: the composer selects the Rowboat chat model, which delegates through `code_agent_run`; the Code header selects the native OpenCode coding model. A Rowboat chat model is required even when using a free OpenCode model. Approvals, native session resume and timeline persistence remain unchanged. Already-persisted direct-dispatch turns retain a compatibility adapter, while new turns use normal delegation.

## Sessions and configuration

Coding uses native ACP over stdio. The managed process service supplies the executable, isolated state, authenticated loopback listener and process-tree cleanup. ACP capabilities, native session ID, engine version, working directory and state namespace are recorded with Rowboat session metadata. Cold turns load the same native session; replayed history is muted because Rowboat already owns its durable transcript. An unreadable metadata file, missing native session or incompatible directory produces a recovery error without silently starting a replacement conversation.

OpenCode processes end after every turn. This reloads credentials/project configuration and clears the engine's in-memory approvals before another turn. Cancellation also covers startup and configuration changes, and pending approvals reject on disconnect. Concurrent prompts for the same session are rejected. Stop the current operation before changing its approval policy or selections.

OpenCode model discovery always uses a fresh process in the actual project/worktree directory. It is deliberately uncached, rather than sharing the older agents' per-agent cache: engine, provider, project and configuration changes cannot reuse stale options. This costs a cold start when opening the picker. Only advertised effort values are shown, with no synthetic Default choice for OpenCode. The backend validates changes before persisting them and applies them again before each prompt. Unavailable selections produce an error while discovery still offers the advertised alternatives. Accepted configuration events update session metadata.

## Approval policy

Before a prompt, Rowboat configures the idle native session through its private HTTP listener. Prompts, streaming, session load, cancellation and approval replies use ACP. Rowboat appends an Ask rule and then explicit denial rules from the selected agent's resolved project/global configuration and the session's original rules. The backend verifies the resulting rule suffix before coding starts. Metadata distinguishes Rowboat-owned mode restrictions from external rules, so Plan → Build can remove the former while preserving the latter. Unexpected external replacement of these rules fails closed.

| Rowboat policy | OpenCode behavior |
| --- | --- |
| Ask | Each requested action goes to an approval card. |
| Auto-approve reads | Read/search/fetch/think requests receive allow-once; other actions ask. |
| YOLO | Requests receive allow-once automatically; explicit denials still apply. |
| Deny / stopped / disconnected | A matching reject option or ACP cancelled response; never an arbitrary option. |

Rowboat no longer remembers approvals by broad tool kind. It never converts allow-once to allow-always. OpenCode's pinned ACP bridge does not communicate the scope of persistent approvals, so its Always allow control is hidden and a forced persistent decision rejects safely.

**Subagent tasks are disabled for this release.** In OpenCode 1.18.30, child sessions do not inherit the parent's Ask rules and the ACP permission bridge only handles registered ACP sessions. Rowboat denies `task` even in YOLO; this restriction is visible in the session settings. Structured `question` is also denied until a question interface exists. Custom primary modes and MCP actions use the selected mode's resolved denial rules and the same broker. Project tools and plugins still run with the user's permissions; state isolation is not a sandbox.

## Timeline

Tool status, late titles, command text/output, failed-tool output, diff paths and before/after edit previews survive normalization and durable replay. Command output has an explicit 64 KiB truncation marker. Permission cards expose the proposed command and edit preview. Raw provider error bodies and engine stderr are excluded from OpenCode error messages because they may echo authentication data. Errors retain the phase, safe exit details and recognized authentication/model/timeout recovery guidance.

## Validation and release gates

Automated native Windows validation downloads 1.18.30 into a temporary home containing spaces and uses a local fake inference provider with dummy credentials. It covers installation, isolated setup, API-key verification/failure, managed login PTY startup, two-project mode discovery, actual approved/rejected file writes, command output and rejection, cancellation during approval, cold-process resume without user-history replay, YOLO → Ask, Plan → Build, unavailable models, deleted native sessions, and retained state after removal. Focused tests cover permission fallback/scoping, malformed permission catalogs, mode changes with explicit denials, selection persistence, rich timeline reduction and UI agent selection.

Run the opt-in native sequence from `apps/x/packages/core`:

```powershell
$env:ROWBOAT_OPENCODE_SMOKE='1'
node node_modules/vitest/vitest.mjs run src/code-mode/acp/opencode-smoke.test.ts
```

Stage 8 remains a release gate: exercise the full Electron UI in a real Git worktree, packaged Windows builds, real Go/Zen accounts, public-model availability and network loss, long-running child commands on shutdown, and native macOS/Linux builds. The native test uses a temporary project, not an Electron window or a real provider account. Do not infer packaged or cross-platform certification from the Windows tests. Structured questions, attachments, richer subagent presentation/history operations, configuration import, WSL and managed local models remain deferred.
