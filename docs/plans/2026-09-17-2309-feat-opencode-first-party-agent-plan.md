---
title: OpenCode First-Party Code Agent - Plan
type: feat
date: 2026-09-17
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# OpenCode First-Party Code Agent - Plan

## Goal Capsule

- **Objective:** In the Rowboat desktop app, a user who has OpenCode installed can choose it like Claude Code or Codex — the app detects it, shows its status and version, labels it "OpenCode" in the picker, chat, and assistant prompt, and the assistant can hand coding tasks to it with the same streaming, permissions, and session behavior as the managed engines.
- **Means:** One coding-agent registry describing each agent (managed vs external, launch, detection, status), with every agent enumeration derived from it (KTD1).
- **Authority:** Session-settled decisions override inference; Key Decisions own product scope; KTDs own mechanism.
- **Stop conditions:** A session-settled decision proves infeasible on evidence (return `settled-decision-invalidated`); or the fork/push path proves unavailable (report blocked with recovery).
- **Target repo/branch:** `duketopceo/rowboat`, branch `feat/opencode-acp-support`, upstream PR rowboatlabs/rowboat#1092.
- **Who finishes:** `ce-work` executes U1–U8; LFG ships the PR.

## Product Contract

### Summary

OpenCode has a partially-wired ACP launch path but is invisible to the user and the assistant. This plan promotes it to a first-party agent by generalizing the agent surface into a registry and sweeping the hardcoded claude/codex enumerations across shared, core, main, server, and renderer.

### Problem Frame

Commit `0c9516d2` added `opencode` to the `CodingAgent` type and a native `opencode acp` spawn, but left the status, tool, prompt, and UI layers at two agents. Consequences on the branch today: `AGENT_LABEL: Record<CodingAgent, string>` in `apps/x/apps/renderer/src/components/code/code-agent-status.ts` omits `opencode` and breaks typecheck; `code_agent_run`'s input enum rejects it; the code-mode prompt (`agentDisplay = codeMode === "claude" ? "Claude Code" : "Codex"`) tells the assistant it is running Codex; Settings/onboarding cannot show or detect it; the composer only toggles between two agents; and `isEngineProvisioned`/`ensureEngine` index `ENGINE_MANIFEST[agent]` unguarded, so any external agent would throw.

### Requirements

**Agent selection and identity**

- R1. OpenCode appears as a selectable agent labeled "OpenCode" everywhere an agent is chosen or displayed: composer chip, code-session header and rail, Settings → Code Mode, onboarding, and run cards.
- R2. The assistant's mode prompt and `code_agent_run` describe OpenCode as OpenCode — never as Codex.

**Detection and status**

- R3. A known external agent is auto-detected by resolving its binary on the login-shell PATH (fallback: well-known install paths) and probing its version; Settings and onboarding show detected/not-detected plus version with no download step.
- R4. `checkCodeModeAgentStatus` returns a registry-keyed map covering every known agent; `installed` means "engine provisioned" for managed agents and "binary resolvable on PATH" for external agents. Readiness for an external agent is decided by detection, not by a sign-in probe.

**Launch**

- R5. OpenCode launches over ACP from the same absolute resolved path the detection probe used, so a GUI launch and the status probe never disagree.
- R6. The managed provisioner is never invoked for an external agent; `isEngineSupported`, `isEngineProvisioned`, `ensureEngine`, and `getProvisionedEnginePath` never throw for a known external agent.

**Assistant and permissions**

- R7. `code_agent_run` accepts `opencode` and forwards it; the pinned session agent and composer chip keep precedence over the model's argument.
- R8. Approval policy, permission classification, streaming, and session resume behave the same for OpenCode as for the managed agents.

**Extensibility**

- R9. Adding another known CLI coding agent requires one shared catalog entry (id, label, strategy) plus one core descriptor and its tests — no scattered claude/codex conditionals.

### Scope Boundaries

- **Deferred for later:** auto-enumerating arbitrary or unknown ACP CLIs found on PATH; OpenCode-specific model/effort configuration beyond the generic picker; Windows OpenCode install shims.
- **Outside this product's identity:** replacing the managed, version-pinned engines for Claude Code and Codex with user-installed CLIs.

### Success Criteria

