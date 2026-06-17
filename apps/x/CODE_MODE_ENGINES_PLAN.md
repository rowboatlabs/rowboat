# Code Mode — Managed Engine Provisioning Plan

Branch: `feat/code-mode-managed-engines` (off `dev` @ `8ce24ebb`)

## 1. Problem & Goal

Code mode runs two coding agents — **Claude Code** and **Codex** — by spawning their
ACP adapters, which in turn spawn a heavy **native engine binary** (~205 MB claude,
~194 MB codex). We need code mode to work in **packaged releases with ~99% reliability
for both agents**, without shipping a ~400 MB installer.

### Current state (HEAD = revert of #614)
- Packaged builds **do not stage** the ACP adapters, and `forge.config.cjs`
  `ignore: /^\/node_modules\//` strips them. At runtime `agents.ts` resolves the
  adapter via `require.resolve(...)` then spawns it — which **throws
  `Cannot find module '@agentclientprotocol/...'`**.
- **Net: packaged code mode is broken in every release.** It only works in `dev`
  because pnpm symlinks exist. There is no 400 MB bloat today — but no function either.

### Why the two prior approaches are insufficient
- **Bundle engines (A):** +~400 MB per installer (one claude + one codex native binary
  per OS/arch). Works offline, but installer is huge.
- **Drive from user's local install (B)** — what #614 settled on and was reverted:
  requires the user to have **both** CLIs installed **and** logged in, correct version,
  on the right PATH. Depends on the user's machine → **structurally cannot hit 99%**
  (version skew, GUI-launch PATH stripping, missing installs). This is why #614 was
  reverted.

## 2. Chosen Architecture — Managed Engine Provisioning (validated against Conductor)

Split the problem into **engine** vs **auth**, treat them differently — exactly what
Conductor (conductor.build) does:

1. **Engine = owned by the app.** We provision **version-pinned** engine binaries into
   **app-support** (`~/.rowboat/engines/<agent>/<version>/`), download-on-demand on first
   use, sha256-verified, symlink/path-pinned. Not the user's global npm, not their PATH.
   → no version skew, no PATH quirks → this is what delivers the 99%.
2. **Auth = reused from the user.** The engines read existing credentials
   (`~/.claude` API key / Pro / Max, `~/.codex` auth.json). No second login. `status.ts`
   already inspects these.

### Empirical proof from Conductor on this machine
- DMG is **123 MB** — far smaller than the ~400 MB of engines → engines are **not** in
  the installer; they're downloaded after install.
- Layout observed at `~/Library/Application Support/com.conductor.app/`:
  ```
  agent-binaries/claude/2.1.170/claude   (222 MB, single Mach-O arm64)
  agent-binaries/codex/0.138.0/codex     (205 MB, single Mach-O arm64)
  bin/claude -> agent-binaries/claude/2.1.170/claude   (symlink to active version)
  bin/codex  -> agent-binaries/codex/0.138.0/codex
  agent-binaries/.meta/claude-2.1.170.json  = {sha256, size, downloaded_at_unix_ms, ...}
  ```
- So: versioned dirs + stable symlink + sha256 `.meta` ledger + download. We mirror this.

## 3. Concrete facts that make this clean (verified)

### Adapters honor an external engine via env var (no code change in adapters needed)
- **Claude** — `@agentclientprotocol/claude-agent-acp@0.39.0`,
  `dist/acp-agent.js:39`: `if (process.env.CLAUDE_CODE_EXECUTABLE) return it;`
  and line 1552 `pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE ?? ...`.
  If unset and no bundled native dep → it throws "set CLAUDE_CODE_EXECUTABLE".
- **Codex** — `@agentclientprotocol/codex-acp@0.0.44`,
  `dist/index.js:20900`: `const codexPath = process.env["CODEX_PATH"] ?? "codex";`
  → `spawn(codexPath, ["app-server"])`.
- **Implication:** provisioning + setting these two env vars is the *entire* engine story.

### Our engine packages are already single self-contained binaries
- `@anthropic-ai/claude-agent-sdk-darwin-arm64@0.3.156` → contains one `claude`
  executable (+ LICENSE/README).
