# Rowboat companion browser: step-by-step implementation plan

## 1. Scope and shared foundations

Build a dependable browser inside Rowboat. Implement each numbered step as a separate, reviewable change, with its acceptance checks passing before proceeding.

The roadmap covers the core browser audit. AI interaction, task ownership, and agent workflow improvements remain a separate project.

### Step 0 — Prepare the branch and baseline

Status: implemented on 2026-09-21. See the [baseline results and limitations](browser-foundations-baseline.md).

- Fetch `origin/main`, then create `fix/browser-foundations` from that revision in an isolated worktree. Preserve the current working tree’s uncommitted todo changes.
- Record baseline browser tests and typechecks.
- Add a native Electron test harness using an isolated temporary browser profile and local fixture pages. It must not access the user’s real browser sessions.

### Step 1 — Establish shared browser state and command handling

Status: implemented on 2026-09-21. See the [implementation and validation results](browser-foundations-step-1.md).

- Use shared browser types throughout the renderer; remove locally duplicated browser-state interfaces.
- Route tab operations through explicit tab IDs. Resolve the target when a command is issued, so changing tabs cannot redirect an in-flight command.
- Extend typed `browser:*` IPC as each feature lands. Keep native browser operations and persistent storage in the main process.
- Add browser-specific settings and a versioned, atomically written metadata store under Electron’s `userData` directory.
- Preserve the existing persistent partition as the default profile, retaining current logins.

**Acceptance:** stale tab IDs return a handled error; commands never affect a different tab; existing browsing and agent tool calls remain compatible.

## 2. Correctness, privacy, and recovery

### Step 2 — Fix address parsing and navigation policy

- Recognize localhost, IPv4, IPv6, and domain names with ports before interpreting URL schemes.
- Use one navigation policy for address entry, IPC, links, redirects, and popups.
- Permit HTTP/HTTPS browsing and internal blank pages. Block direct navigation to privileged/local-file schemes.
- Route explicit external-protocol requests through an origin-labelled confirmation. Never forward unknown schemes automatically.
- Validate before creating a tab, preventing rejected addresses from leaving orphan tabs.

**Acceptance:** localhost and IPv6 fixtures load correctly; search queries remain searches; alternate spellings such as `file:/...` cannot bypass restrictions.

### Step 3 — Correct new-tab, background-link, and popup behavior

- Preserve foreground/background dispositions for middle-click and Ctrl/Cmd-click.
- Keep named/scripted popup opener relationships intact.
- Preserve referrer and POST data where required by popup/form navigation.
- Allow the last tab to close into an empty browser surface with a New tab action.
- Keep `about:blank` intact when requested by a website; user-created tabs use the configured new-tab behavior.

**Acceptance:** background links retain the current tab; popup `postMessage` and POST-form fixtures work; the last tab closes without closing Rowboat.

### Step 4 — Protect unsaved work

- Make tab closure asynchronous and honor `beforeunload`.
- Remove a tab from state only after its contents actually close.
- Apply the same behavior to close-other-tabs, window closure, and app quit.
- A cancellation stops a bulk-close operation; already closed tabs remain recoverable.
- Distinguish hiding the browser pane from closing its tabs.

**Acceptance:** choosing Stay preserves the page and tab; choosing Leave closes it; hiding the browser never triggers unload.

### Step 5 — Show loading, failure, and crash states

- Expose the attempted URL, navigation error, and tab lifecycle status to the renderer.
- Replace Reload with Stop while loading; support Escape to stop navigation.
- Add error and crashed-tab surfaces with Retry and Open externally.
- Add an unresponsive-tab prompt offering Wait or Reload.
- Keep certificate failures blocked and explain them without an automatic bypass.

**Acceptance:** offline, invalid-host, cancelled-load, crashed-renderer, and unresponsive-page scenarios produce actionable UI.

### Step 6 — Add site permissions and information

- Replace the browser’s blanket permission grants with per-origin decisions. Keep Rowboat’s own app-session permissions separate.
- Support camera, microphone, location, clipboard read, and notifications with Allow once, Always allow, and Block choices.
- Implement consistent permission-check and permission-request handling; identify both requesting and embedding origins for cross-origin requests.
- Add an address-bar site-information panel for origin, connection status, permissions, and reset actions.
- Deny unsupported capabilities explicitly. Handle fullscreen through Step 21.

**Acceptance:** one site’s permission does not authorize another; revocation takes effect; dismissed or obsolete prompts resolve safely.

### Step 7 — Fix screen-sharing attribution and lifecycle

- Bind requests to the requesting tab/frame and origin.
- Show the requesting website in the picker.
- Cancel pending requests when their source navigates away, closes, or is destroyed.
- Track active sharing and provide a visible route back to the sharing tab. In the initial version, stopping an active share uses the website’s own controls.
- Preserve the existing screen/window and supported system-audio choices.

**Acceptance:** switching tabs cannot misattribute a request; closing a requesting tab removes its prompt; no stale selection starts sharing.

