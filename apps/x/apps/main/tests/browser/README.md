# Native browser baseline

This suite bundles the production `BrowserViewManager` into a small Electron
test entrypoint. It does not launch Rowboat, its services, or its workspace.
It uses the existing Electron and esbuild dependencies; no new test dependency
or application build is required.

## Run

After installing the `apps/x` workspace dependencies, including Electron's binary:

```sh
cd apps/x/apps/main
npm run test:browser
```

Native mouse and keyboard events require a display. The suite briefly opens its
own window. On Linux it uses X11 (`DISPLAY` must be available); headless Linux CI
can run `xvfb-run -a npm run test:browser` when Xvfb is installed. Do not disable
Chromium's sandbox to run these tests.

```sh
# Treat the documented baseline defect as a failing exit status as well:
npm run test:browser -- --strict-known-failures

# After building the protocol and shared packages:
npm run typecheck:browser
```

## Isolation and lifecycle

- Each invocation creates a fresh `mkdtemp` directory for the bundle, profile,
  downloads, crash dumps, logs, and result marker. `userData` and `sessionData`
  are configured before Electron creates sessions.
- The manager uses its normal persistent partition, but that partition is
  contained in this temporary profile. No real cookies or workspace are read.
- Fixtures are served on a random port bound to `127.0.0.1`. Browser requests
  outside that exact origin are blocked. An intentional blocked request checks
  this boundary and produces an expected `ERR_BLOCKED_BY_CLIENT` warning.
- Test sessions deny access to media, screen capture, clipboard, and other
  permission requests. This is test isolation, not coverage of the production
  permission policy.
- `ELECTRON_RUN_AS_NODE` and `NODE_OPTIONS` are removed from the child environment.
- Unexpected assertion failures, crashes, premature exits, and the 60-second
  timeout produce a nonzero exit status. Signals stop the child; an unresponsive
  child is killed after five seconds. The server and temporary directory are
  cleaned up after the child exits.

## Coverage and known failure

The checks exercise profile isolation and absence of Node/app bridges in webpage
context; page snapshots; indexed native clicks; text input; native key delivery;
button-based form submission; scrolling; back/forward; tab switching and shared
session cookies; hide/show behavior; network isolation; and teardown.

The Step 1 checks also switch tabs during delayed navigation, reads, typing, and
native clicks. They verify captured tab targets, rejection of native input after
a tab switch, and handled errors when a target closes or its ID becomes stale.

**Known failure:** `press('Enter')` delivers `keydown` to the focused input but
does not submit the fixture form. The current keyboard implementation sends
`keyDown`/`keyUp` and emits a character event only for single-character key codes.
The suite reports this one specific timeout as `KNOWN FAILURE`; errors outside
that assertion still fail the run. Clicking the form's Submit button must work.
When keyboard behavior is corrected, remove this exception and make Enter
submission a normal passing check. Strict mode already gates on its resolution.

This baseline does not verify React/native-view integration, extensions, real
OAuth providers, file transfers, media devices, crash recovery, or new browser
features. Add local fixtures and native assertions alongside those later steps.
Fixtures live in `fixtures/` (not the workspace-ignored `test-fixtures/` directory).

See [the recorded baseline](../../../../../../docs/browser-foundations-baseline.md)
and [the implementation plan](../../../../../../docs/browser-foundations-plan.md).