- `npm run typecheck` and `npm run test` pass from `apps/x` on the branch.
- On a machine with OpenCode installed and then with it removed, Settings reflects detect/not-detect without errors.
- A `code_agent_run` turn with the chip on OpenCode streams tool calls and honors a permission ask.

### Assumptions

- OpenCode auth is whatever `opencode` itself resolves at run time. Its `signedIn` field is best-effort (for example from `opencode auth list` credentials) and an indeterminate answer is not treated as signed-out; external-agent readiness is `installed` alone, so a detectable binary is selectable.
- A minimum OpenCode version for ACP compatibility is defined at implementation from `opencode --version`; the launch path additionally relies on the ACP `initialize` handshake to reject an incompatible protocol rather than treating a version number as authority.
- "Other CLI code tools auto-detected" is satisfied, in this plan, by the registry seam plus OpenCode; unknown tools are deferred because with no descriptor they would lack a label, auth probe, model discovery, and permission classification — second-class presented as first-party.

## Planning Contract

### Key Decisions

- K1. **First-party parity means selectable, identified, status-visible, and permission-equivalent — not merely "a process spawns."** Governs R1, R2, R4, R8.

### Key Technical Decisions

- KTD1. Coding-agent knowledge is a registry split by runtime: a pure catalog in `@x/shared` (the `CodingAgent` ids, labels, and provisioning strategy — consumable by the renderer, which has no `@x/core` dependency) and a node-only descriptor table in core for launch specs and detection/auth probes, keyed by the same ids. Every agent enumeration derives from these. (session-settled: user-directed — chosen over adding more opencode conditionals in place: the user asked for other CLI tools to be addable the same way.)
- KTD2. OpenCode is an `external` agent: resolved from PATH via the login shell with `commonInstallPaths` fallback, probed with `--version`, launched by its resolved absolute path, never downloaded. (session-settled: user-directed — chosen over provisioning it through the npm-tarball path like Claude Code and Codex: OpenCode ships a native `opencode acp` server.)
- KTD3. Status becomes a registry-keyed map with per-strategy `installed` semantics, and readiness is strategy-aware: managed agents require installed-and-signed-in; external agents require installed. The managed provisioner and the `codeMode:provisionEngine` / `codeMode:engineProgress` IPC stay managed-only.
- KTD4. Agent identity in the prompt and the tool is generated from the registry; the binary claude↔codex composer toggle becomes a picker over ready agents.

### High-Level Technical Design

```mermaid
flowchart TB
  Cat[shared agent catalog: id/label/strategy] --> Prompt[modes agentDisplay + code_agent_run enum]
  Cat --> UI[settings / onboarding / composer picker / run cards]
  Reg[core agent descriptors: launch + probes] --> Launch[getAgentLaunchSpec]
  Reg --> Detect[detect + version probe]
  Cat --> Reg
  Detect --> Status[checkCodeModeAgentStatus]
  Status --> UI
  Launch --> ACP[AcpClient -> opencode acp | adapter + engine]
```

Descriptor shapes (directional, not implementation specification):

- **managed** (claude, codex): ACP adapter package, `ENGINE_MANIFEST` key, engine env var (`CLAUDE_CODE_EXECUTABLE` / `CODEX_PATH`), engine auth probe.
- **external** (opencode): binary names, version probe command, minimum version, auth hint, launched by its resolved absolute path with `acp`.

## Implementation Units

### U1. Agent registry and shared type sweep

- **Goal:** A shared agent catalog plus a core descriptor table enumerate known agents and expose label, strategy, and descriptor lookups; existing `Record<CodingAgent, …>` maps and label ternaries derive from them.
- **Requirements:** R1, R9
- **Dependencies:** none
- **Files:**
  - `apps/x/packages/shared/src/code-mode.ts` (id tuple, labels, strategy)
  - `apps/x/packages/shared/src/agent-catalog.ts` (create; pure metadata)
  - `apps/x/packages/core/src/code-mode/agent-registry.ts` (create; launch + probe descriptors)
  - `apps/x/packages/core/src/code-mode/agent-registry.test.ts` (create)
  - `apps/x/packages/core/src/code-mode/acp/agents.ts`
  - `apps/x/packages/core/src/code-mode/acp/engine-provisioner.ts`
  - `apps/x/apps/renderer/src/components/code/code-agent-status.ts`
