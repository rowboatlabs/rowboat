# Managed OpenCode contract (stages 1–4)

Rowboat launches only its downloaded, manifest-pinned native OpenCode executable. PATH and global installations never select an engine. Installation requires a matching metadata record, executable file, verified archive integrity and successful bounded version probe before activation. Concurrent Enable requests share one backend operation; cancellation of one subscriber does not cancel other subscribers.

Engine installation, optional account connection, and successful model access are separate states. Installation permits public free-model use without credentials. Go/Zen connection means an account key was saved; only a successful coding request establishes model access. No mandatory Settings verification or model selection is required.

All OpenCode processes (version probes, private setup HTTP service and native ACP) use the same environment builder. XDG config/data/cache/state roots live under `~/.rowboat/opencode/`. Inherited OpenCode overrides, provider credentials and runtime injection variables are excluded through a system/tool environment allowlist. PATH is retained for project tools. Global configuration and credentials are never automatically imported. The shared launch environment restricts enabled providers to `opencode` and `opencode-go`. Deliberate project configuration remains enabled for coding, so these roots are application-state isolation, not a filesystem sandbox; commands retain user permissions.

Setup uses a private authenticated loopback HTTP service owned by the backend. Coding uses ACP stdio with its internal HTTP listener also password protected, loopback-only and without discovery. Credentials must pass through narrow backend operations, never chat events, renderer persistence or logs. The Settings account form offers only OpenCode Go and Zen API-key access. Process handles and HTTP credentials never cross renderer IPC.

Stopping setup/coding and application shutdown terminate owned process trees. Removing an engine first stops its processes and cancels installation, then removes only the engine tree. Credentials and conversations survive removal and upgrades. Disconnecting a provider removes that provider's managed credentials; explicitly resetting OpenCode data remains a separate future operation. Old versions are retained rather than pruning binaries that may be in use.

The shared capability descriptors identify launch, provisioning, authentication and upstream session features. `codingEnabled` is a Rowboat release gate, distinct from upstream capabilities. Stage 5 must use the OpenCode process service rather than the adapter launcher; stage 6 must validate policy precedence before enabling coding. Stages 4–7 own verification, provider/model cache generations, native session persistence and approval semantics.

Windows is the initial validation target. Manifest entries for macOS/Linux describe available packages, not packaged-build certification. x64 uses baseline packages where published; musl never silently falls back to glibc for OpenCode.

## Validation for this milestone

The focused installer/environment/process suite covers integrity and network failures, extraction and version failures, deduplication/progress, caller cancellation, missing executables, repair, data retention, private launch arguments, startup timeout, spawn error, and shutdown cleanup. Settings tests cover installed-versus-ready presentation, missing executable re-check and engine removal. Session-rail tests cover Claude, Codex and OpenCode selection.

Run from `apps/x/packages/core`:

```powershell
node node_modules/vitest/vitest.mjs run src/code-mode/acp/engine-provisioner.test.ts src/code-mode/acp/opencode-environment.test.ts src/code-mode/acp/opencode-process.test.ts
$env:ROWBOAT_OPENCODE_SMOKE='1'
node node_modules/vitest/vitest.mjs run src/code-mode/acp/opencode-smoke.test.ts
```

The opt-in smoke test downloads the actual pinned package into a temporary home with spaces. It checks version validation, authenticated/unauthenticated HTTP access for both serve and ACP, listener closure after stop, and retained state on removal. Stage 4 extends it with the real provider/session APIs against a local fake inference provider: credential saving, verified model response, invalid-key rejection, disconnect, secret-free request bodies/logs, no tools exposed, and managed-login PTY startup/cleanup. It uses dummy credentials and no paid provider requests. The runtime smoke additionally exercises native ACP tools, permissions, model/mode discovery and cold-session resume; see the coding runtime contract. Packaged Electron builds, real account OAuth, long-running child-command shutdown, macOS/Linux and abnormal application crashes remain release acceptance gates.

The macOS/Linux follow-up audit rechecked all six package URLs, SHA-512 integrity values and OS/CPU metadata against the registry. Simulated platform tests cover Darwin x64/ARM64, Linux x64/ARM64 on glibc/musl, missing diagnostic reports, native Unix executable lookup, extraction arguments and owned process-group termination. A missing diagnostic report now checks the musl interpreter path instead of automatically selecting musl. Login-shell PATH discovery now invokes the shell directly with an argument array, including shell paths containing spaces. These checks passed on the Windows host; they are not native macOS/Linux execution tests. Linux requires a compatible native runtime and `tar` on PATH; listing a musl engine does not establish that the Electron application itself runs on Alpine.
