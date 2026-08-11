# Zoom speaker evidence on macOS

Rowboat's existing meeting recorder captures two independent audio channels:
the local microphone and system audio. Deepgram diarization can separate
voices on system audio, but it cannot know the display names shown by Zoom.

This integration adds an optional, macOS-only Accessibility helper that emits
bounded Zoom evidence while Rowboat is already recording. It does not replace
capture or transcription.

## User-visible behavior

- The microphone remains **You**.
- A system-audio segment uses a Zoom display name only when active-speaker
  evidence overlaps that audio interval.
- Missing, stale, self, or conflicting evidence preserves Deepgram's generic
  `Speaker N` label.
- If two participants speak at once and neither signal dominates, Rowboat
  keeps the generic diarization label instead of guessing.
- After a validated Zoom meeting surface disappears for three consecutive
  polls, Rowboat follows its existing stop-and-generate-notes flow.
- Without Accessibility permission, recording continues normally with generic
  speaker labels. Rowboat does not raise a surprise operating-system prompt;
  the in-app notice offers an explicit **Open Settings** action instead.

## Privacy and bounds

`zoom-accessibility.swift`:

- scopes inspection to the native `us.zoom.xos` process;
- considers at most 8 windows per Zoom process and visits at most 1,800 nodes total, 18 levels, and 128
  children per node;
- uses one 600 ms inspection budget for the complete observation;
- never reads editable or secure-field values;
- never emits raw AX nodes, window titles, arbitrary labels, screenshots,
  transcript text, process paths, or participant rosters;
- emits only permission state, meeting-surface state, and normalized active
  speaker evidence; and
- exits when Electron closes its stdin lifetime pipe.

The traversal and explicit-label parsing are adapted from Anarlog's MIT-licensed `meeting_ax`
implementation at revision
[`609ee772`](https://github.com/fastrepl/anarlog/tree/609ee772801f29292e4edee453f269089ebf0e8b).
Its copyright, source revision, and license are included next to the packaged helper. The local changes
replace Anarlog's application model with a single-purpose newline-delimited protocol, narrower output,
parent-lifetime supervision, and Rowboat-specific attribution.

The helper is read-only with respect to meeting/user content. It does set Zoom's non-content
`AXManualAccessibility` and `AXEnhancedUserInterface` compatibility flags because Zoom otherwise omits parts
of its semantic Accessibility tree in some layouts.

## Build and verification

The normal main-process bundle builds the helper with `swiftc`, runs its parser
self-test, and stages the helper plus license beside `main.cjs`. Compilation is
best-effort so a missing toolchain does not break meeting capture.

Automated checks:

```sh
cd apps/x/packages/shared && npm run build
cd ../../apps/renderer && npm test -- --run src/lib/zoom-speaker-evidence.test.ts
cd ../main && npm run build
```

Before treating the feature as physically qualified, test a signed packaged
build with Accessibility granted against a real native Zoom meeting:

1. local-only speech;
2. remote-only speech;
3. simultaneous speech;
4. mute and unmute;
5. minimized meeting window;
6. screen sharing;
7. two participants with the same display name;
8. permission revoke and re-grant; and
9. meeting end while Zoom remains open.

Do not treat unit tests or the helper's parser self-test as physical Zoom or
macOS TCC coverage.

## Extension path for other platforms

This pull request intentionally supports only native Zoom on macOS. The typed evidence event is the reusable
boundary; a future adapter must meet the same privacy, timing, self-marker, ambiguity, and fail-open rules
before its names are trusted.

- **Google Meet in Chrome:** measure the bounded macOS Accessibility tree first. If it cannot expose reliable
  tab-scoped active-speaker transitions, use a minimal Chrome extension plus a separately packaged
  [Native Messaging host](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).
  The extension should emit meeting metadata/evidence only; audio capture remains outside the extension.
- **Microsoft Teams on macOS:** implement and physically qualify a separate bundle-scoped Accessibility
  parser. Zoom labels or heuristics must not be reused without fixtures from Teams.
- **Windows:** implement the same event schema over
  [UI Automation](https://learn.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32) and qualify it
  on Windows. A cross-compile or shared resolver test is not a Windows support claim.

Unsupported adapters keep Rowboat's current generic diarization labels; they never block recording.