- **Approach:** The renderer cannot import `@x/core`, so agent ids, labels, and strategy live in `@x/shared` (with `CodingAgent` derived from the id tuple) and the node-only launch/detection/auth descriptors live in core keyed by id. Export `knownAgents()`, `getAgentDescriptor(id)`, `agentLabel(id)`, `isExternalAgent(id)`. Fix `AGENT_LABEL` and every `Record<CodingAgent, …>` to cover `opencode`. Keep `withClaudeAliases` (`acp/client.ts`) agent-specific — do not force it into the registry.
- **Patterns to follow:** `MODES_CAPABILITIES` entry shape in `apps/x/packages/core/src/runtime/assembly/capabilities/modes.ts`; `AGENT_LABEL` in `acp/engine-provisioner.ts`.
- **Test scenarios:**
  - Catalog/registry return a descriptor for every member of `CodingAgent`; labels are `Claude Code`, `Codex`, `OpenCode`.
  - `isExternalAgent('opencode')` is true; false for `claude` and `codex`.
  - An unknown id fails `getAgentDescriptor` with a clear error naming the id.
  - Every `Record<CodingAgent, …>` label map in the swept files has a key per agent (compile-time; asserted by typecheck).
- **Verification:** `npm run typecheck` from `apps/x` passes for shared, core, and renderer.

### U2. External detection, version probe, and provisioner guards

- **Goal:** A known external agent can be resolved on PATH and version-probed; managed-only provisioner helpers branch on strategy and cannot throw for an external agent.
- **Requirements:** R3, R5, R6
- **Dependencies:** U1
- **Files:**
  - `apps/x/packages/core/src/code-mode/acp/external-agent.ts` (create)
  - `apps/x/packages/core/src/code-mode/acp/external-agent.test.ts` (create)
  - `apps/x/packages/core/src/code-mode/acp/engine-provisioner.ts`
  - `apps/x/packages/core/src/code-mode/acp/engine-provisioner.test.ts` (create)
- **Approach:** Factor a generic resolver from the `claude-exec.ts` pattern: `command -v <bin>` under the login shell, then fall back to `commonInstallPaths(bin)` extended with OpenCode's own install location (`~/.opencode/bin`, `~/.local/bin`); probe `<bin> --version` and parse a semver; enforce the descriptor's minimum version. `isEngineSupported` / `isEngineProvisioned` / `ensureEngine` / `getProvisionedEnginePath` return the external strategy result instead of indexing `ENGINE_MANIFEST` for external agents. Do not hand-edit `engine-manifest.ts` (generated).
- **Technical design:** resolver returns `{ path, version } | null`; launch and status both consume it so resolution is shared.
- **Patterns to follow:** `resolveClaudeBinaryUnix()` in `acp/claude-exec.ts`; `loginShellPath()` in `acp/shell-env.ts`; `commonInstallPaths()` in `code-mode/status.ts`.
- **Test scenarios:**
  - Resolver returns the absolute path and parsed version when the binary is on PATH.
  - Resolver falls back to a known install path when the login-shell probe misses.
  - Resolver returns null when the binary is absent (no throw).
  - Version parser handles a plain semver and rejects unparsable output.
  - Minimum-version gate rejects an older version and accepts a newer one.
  - `isEngineProvisioned('opencode')` returns a boolean (no `TypeError`); `isEngineSupported('opencode')` reflects the external strategy; `getProvisionedEnginePath('opencode')` returns the resolved path or a clear unresolved error; `ensureEngine('opencode')` does not attempt a download.
- **Verification:** external-agent and engine-provisioner tests pass; typecheck core passes.

### U3. Status contract generalized

- **Goal:** The status response covers every known agent, keyed by the registry, with per-strategy `installed` semantics, end to end through IPC.
- **Requirements:** R4
- **Dependencies:** U1, U2
- **Files:**
  - `apps/x/packages/core/src/code-mode/status.ts`
  - `apps/x/packages/core/src/code-mode/status.test.ts` (create)
  - `apps/x/packages/core/src/code-mode/types.ts`
  - `apps/x/packages/core/src/code-mode/repo.ts`
  - `apps/x/packages/shared/src/ipc.ts`
  - `apps/x/apps/main/src/ipc.ts`
  - `apps/x/apps/server/src/core-deps.ts`
  - `apps/x/apps/renderer/src/components/code/code-agent-status.ts`
  - `apps/x/apps/renderer/src/lib/code-mode-provisioning.ts`