### Step 8 — Restore sessions and reopen closed tabs

- Persist tab order, titles, URLs, active tab, and URL/title navigation entries.
- Restore the active tab immediately and load other restored tabs when selected.
- Add Reopen closed tab, restoring position and back/forward history.
- Restore after ordinary restart; offer recovery after an unclean exit.
- Do not persist form contents, passwords, or Chromium’s opaque page-state payload.

**Acceptance:** restart preserves tab organization and navigation history; corrupt metadata falls back gracefully; closed tabs reopen correctly.

## 3. Everyday browser features

### Step 9 — Implement browser keyboard commands

- When focus is inside the browser pane or its website, route:
  - Ctrl/Cmd+L: address bar.
  - Ctrl/Cmd+T, W, Shift+T: new, close, reopen tab.
  - Ctrl+Tab / Ctrl+Shift+Tab: next/previous browser tab.
  - Ctrl/Cmd+R: reload; Shift modifier: bypass cache.
  - Platform-standard back/forward shortcuts.
- Keep Rowboat’s existing shortcuts outside browser focus; retain Alt+Tab as its existing section-switching alternative where applicable.
- Route menu commands through the same command handlers.

**Acceptance:** shortcuts work from website inputs and browser chrome, without duplicate execution or interference with ordinary text editing.

### Step 10 — Add find in page

- Add a find bar above the native viewport using Electron’s native text search.
- Support match counts, next/previous, case sensitivity, Enter/Shift+Enter, and Escape.
- Preserve each tab’s query during tab switching; ignore results from superseded requests.
- Resize the viewport rather than covering or hiding the website.

**Acceptance:** matches update correctly on dynamic pages; zero results are clear; switching tabs never shows another tab’s result count.

### Step 11 — Add website zoom

- Add browser-specific zoom controls, percentage display, reset, and keyboard shortcuts.
- Persist zoom by origin within a profile.
- Use 100% by default and a 50–200% control range.
- Route existing menu zoom actions to the website when browser-focused and to Rowboat otherwise.

**Acceptance:** website zoom leaves app chrome unchanged and survives reload and restart.

### Step 12 — Add Open in default browser

- Add toolbar-menu and context-menu actions for the current page and links.
- Open HTTP/HTTPS destinations through the OS browser.
- Make the action available on failed-load and unsupported-login surfaces.
- Do not imply that cookies or the active login session transfer.

**Acceptance:** the exact destination opens externally and Rowboat’s tab remains intact.

### Step 13 — Add download management

- Track native downloads from tabs and popups in the main process.
- Show filename, source site, progress, state, cancel, and supported pause/resume actions.
- Provide Open and Show in folder for completed files; never open downloads automatically.
- Add download-folder selection and Ask where to save.
- Preserve recent download metadata; mark transfers interrupted by app termination accordingly.
- Warn before quitting with active downloads. Retry starts a new transfer only where a usable source URL exists.

**Acceptance:** ordinary and authenticated downloads, blob downloads, cancellation, missing files, and interrupted transfers have correct UI.

### Step 14 — Add clear browsing data

- Provide separate controls for history, cookies/site storage, cache, download records, and saved permissions.
- Support resetting a selected site and clearing the current profile.
- Apply time ranges only to categories where the underlying storage supports them; label broader deletion clearly.
- Clearing download records must not delete downloaded files.
- Coordinate deletion with open tabs so stale metadata is not immediately restored.

**Acceptance:** targeted clearing does not erase unrelated app data or another profile’s sessions.

### Step 15 — Add browsing history

- Record successful main-frame visits, including meaningful same-document navigation.
- Add a searchable history panel with reopen, delete entry, and clear-history actions.
- Avoid duplicate entries for redirects and repetitive updates.
- Keep history local; do not automatically add it to AI memory.

**Acceptance:** back/forward, redirects, reloads, search, deletion, and retention behave predictably.

### Step 16 — Add browser bookmarks

- Add a bookmark toggle for the current page and a searchable bookmarks panel.
- Support editing titles/URLs, folders, moving, and deletion.
- Keep browser bookmarks distinct from saved Spaces messages.
- Store bookmarks locally per profile.

**Acceptance:** saving the same URL does not create accidental duplicates; changes survive restart.

### Step 17 — Improve address-bar suggestions and browser settings

- Suggest matching history and bookmarks locally, with keyboard selection.
- Keep navigation and search suggestions visually distinguishable.
- Add Google, Bing, and DuckDuckGo choices; retain Google as the default.
- Add startup/new-tab settings, defaulting new tabs to a local empty surface with an address/search prompt.
- Do not send typed prefixes to a remote suggestion service.

**Acceptance:** selecting a suggestion opens its URL; submitting ordinary text uses the selected search engine.

### Step 18 — Improve tab management