- `@openai/codex@0.128.0-darwin-arm64` → `vendor/<target>/codex/codex` native binary
  **plus a bundled `rg` (ripgrep) at `vendor/<target>/path/rg`** — see Risk R1.

### Pinned versions + platform package names (read from the installed adapter trees)
- **Claude:** adapter `claude-agent-acp@0.39.0` → engine `@anthropic-ai/claude-agent-sdk@0.3.156`.
  Platform optional deps `@anthropic-ai/claude-agent-sdk-<platform>@0.3.156`:
  `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `linux-x64-musl`,
  `linux-arm64-musl`, `win32-x64`, `win32-arm64`.
- **Codex:** adapter `codex-acp@0.0.44` → `@openai/codex@^0.128.0` (pnpm-**patched**, see R2).
  Platform deps aliased `@openai/codex-<platform>` → `npm:@openai/codex@0.128.0-<platform>`:
  `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win32-x64`, `win32-arm64`.

## 4. Distribution source — npm platform packages, adapter-pinned (DECIDED)

We fetch the **per-platform engine packages from the npm registry at the exact versions
our ACP adapters depend on**, extract the native binary, and provision it into
`~/.rowboat/engines/...`. No self-host, no curl installer, no fallback.

- **Tarball URL:** `https://registry.npmjs.org/<pkg>/-/<file>-<version>.tgz`
  - claude: `@anthropic-ai/claude-agent-sdk-<platform>@0.3.156` → extract the `claude` binary.
  - codex:  `@openai/codex@0.128.0-<platform>` → extract `vendor/<target>/codex/codex`
            **and keep `vendor/<target>/path/rg`** (see R1).
- **Why adapter-pinned npm (not curl installer, not release bucket, not self-host):**
  - The binary is the **exact version our adapter was built/tested against** → ACP
    handshake guaranteed → the key to ~99% reliability.
  - npm registry is highly available, immutable per-version, and the packument provides
    `dist.integrity` (sha512) + `dist.shasum` (sha1) → integrity verification with **zero
    infra**.
  - The official `curl | bash` installer is for end-users: it installs globally to
    `~/.local/bin` and **auto-updates in the background** — exactly what we must avoid. We
    want an isolated, pinned, app-managed copy that never moves under the adapter.
    (Conductor likewise fetches the raw binary rather than running the installer.)
- **Versions are read from our lockfile at build time** and embedded in
  `engine-manifest.json`, so the manifest can never drift from the adapters we ship.

### Reference: how this relates to Conductor / official installers
- Conductor self-hosts the same kind of native binaries on `storage.conductor.build`
  (raw/`.gz`/`.zst` + `{url,gzipUrl,zstdUrl,sha256}` manifest), pairing the adapters with
  recent **standalone CLI** versions (claude 2.1.x, codex 0.138). That proves recent
  versions work — but we deliberately pin to the **adapter's own** engine version for
  determinism.
- Official Claude releases also publish a GPG-signed `manifest.json` (SHA256/platform) at
  `downloads.claude.ai/claude-code-releases/<ver>/`. We don't use it now (npm is simpler
  and adapter-matched), but it's the upgrade path if we ever want the latest CLI line.
- If we later want control/availability/compression, we can mirror these npm tarballs to
  our own bucket — **runtime stays identical, only manifest URLs change.**

### Locked decisions
- **Source: npm platform packages, adapter-pinned versions (user).**
- **No self-host (user).**
- **Always provision; no fallback** to a user's pre-installed `claude`/`codex` (user).
  Reverted path B is fully retired.
- **Codex pnpm patch — IRRELEVANT (user):** it targets the JS launcher; we point
  `CODEX_PATH` at the native binary, so it does not apply. (Risk R2 removed.)

## 5. Design

### 5.1 Build-time: generate an engine manifest + stage adapter JS