- **Approach:** Return a registry-keyed map (for example `{ agents: Record<CodingAgent, AgentStatus> }`) so a new agent needs no schema edit; update every consumer in the same unit. External agents report `installed` from PATH resolution and include a version; managed agents report `installed` from `isEngineProvisioned`. Readiness checks become strategy-aware: managed requires installed-and-signed-in, external requires installed (an indeterminate sign-in probe must not hide a detectable agent). `codeMode:provisionEngine` and `codeMode:engineProgress` stay `['claude','codex']` (managed-only) and are not server-hosted.
- **Test scenarios:**
  - Status map contains an entry per known agent.
  - An external agent present on PATH reports `installed: true` with a version; absent reports `installed: false`.
  - Managed agents keep provisioned-engine semantics.
  - Readiness is strategy-aware: a detected external agent with indeterminate sign-in is ready; a managed agent that is not signed in is not.
  - Renderer status mapping tolerates an unknown/missing agent key.
- **Verification:** core and renderer tests pass; typecheck passes across shared, core, main, server, renderer.

### U4. Launch spec via registry with shared absolute path

- **Goal:** `getAgentLaunchSpec` derives command/args/env from the descriptor, and the external agent spawns from the resolved absolute path.
- **Requirements:** R5
- **Dependencies:** U1, U2
- **Files:**
  - `apps/x/packages/core/src/code-mode/acp/agents.ts`
  - `apps/x/packages/core/src/code-mode/acp/agents.test.ts` (create)
- **Approach:** Managed agents keep adapter + engine env vars; external agents use `{ command: <absolute resolved path>, args: ['acp'] }`. Keep the login-shell PATH graft. An unresolved external binary or unsupported version throws a clear, user-facing error.
- **Test scenarios:**
  - `getAgentLaunchSpec('opencode')` returns an absolute `command` when resolvable; a clear error when not.
  - Managed specs are byte-identical to today (adapter entry + env var).
  - PATH grafting still merges the login-shell PATH once.
- **Verification:** agents tests pass; typecheck core passes.

### U5. Assistant parity: tool enum and mode identity

- **Goal:** The assistant can select OpenCode and is told it is OpenCode.
- **Requirements:** R2, R7
- **Dependencies:** U1
- **Files:**
  - `apps/x/packages/core/src/runtime/tools/domains/code.ts`
  - `apps/x/packages/core/src/runtime/assembly/capabilities/modes.ts`
  - `apps/x/packages/core/src/runtime/assembly/capabilities/types.ts`
  - `apps/x/packages/core/src/runtime/assembly/skills/code-with-agents/skill.ts`
  - `apps/x/packages/core/src/runtime/tools/exec-tool.ts`
  - `apps/x/packages/core/src/application/lib/message-queue.ts`
  - `apps/x/packages/core/src/runtime/assembly/compose-instructions.test.ts` (snapshot)
- **Approach:** Derive the `code_agent_run` agent enum and description from the registry; derive `agentDisplay` from the registry and widen `CODE_MODE_TEMPLATE`'s `codeMode` type; update `code-with-agents` skill copy that names only claude/codex. Update the instructions snapshot intentionally.
- **Test scenarios:**
  - The composed code-mode prompt for `opencode` names "OpenCode" and does not say "Codex".
  - `code_agent_run`'s schema accepts `opencode`; pinned agent and `ctx.codeMode` still override the model argument.
  - The snapshot change is limited to the agent set/labels.
- **Verification:** core tests (including snapshot) pass and the snapshot diff shows only intended changes.

### U6. Settings and onboarding surfaces for detected agents

- **Goal:** Settings → Code Mode and onboarding show every known agent; external agents show detection and version with no download control.
- **Requirements:** R1, R3
- **Dependencies:** U3
- **Files:**
  - `apps/x/apps/renderer/src/components/settings-dialog.tsx`
  - `apps/x/apps/renderer/src/components/onboarding/steps/code-mode-step.tsx`
  - `apps/x/apps/renderer/src/lib/code-mode-provisioning.ts`
