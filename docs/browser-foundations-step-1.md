# Browser foundations: Step 1

Implemented on 2026-09-21 in `/tmp/rowboat-browser-foundations`, on
`fix/browser-foundations`.

## Changes

- Renderer browser state uses the shared types. Navigation controls send the
  intended tab ID through typed IPC.
- Browser commands capture their target before awaiting work. Actions and their
  follow-up page reads use the same target; new snapshots include `tabId`.
  Older stored snapshots without this field remain valid.
- Closed or stale targets return errors. Native click and key input also fail
  if the target loses active status, avoiding input delivery to another tab.
  DOM reads, typing, and scrolling can target an inactive tab explicitly.
- Version 1 metadata lives at `<userData>/browser/metadata.json`. Main-process
  transactions serialize updates and replace the file through a same-directory
  temporary file, file sync, and rename. Failed replacements preserve the prior
  file. Invalid or unsupported files are preserved and reported as errors.
- The tab rail preference migrates from localStorage once. Subsequent changes
  persist through settings IPC; failed saves show an error and roll back the UI.
- Default profile metadata retains `persist:rowboat-browser`. Existing session
  cookies and logins remain in the same Chromium partition.

## Validation

| Check | Result |
| --- | --- |
| Browser renderer, command routing, and metadata tests | 42 passed across 5 files |
| Shared browser schema compatibility tests | 3 passed |
| Native Electron browser suite | 10 passed; 1 existing known failure |
| Shared, preload, main, renderer, and native harness typechecks | Passed |

Tests cover commands pending across tab switches, explicit inactive targets,
closed targets, legacy IPC/snapshot compatibility, settings migration, rapid
updates, delayed UI responses, malformed metadata, and failed atomic writes.

Native validation ran on Linux/WSL using local fixtures and an isolated profile.
Windows, macOS, and a full Rowboat UI launch were not validated. The existing
Enter form-submission defect remains explicitly reported by the harness; strict
known-failure mode continues to fail on that defect. File replacement is atomic;
this implementation does not claim full durability across sudden power loss.

Next: [Step 2 — address parsing and navigation policy](browser-foundations-plan.md#step-2--fix-address-parsing-and-navigation-policy).
