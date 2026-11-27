# Browser foundations: Step 0 baseline

Recorded on 2026-09-21 against upstream commit
`3fb33a3a41b89bbd0dda1e3a3ddd53e2e1146b28`.

## Branch and scope

- Branch: `fix/browser-foundations`, created from freshly fetched `origin/main`.
- Working checkout: `/tmp/rowboat-browser-foundations`.
- The original checkout remains on `main`, with its pre-existing todo changes
  and saved plan untouched.
- This step adds test infrastructure and documentation only. Browser production
  behavior is unchanged. The saved implementation plan is copied into this branch.
- Environment: Linux/WSL with an X11 display; Node 24.21.0; Electron 39.2.7;
  Chromium 142.0.7444.235. Windows and macOS have not been validated.

## Dependency preparation

Installed the frozen `apps/x` lockfile with install scripts disabled and installed
the protocol package's dependencies from the `apps/harbor` lockfile. For this run,
the existing matching Electron 39.2.7 binary was copied into the isolated
worktree's installation. No package version or lockfile changes were needed.

Built protocol, shared, core, client, and server packages in dependency order
before the full typechecks. All five prerequisite builds passed.

## Results

Commands below run from the indicated directory.

| Check | Directory | Command | Result |
| --- | --- | --- | --- |
| Existing browser UI tests | `apps/x/apps/renderer` | `npm test -- src/lib/browser-context-menu.test.ts src/components/browser-pane/browser-tab-rail.test.tsx` | 27 passed across 2 files |
| Native browser baseline | `apps/x/apps/main` | `npm run test:browser` | 9 passed; 1 explicitly reported known failure |
| Strict native baseline | `apps/x/apps/main` | `npm run test:browser -- --strict-known-failures` | Expected exit 1 for the known Enter defect; all 9 other checks passed |
| Browser harness types | `apps/x/apps/main` | `npm run typecheck:browser` | Passed |
| Shared types | `apps/x/packages/shared` | `npm run typecheck` | Passed |
| Preload types | `apps/x/apps/preload` | `../../node_modules/.bin/tsc --noEmit -p tsconfig.json` | Passed |
| Main process types | `apps/x/apps/main` | `../../node_modules/.bin/tsc --noEmit -p tsconfig.json` | Passed |
| Renderer types | `apps/x/apps/renderer` | `npm run typecheck` | Passed |

Temporary test directories were removed after both successful and failed runs.

## Known keyboard behavior

The native fixture establishes that Enter reaches the focused form input as a
`keydown` event, but does not trigger form submission. Clicking Submit succeeds.
This is recorded without changing production behavior in Step 0. Revisit it
during the keyboard work and distinguish browser UI shortcuts from agent
`press` semantics when implementing the correction.

The default suite reports this case visibly without failing the baseline.
`npm run test:browser -- --strict-known-failures` makes any recorded known failure
produce a nonzero exit status. All unexpected failures already fail both modes.

## Limits and next step

The native suite uses the actual browser manager and deterministic local pages,
not a full Rowboat launch. Production permission configuration, renderer layout,
external sites, extensions, downloads/uploads, and platform-specific media remain
for their corresponding implementation steps. This baseline is not a claim of
full browser compatibility or a SOTA benchmark.

Next: [Step 1 — shared browser state and command handling](browser-foundations-plan.md#step-1--establish-shared-browser-state-and-command-handling).
Harness instructions: [native browser README](../apps/x/apps/main/tests/browser/README.md).