- Add drag reorder, accessible Move left/right actions, pin/unpin, tab search, and audio indicators/mute.
- Keep pinned tabs grouped first; close-other-tabs preserves pinned tabs.
- Require unpinning before closing a pinned tab.
- Persist order, pinning, and mute settings.

**Acceptance:** reordering preserves page state; tab search selects the correct tab; muting one tab does not affect others.

### Step 19 — Add printing and saving

- Add Print, Save as PDF, and Save webpage commands.
- Use native print/save dialogs; support HTML-only and complete-page save.
- Bind operations to the selected tab at invocation.
- Show cancellation and errors without treating either as a successful save.

**Acceptance:** printing targets the website rather than Rowboat’s UI; generated PDFs and saved pages open successfully.

## 4. Compatibility and focused follow-up

### Step 20 — Verify file uploads and PDF viewing

- Exercise native file selection, multiple files, accepted file types, cancellation, and drag-and-drop uploads.
- Fix demonstrated integration failures without exposing unrestricted filesystem access to webpages.
- Verify inline PDF navigation, download, find, zoom, and print behavior.
- Keep automated agent uploads outside this roadmap.

**Acceptance:** local fixtures receive the selected files correctly; cancelling sends nothing; PDFs remain usable inside the browser.

### Step 21 — Complete media and fullscreen behavior

- Handle website fullscreen entry/exit with the correct viewport bounds and Escape behavior.
- Restore focus and layout after exit or tab closure.
- Test microphone/camera calls and screen-sharing flows across supported OS builds.
- Document that website notifications currently depend on a loaded site; do not promise full background web push.

**Acceptance:** video fullscreen and a local media-call fixture work without stranded views or incorrect focus.

### Step 22 — Harden supported authentication and extensions

- Verify HTTP authentication, named OAuth popups, popup closure, opener messaging, and extension behavior after host-window recreation.
- Add an installed-extension list with enable/disable/remove controls for the existing unpacked-extension mechanism.
- Make extension initialization session-aware and clean up registrations correctly.
- Retain explicitly limited extension compatibility; do not build a web-store installer or claim ad-blocker parity.
- Keep passkeys disabled until a separately validated integration exists. Use Open externally for unsupported login flows.

**Acceptance:** supported authentication and extension fixtures pass; unsupported capabilities are described accurately.

### Step 23 — Add named profiles

- Add profile creation, renaming, switching, and deletion.
- Isolate cookies, permissions, history, bookmarks, downloads metadata, tabs, and zoom by profile.
- Treat the existing partition as the default profile without migrating or clearing its cookies.
- Show the active profile in browser chrome. Switch after closing the previous profile’s tabs through normal unload handling.
- Leave downloaded files intact when deleting a profile.

**Acceptance:** signing in to a site in one profile does not sign in another; existing default-profile logins survive the upgrade.

### Step 24 — Add private browsing

- Use an in-memory session partition with a visible Private indicator.
- Disable extensions in private sessions initially.
- Persist no private history, tabs, closed-tab recovery, site permissions, or download metadata.
- Destroy the private partition’s contents when its final tab closes.
- Explain that files explicitly downloaded remain on disk.

**Acceptance:** a new private session starts without the previous private session’s cookies or browsing records.

### Step 25 — Measure resource use and validate the complete experience

- Measure memory and responsiveness with 1, 10, and 25 representative tabs.
- Verify resources are released after closing tabs, popups, profiles, and private sessions.
- Keep existing live tabs loaded; automatic suspension remains deferred because it can interrupt calls and unsaved work.
- Exercise native-view overlays, resizing, app zoom, browser zoom, keyboard focus, and accessibility across the finished feature set.
- Fix measured leaks or regressions before release.

**Acceptance:** no growing listener/view count after repeated open/close cycles; background tabs do not cause unexplained focus changes.

## 5. Validation, defaults, and release criteria

- **Tests:** pure unit tests for URL policy, persistence, permissions, and command routing; renderer tests for controls; native Electron tests for lifecycle, focus, downloads, navigation, and recovery.
- **Checks:** run relevant tests and typechecks for shared, preload, main, and renderer code. The existing root checks do not fully cover the main process.
- **Platforms:** native acceptance runs on macOS, Windows, and Linux before declaring platform-wide support. Record unavailable platform checks explicitly.
- **Storage defaults:** 20 recently closed tabs, 100 download records, and history limited to 90 days or 10,000 visits, whichever removes older records first.
- **Privacy defaults:** local-only browser metadata; no stored form contents, automatic history ingestion into AI memory, remote address suggestions, or automatic opening of downloaded files.
- **Compatibility:** preserve current cookies and existing browser tool contracts. Add shared state fields and IPC incrementally; update all internal callers when closure becomes asynchronous.
- **Release sequence:** Steps 0–8 establish protection and correctness; Steps 9–19 complete daily browsing; Steps 20–25 establish compatibility and the agreed follow-up features.
- **Deferred projects:** AI browser upgrades, password vaults, passkey integration, full extension-store compatibility, background push infrastructure, and automatic tab suspension.