- **Approach:** Render agent rows from the shared catalog: managed rows keep the Enable/download-progress flow; the external row shows detected path/version or an install hint, with no `startProvisioning` call. Onboarding pre-selects only ready agents and never starts a download for an external agent.
- **Test scenarios:**
  - Settings lists an OpenCode row when the status map reports it installed, showing its version.
  - The external row exposes no Enable/provision action and triggers no `codeMode:provisionEngine` call.
  - Onboarding does not attempt to download an external agent.
- **Verification:** renderer tests pass; manual check in the running app.

### U7. Composer and agent picker support N agents

- **Goal:** A user can select OpenCode from the composer and code-session switchers; selection persists per directory.
- **Requirements:** R1
- **Dependencies:** U3
- **Files:**
  - `apps/x/apps/renderer/src/components/chat-input-with-mentions.tsx`
  - `apps/x/apps/renderer/src/components/spaces/composer.tsx`
  - `apps/x/apps/renderer/src/components/code/session-rail.tsx`
  - `apps/x/apps/renderer/src/components/code/code-session-header.tsx`
  - `apps/x/apps/renderer/src/components/code/code-view.tsx`
  - `apps/x/apps/renderer/src/components/coding-run.tsx`
  - `apps/x/apps/renderer/src/lib/spaces-rowboat.ts`
- **Approach:** Replace the binary next-agent toggle with a picker over ready agents derived from status; labels and agent names come from the shared catalog (the renderer cannot import `@x/core`). Remove the local `AGENT_LABEL` map and the `codingAgent === 'claude' ? 'Claude Code' : 'Codex'` ternaries in the run card and composer tooltip. Fall back to a ready agent when the persisted selection is not installed.
- **Test scenarios:**
  - The picker lists all ready agents including opencode.
  - Selecting opencode persists per directory and is sent as `codeMode` on submit.
  - A persisted selection that is no longer ready falls back without error.
  - An OpenCode run card and its composer tooltip read "OpenCode", not "Codex".
- **Verification:** renderer tests pass; manual check in the running app.

### U8. Cross-agent parity sweep and typecheck

- **Goal:** No remaining claude/codex hardcoding in the agent surface; permission classification is identical across agents; the branch typechecks and tests clean.
- **Requirements:** R8, R9
- **Dependencies:** U1–U7
- **Files:**
  - `apps/x/packages/core/src/code-mode/acp/permission-broker.test.ts` (create)
  - any residual files found by the sweep
- **Approach:** Grep for `'claude' | 'codex'` unions, `['claude','codex']` arrays, `Record<CodingAgent` maps, `Record<string, string>` label object literals, and `=== 'claude' ? … : …` label ternaries across `apps/x`, and repoint each to the shared catalog or widen it. Add a permission-classification test proving a read-kind tool auto-approves under `auto-approve-reads` and a write-kind does not, independently of agent id. Confirm no managed-only helper is reachable for an external agent.
- **Test scenarios:**
  - Under `auto-approve-reads`, a `read`/`search` permission ask auto-resolves; a `write` ask does not.
  - The same classification is produced for claude, codex, and opencode descriptors.
  - No `ENGINE_MANIFEST` access occurs for opencode on the status or launch path.
- **Verification:** `npm run typecheck` and `npm run test` pass from `apps/x`.

## Verification Contract

| Gate | Command (from `apps/x`) | Applies to |
|---|---|---|
| Types | `npm run typecheck` | All units |
| Unit tests | `npm run test` | U1–U8 |
| Lint | `npm run lint` | Changed files |
| Manual: detection | Settings → Code Mode with OpenCode present/removed | U2, U3, U6 |
| Manual: run | Composer chip on OpenCode; a streaming run with one permission ask | U4, U5, U7 |

Browser/runtime verification of the ACP round-trip requires the installed OpenCode binary and is done manually; a green "process spawned" check is not sufficient evidence on its own.

## Definition of Done

- `npm run typecheck` and `npm run test` pass from `apps/x` on the branch.
- R1–R9 are each satisfied and traceable to a unit; the instructions snapshot diff is limited to intended agent-set/label changes.
- `engine-manifest.ts` is unchanged (generated); no managed-only helper is invoked for OpenCode.
- OpenCode is selectable, correctly labeled in the UI and the assistant prompt, detected with a version in Settings, and can complete a streamed run with a permission ask.
- Abandoned-attempt code from this run is removed; superseded hardcoded enumerations (including local `Record<string, string>` label maps and label ternaries) are deleted rather than left beside the shared catalog.