**(a) Engine manifest (`engine-manifest.json`, embedded in the app).**
A build script reads the installed adapter dependency trees and emits, per agent:
```jsonc
{
  "claude": {
    "version": "0.3.156",
    "platforms": {
      "darwin-arm64": { "pkg": "@anthropic-ai/claude-agent-sdk-darwin-arm64",
                        "tarball": "https://registry.npmjs.org/.../-/...-0.3.156.tgz",
                        "integrity": "sha512-...",
                        "binRelPath": "claude" },
      "...": {}
    }
  },
  "codex": {
    "version": "0.128.0",
    "platforms": {
      "darwin-arm64": { "pkg": "@openai/codex-darwin-arm64",
                        "tarball": "https://registry.npmjs.org/...",
                        "integrity": "sha512-...",
                        "binRelPath": "vendor/aarch64-apple-darwin/codex/codex",
                        "extraPaths": ["vendor/aarch64-apple-darwin/path/rg"] }
    }
  }
}
```
- Versions + tarball URLs + integrity are pulled from the lockfile / npm packument so the
  manifest is always in sync with the adapters we ship. (Generating it at build time
  sidesteps hardcoding fragile package names.)
- `binRelPath` / `extraPaths` capture where the executable (and codex's `rg`) live inside
  each tarball.

**(b) Stage the ACP adapter JS into the package (the part of #614 we KEEP).**
The adapters themselves (tiny, ~15 MB total incl. their non-native JS deps) must exist on
disk in packaged builds so `agents.ts` can resolve + spawn them. In `forge.config.cjs`
`generateAssets`, stage the two adapters and their **non-native** production dependency
closure into `.package/acp/node_modules` (npm-style nested layout), and **exempt
`.package` from the `node_modules` ignore rule**. We **drop** #614's native-engine staging
entirely — engines come from provisioning, not the bundle.

### 5.2 Runtime: engine provisioner (new module in `packages/core`)

New file: `packages/core/src/code-mode/acp/engine-provisioner.ts`.

```
ensureEngine(agent): Promise<{ executablePath: string }>
  1. Read manifest entry for (agent, currentPlatform). Error clearly if unsupported.
  2. dir = ~/.rowboat/engines/<agent>/<version>/
  3. If dir exists AND .meta/<agent>-<version>.json sha256 matches → return binPath.
  4. Else acquire a cross-process lock (avoid double download), then:
     a. Download tarball to a temp file, streaming, with progress events.
     b. Verify integrity (sha512/sha256 from manifest).
     c. Extract into a temp dir, then atomic rename into <version>/ (tar gzip).
     d. chmod +x the binary (and codex's rg) on unix.
     e. Write .meta/<agent>-<version>.json {sha256, size, downloaded_at_unix_ms}.
  5. Return absolute path to the engine executable (binRelPath joined to dir).
```
- **Progress + cancellation** surfaced over IPC for the first-run "Downloading engine…" UI.
- **Offline / failure** → typed error with a clear, actionable message (not a hang).
- **Resumability / atomicity:** download to temp, verify, then rename; never leave a
  half-extracted version dir that passes the existence check.

### 5.3 Wire provisioning into launch

In `agents.ts` `getAgentLaunchSpec()` (currently sets only `CLAUDE_CODE_EXECUTABLE`):
- Make it (or its caller in `client.ts` / `manager.ts`) `await ensureEngine(agent)` first,
  then set:
  - claude → `env.CLAUDE_CODE_EXECUTABLE = <provisioned claude>`
  - codex  → `env.CODEX_PATH = <provisioned codex>` (and ensure its `rg` sibling resolves;
    keep the vendor dir layout intact so codex finds `../path/rg`).
- Keep `ELECTRON_RUN_AS_NODE=1` for the adapter spawn (unchanged).
- The provisioner replaces both the bundled-engine dependency *and* the reverted
  "resolve user's local install" path. (Optionally: if a healthy provisioned engine is
  absent but a compatible local install exists, we *may* fall back to it — but the default
  and reliable path is the provisioned engine. Decide in review; default = provisioned only.)

### 5.4 Status & UX (`status.ts` + renderer)
- `checkCodeModeAgentStatus()` becomes: engine = provisioned? (instead of "installed on
  PATH?"); auth = existing credentials present? (unchanged logic).
- First-run flow: user picks agent → if engine missing, show "Downloading <agent> engine
  (~200 MB), one time…" with progress; on completion, proceed. Subsequent uses: instant.
- Clear error states: download failed / offline / unsupported platform / auth missing.

## 6. File-by-file change plan

| File | Change |
|---|---|
| `apps/main/forge.config.cjs` | Stage adapter JS closure into `.package/acp/node_modules`; exempt `.package` from node_modules ignore; generate + copy `engine-manifest.json`. (No native engines staged.) |
| `apps/main/scripts/gen-engine-manifest.mjs` *(new)* | Build-time: read lockfile/packuments → emit `engine-manifest.json` (versions, tarball URLs, integrity, bin paths). |
| `packages/core/src/code-mode/acp/engine-provisioner.ts` *(new)* | `ensureEngine()` — download, verify, extract, lock, progress, `.meta` ledger. |
| `packages/core/src/code-mode/acp/agents.ts` | Resolve adapter from staged `.package/acp` first (fallback to node_modules in dev); `await ensureEngine`; set `CLAUDE_CODE_EXECUTABLE`/`CODEX_PATH` to provisioned binaries. |
| `packages/core/src/code-mode/acp/client.ts` / `manager.ts` | Await provisioning before spawn; surface provisioning progress/errors; keep startup deadline. |
| `packages/core/src/code-mode/status.ts` | Engine status = provisioned (not PATH); keep auth checks. |
| `apps/main/src/ipc.ts` + preload + renderer | IPC for provisioning progress + first-run download UI + error states. |
| CI (optional) | Smoke: packaged app boots each adapter, provisions a (small fake) engine, sets env var, answers ACP `initialize`; offline → clear error not a hang. |

## 7. Edge cases & risks

- **R1 — Codex needs `rg`.** The codex platform package bundles ripgrep at
  `vendor/<target>/path/rg`. We must extract/keep the vendor layout so codex finds it
  (don't extract the bare binary). Verify codex `app-server` boots from the provisioned dir.
- **R2 — Codex pnpm patch. RESOLVED (irrelevant).** The patch targets the JS launcher; we
  point `CODEX_PATH` at the native binary, so it does not apply.
- **R3 — Platform/arch matrix.** Manifest must cover darwin x64/arm64, linux x64/arm64
  (+musl for claude), win32 x64/arm64. Windows engine is `claude.exe`/`codex.exe`.
- **R4 — Integrity & supply chain.** Always verify the manifest integrity hash before
  chmod/exec. Treat a hash mismatch as a hard failure.
- **R5 — Disk + upgrades.** Versioned dirs accumulate. Add a cleanup that keeps only the
  active pinned version per agent.
- **R6 — First-run network.** Required once per agent; cached forever after. Must be a
  clear, cancellable UX, never a silent hang (reuse the #614 startup-deadline lesson).
- **R7 — code signing / Gatekeeper (macOS).** Downloaded native binaries aren't covered by
  our app's signature. Verify they run under Gatekeeper (they're already
  signed/notarized by Anthropic/OpenAI; quarantine attr may need clearing). Conductor runs
  them fine from app-support — confirm we do too.
- **R8 — `engine-manifest` staleness.** Manifest must regenerate whenever the adapter/engine
  versions change; tie generation into the build so it can't drift.

## 8. Phasing

1. **P1 — Packaging fix (unblocks dev→packaged parity):** stage adapter JS into `.package`,
   resolver checks staged path first. Verify packaged code mode can at least *spawn* the
   adapter. (Independent of provisioning; the part of #614 worth keeping.)
2. **P2 — Provisioner (core):** `ensureEngine()` + manifest + wire env vars. Verify both
   engines provision + boot from `~/.rowboat/engines` on macOS arm64.
3. **P3 — UX + status:** first-run download UI, status panel, error states.
4. **P4 — Cross-platform + CI smoke:** matrix manifest, mac/linux/win smoke.
5. **P5 — Polish:** version cleanup, cancellation, offline messaging, optional local-install
   fallback.

## 9. Decisions & remaining questions

### Resolved (locked)
1. **Source = npm platform packages, adapter-pinned versions** (not self-host, not curl
   installer, not release bucket).
2. **Always provision; no local-install fallback.**
3. **Codex pnpm patch irrelevant.**

### Still open (can decide during implementation)
- **Provision timing:** on first code-mode *use* (lazy) vs first app launch (eager,
  background download). Plan assumes **lazy + cached**.
- **Version-dir cleanup:** keep only the active pinned version per agent (R5).
- **Verify R1** (codex `rg`) and **R7** (Gatekeeper on downloaded macOS binaries) during P2.
