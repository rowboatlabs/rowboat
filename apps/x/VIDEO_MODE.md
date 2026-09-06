# Calls (Video Mode) — Deep Dive

Calls let the user talk to the assistant while it *sees* them (webcam) and
their screen (screen share). There is ONE call engine — push-to-talk voice
input (hold Right ⌘ to talk, quick-tap to lock hands-free), forced
read-aloud TTS, frame capture — entered through four presets that differ
only in starting devices. This doc covers the product flow, the technical
pipeline, and the LLM prompt surface with exact pointers.

## Product flow

The composer has a **call split-button** (`chat-input-with-mentions.tsx`).
The main click is the **hover companion** — preset `voice`: the SAME
Skipper surface ⌥⇧Space summons (`startHoverCall()` in `App.tsx`), bound to
this chat. The chevron menu holds the deviations. While a call is live the
button turns red and ends it.

| Preset | Starting devices | First surface |
|--------|------------------|---------------|
| `voice` — main click, ⌥⇧Space, tray "Quick Ask", the card's tuck handle, the Home Skipper, the discoverability toast | camera off, screen off (sticky share replays if opted in) | the Skipper card (hover mode) |
| `share` — "Share screen" | screen on, camera off | the Skipper card — the same hover summon with the screen shared from the start |
| `video` — "Video call" | camera on | floating pill (camera in the pill; expand for full screen) |
| `practice` — "Practice session" | camera on, + coaching persona | full-screen call |

**ONE hover flow.** Every hover entry point ends in `startHoverCall()`:
the chord / tray item / tuck handle / toast go main → `relaySummon()` →
`quick-ask:tuck` → app; the call button and the Home Skipper call it
directly. It acks the relay (`quickAsk:tuckAck`), starts the `voice`
preset, and only THEN kicks off the (sticky or `share`-forced) screen
share, fire-and-forget — the in-flight guard is released the moment the
call engine settles, never held across device acquisition. A session that
fails to start falls back to the text card (`quickAsk:show`), so a summon
is never a silent no-op. Without voice configured the text card is the
answer from the start.

**One surface rule** (`callSurface` in `App.tsx`): full screen and screen
sharing are mutually exclusive in both directions — a full-screen call covers
the screen, so sharing it would show the call itself.

- sharing → floating popout, always (pill = working)
- not sharing → full screen unless `callMinimized` (full screen = facing
  each other)
- expanding the pill auto-STOPS any share; minimizing the full-screen call
  auto-STARTS one (the pill exists to work together) — presenting from full
  screen likewise collapses to the pill
- the camera toggle never changes the surface: turning it on from the pill
  puts your video IN the pill; expanding is its own explicit action

**Screen-share consent** is three-layered: a toast the moment any share
starts ("Your screen is being shared… [Stop sharing]"), a persistent
"Sharing screen" badge on the pill, and macOS's purple recording indicator.
If the auto-share fails (Screen Recording permission not granted) the call
starts anyway as a voice call, with a toast linking to System Settings.
Practice/coaching is always an explicit choice — expanding to full screen
never turns the coach on.

In-call controls (identical bar on both surfaces): push-to-talk button
(hold to talk / tap to lock hands-free — mirrors the Right ⌘ key), mic
mute, camera toggle (silhouette avatar while off, no webcam frames
captured), screen share toggle, mascot ⇄ "R" letter avatar, end call. The
status chip walks the user through PTT: "Hold right ⌘ to talk · tap to go
hands-free" when idle, "Listening — release to send" while capturing,
"Hands-free — tap ⌘ to send" while locked. The popout additionally embeds
the REAL chat composer (`ChatInputWithMentions`) as its typed input —
@-mentions, attachments, and per-turn config all work mid-call, and
messages land in the chat like composer messages, frames riding along.
NO transcript renders in the pill (in either direction) — minimized
surfaces show none; replies are spoken aloud, and expanding is how you
read. **Mute is a full input
pause**, not just audio — mic audio stops reaching Deepgram
(`useVoiceMode.setPaused`, OR'd with the automatic thinking/speaking pause)
AND camera/screen frame capture stops (`useVideoMode.setCapturePaused`;
`collectFrames()` returns nothing while muted, so typed messages carry no
frames either), letting the user talk to someone in the room without the
assistant listening in. Devices stay acquired for instant unmute (camera
light and macOS share indicator stay on — the pill's share badge switches to
"Sharing paused"), the status chip shows "Muted" instead of "Listening",
and assistant output is unaffected (in-flight speech keeps playing; Stop
handles that). Mute resets to off at call start/end. While the assistant is thinking or speaking, a
red **Stop** button appears on the mascot tile — it silences TTS instantly,
skips queued voice segments, and aborts the run if it's still generating
(stopping a run from anywhere, including the composer, also silences TTS). Captions of the in-progress utterance and the
assistant's spoken line run along the bottom. Typing in the composer still
works mid-call; frames ride along with typed messages too.

Outside calls the composer keeps exactly one voice affordance: the **mic
button** (push-to-talk dictation, untouched). Spoken responses exist only
inside calls (forced full read-aloud, off on hang-up). The old video
dropdown, talking-head toggle, read-aloud headphones toggle, and summary/full
TTS dropdown are all retired — a per-message "read aloud" action on assistant
messages is the planned replacement for text-in/voice-out.

The call button is disabled unless both voice input (Deepgram) and voice
output (TTS) are configured. `call_started` (with `preset`) is captured in
PostHog — the adoption metric for this feature.

**Popout mechanics**: the floating pill is the COMPANION WINDOW (the same
always-on-top window ⌥⇧Space summons) in its pill layout — camera tile when
on + mascot tile, live caption, control bar, composer — repositioned
top-right. It floats over every
app — including Rowboat. Control-bar actions round-trip
`video:popoutAction` → main → `video:popout-action` → app window, which
owns the mic/camera/capture; `expand` also refocuses the app window
(handled in main).

## Frame pipeline

`apps/renderer/src/hooks/useVideoMode.ts` runs one capture pipe per source
(stream → offscreen `<video>` → canvas JPEG → ring buffer):

- Cadence: 1 fps (`CAPTURE_INTERVAL_MS`, line 20); ring buffer ~2 min.
- Webcam: 512px wide, JPEG q0.65, max **12 frames/message** (lines 21, 31).
- Screen: 1280px wide (text legibility), JPEG q0.7, max **4 frames/message**
  (lines 24, 32).
- `collectFrames()` drains frames buffered since the last send, evenly
  sampled down to the caps, always keeping the newest; grabs one final frame
  at the moment of send. Falls back to the single latest frame for
  rapid-fire messages.

`App.tsx` `handlePromptSubmit` attaches the drained frames (whenever a call
is live) to the outgoing message as `UserImagePart`s and sets
`composition.videoMode` when the camera or screen is active, plus
`composition.coachMode` during a practice session. Frames also become
`isVideoFrame` display attachments (filmstrip in the transcript —
`chat-message-attachments.tsx`; history hydration in
`lib/run-to-conversation.ts`).

## Message schema & model encoding

- `packages/shared/src/message.ts:51` — `UserImagePart`: inline base64
  (`data`, `mediaType`), `source: 'camera' | 'screen'`, `capturedAt`. Unlike
  file attachments (path references read via the `LLMParse` tool), image
  parts go to the model as real multimodal image parts.
- `packages/core/src/runtime/assembly/message-encoding.ts` `convertFromMessages`:
  emits a context line (frame counts + time span), then labeled groups —
  a `"Webcam frames (oldest to newest):"` text part before camera images and
  a `"Screen-share frames (oldest to newest):"` text part before screen
  images — so the model never confuses the user with their screen.
- Frames stay inline in history (no pruning) deliberately: pruning would
  bust provider prefix caching every turn and cost more than it saves.
- The auto-permission classifier stringifies + truncates content to ~3KB per
  message, so inline base64 can't blow up its prompt.

## Push-to-talk voice loop

The user's key gesture is the endpoint — there is NO silence detection, no
endpointing heuristics, and the assistant's TTS can never be transcribed
back at it (the mic gate is closed unless the user is deliberately talking).

Gestures (Right ⌘, or the on-screen talk button on either surface):

- **Hold** (≥350ms): mic gate open while held; release submits the
  utterance.
- **Quick tap** (<350ms): while the assistant is speaking, a tap is a STOP —
  full interrupt (audio + queued reply + generation), mic left closed; the
  next tap behaves normally. In silence, a tap locks hands-free capture; the
  next press submits.
  While locked there is still no auto-submit — the closing tap is the
  endpoint.
- **Chord** (any other key/click while Right ⌘ is down): the press was a
  keyboard shortcut, not a talk gesture — a live hold is cancelled, a
  locked capture swallows the matching release. Escape also cancels.
- **Pressing while the assistant thinks/speaks silences its AUDIO and
  starts listening** — but the run and its reply survive: an accidental or
  empty press never costs the answer (unspoken segments freeze and resume
  on release). Only a real submitted utterance aborts the previous turn
  and drops its unspoken backlog. The Stop button remains the hard abort.

Key sources feed one edge-triggered machine in `App.tsx` (`handlePttDown` /
`handlePttUp` / `handlePttChord`):

- **Global key hook** (`apps/main/src/ptt.ts`, uiohook-napi): system-wide
  Right ⌘ down/up/chord pushed over `voice:ptt-key`. Runs only while a call
  is active (ref-counted via `voice:setCallActive`). Requires macOS Input
  Monitoring; `eventsSeen` in `ptt:getStatus` is the liveness signal (a
  running hook that has seen zero events = permission not effective) — the
  app shows a one-time permission dialog ~4s into the first call.
- **DOM listeners** (app window focused): `e.code === 'MetaRight'` keydown/
  keyup — the fallback that works without Input Monitoring.
- Sources overlap while the app is focused; identical edges within 80ms
  collapse into one (`PTT_EDGE_ECHO_MS`).

`apps/renderer/src/hooks/useVoiceMode.ts` session API:

- `startPtt(onUtterance)`: mic + Deepgram socket acquired for the whole
  call (instant capture on key-down), audio gated OFF via `setPaused(true)`;
  KeepAlives every 5s hold the idle socket open.
- `pttBegin()`: clears the transcript buffers and opens the gate.
- `pttEnd()`: flushes buffered audio, sends Deepgram `Finalize`, reads the
  finalized transcript + trailing interim, closes the gate, fires
  `onUtterance`.
- `pttCancel()`: closes the gate and discards everything heard.
- Mid-call socket drops reconnect after 1s; the offline audio backlog is
  capped (~30s).

Call lifecycle lives in `App.tsx` `startCall(preset)` / `endCall()`:
entering a call saves/forces TTS settings, cancels any composer dictation,
and starts the PTT session; ending restores everything. Composer dictation
is disabled while a call owns the mic. Mute blocks PTT entirely (pressing
the key while muted does nothing; muting mid-capture discards it).

## The companion window (the hover surface)

One always-on-top window (`apps/main/src/quick-ask.ts`, renderer
`components/quick-ask-bar.tsx`, hash `#quick-ask`) with ONE visible role,
pushed over `quick-ask:mode` (`'pinned' | 'hidden'`): the Skipper — a
self-contained card (top strip: logo · destination · window actions · share
· talk/stop · small ✕ dismiss, over the real composer), or the pill when a
live camera needs its self-view. The mascot lives on only in the camera
pill; the card carries its signals instead — the composer flips to the app
composer's recording bar (waveform + interim transcript) while the mic gate
is open, wired to the call's PTT machine (↑ sends `ptt-up`, ✕ discards
`ptt-cancel`); a running turn shows as the strip logo's glow plus a
spinner-and-shimmer activity row in the response panel; the composer
placeholder names the platform talk key ("hold right ⌘ / right Ctrl to
speak"). There is no separate popout window, and no second "ask bar" role.

- The window is an NSPanel (`type: 'panel'`) with
  `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true,
  skipTransformProcessType: true })`: it floats over every Space INCLUDING
  other apps' fullscreen Spaces, and `skipTransformProcessType` keeps the
  Dock icon (without it, `visibleOnFullScreen` turns the app into a macOS
  "agent" app while the window exists — looks like Rowboat vanished). It is
  also `fullscreenable: false` — a window created while the active Space is
  fullscreen can otherwise open AS a fullscreen window (the pill swallowing
  the whole screen).
- Pinned iff the derived `callSurface === 'popout'` (effect in `App.tsx`).
  Renderer asks `video:setPopout {show}`; main repositions the companion
  window (Skipper card at its anchor corner, or the old popout geometry
  top-right for camera calls; the `video:popoutResize` channel remains for
  renderer-driven pill heights but nothing drives it since the response
  panel was removed) and reveals it — focused when a summon is pending,
  `showInactive()` otherwise so it never steals focus. Blur does NOTHING
  (a companion you work next to must not vanish when you click away), Esc
  tucks the text rather than dismissing, and ⌥⇧Space folds/unfolds the
  text panel.
- **Reveal protocol**: every `quick-ask:mode` push carries a `seq`; the
  renderer acks it over `quickAsk:modeApplied` two frames after committing
  that presentation (i.e. once it is painted). Main orders the window in at
  opacity 0 so the renderer can paint, then sets opacity 1 (+ focus) only
  on the ack — never with a half-built layout on screen. A fold also pushes
  first and shrinks the window on the ack, so the open card is never
  squeezed into mascot-sized bounds for a frame. Timeouts (600 ms; 6 s
  while the page is still loading) keep a wedged renderer from blocking.
  The renderer paints NOTHING until it knows its role (and nothing at all
  while hidden), and `index.html` gives `#quick-ask` / `#screen-pointer` a
  transparent background from the very first paint.
- Call state streams over the `video:popout-state` push channel; main
  caches the last payload (in quick-ask.ts) and replays it on window load
  and on every pin. The renderer drops its mirror whenever it leaves the
  pinned role; the app pushes an explicit idle state when a call ENDS (the
  cache survives fullscreen ⇄ popout flaps of a live call, so a camera
  call comes back as the pill, not a card that morphs).
- No app window (the user closed it) or one still loading: the summon
  recreates it hidden (`initQuickAsk({ ensureAppWindow })` in `main.ts`)
  and re-fires the relay on the app's `quickAsk:appReady` handshake; an
  unanswered relay is re-sent once by a watchdog (1.5 s with an app window
  up, 8 s while it boots) and then logged, never answered with some other
  surface. Closing the app window mid-call unpins the companion
  (`onAppWindowClosed`).
- The pill captures its **own** camera preview (MediaStreams can't cross
  windows) and synthesizes the mascot mouth level (no audio in that
  window). The card's recording-bar waveform is REAL, though: the app
  window relays the voice hook's per-frame amplitudes (~16/s, batched)
  over `video:popoutLevels` → `video:popout-levels`, so the bars track
  actual speech at the app composer's own cadence. Levels are never
  cached in main — a waveform is only meaningful live.
- **Tiles show live pixels; controls show capabilities.** A voice-only
  call (camera off, no share) renders the pill WITHOUT the "You" tile —
  mascot + response + composer + controls — so untucking a voice call
  never reads as a video call the user didn't start. Toggling camera or
  share morphs the tile/badge in, in place.
- `video:popoutAction` relays control-bar actions to the app window,
  matched only by real app-window URLs — `getAllWindows()` also contains
  the companion window and hidden utility windows (PDF export) that must
  not be shown or messaged. Right ⌘ pressed while the pill has focus also
  relays as ptt-down/ptt-up actions (no Input Monitoring needed for that
  case).
- **Tucked (the mini call pill, voice-to-voice)**: the pinned surface can
  collapse to the mini call pill (`quickAsk:setPinnedCollapsed`;
  presentation state is pushed with `quick-ask:mode`): logo (click to
  unfold) · status lane · share · talk/stop · end, with the pill body as
  the drag handle and a « unfold handle on the pill's left edge — the
  visible way back to the text input, mirroring the card's » tuck handle
  (⌥⇧Space and the logo work too). The lane keeps narrating while folded — jittery
  waveform while the user speaks, spinner + shimmer activity while a turn
  thinks, a coherent rolling speak wave while the reply is read aloud, the
  talk-key hint ("Hold right ⌘" / "Hold right Ctrl", platform-aware via
  shared/ptt-key.ts) at rest — and beyond that hint the motion is the
  whole story: the pill shows NO transcript in either direction (the user
  tucked the text away; unfold to read). A live share keeps its consent badge on the lit share button.
  The card's tuck handle (»), Esc, and a click on the stage near the card
  all enter this state; ⌥⇧Space toggles it. Tuck/untuck never ends the
  session — only End & close does.

## Permissions

- Camera: `voice:ensureCameraAccess` settles the macOS TCC prompt before
  `getUserMedia` (same pattern as the mic). `NSCameraUsageDescription` is in
  `forge.config.cjs` `extendInfo`.
- Screen: `getDisplayMedia` is auto-approved with the primary screen by
  `setDisplayMediaRequestHandler` in `main.ts` (no picker);
  `meeting:checkScreenPermission` registers the app in macOS Screen
  Recording settings on first use. With the permission denied (or its
  prompt unanswered) `getDisplayMedia` can hang forever, so
  `useVideoMode.startScreenShare` time-boxes the whole acquisition
  (10 s) and fails cleanly — a hung share used to wedge `screenState` at
  'starting' for the rest of the session.
- Input Monitoring (global PTT key hook): starting the uiohook event tap
  triggers the macOS consent prompt on first use, but a missing grant
  doesn't error — events just never arrive (`eventsSeen` stays false). A
  tap created before the grant stays dead; `ptt:retryHook` recreates it.
- Denials are never silent: `components/permission-dialog.tsx` is the one
  dialog behind mic/camera/input-monitoring failures — explains the missing
  permission and deep-links to the exact System Settings pane
  (`app:openPrivacySettings`). Screen-share failure keeps its toast (a call
  is live; a modal would be in the way).

## LLM prompts catalog

| Prompt | Where |
|--------|-------|
| `# Video Mode (Live Camera)` system section — how to use webcam frames, coaching guidance, screen-share rules ("treat the screen as the primary subject", "last screen frame is current"), etiquette (never comment on appearance) | `packages/core/src/runtime/assembly/capabilities/modes.ts` (the `VIDEO_MODE` fragment of the `video-mode` capability, composed by `runtime/assembly/compose-instructions.ts`) |
| `# Practice Session (Coach Mode)` system section — coaching persona: specific/actionable feedback after each take, one-sentence interjections mid-flow, structured debrief on wrap-up | `capabilities/modes.ts` (the `COACH_MODE` fragment, directly after the video capability) |
| "Driving the app" paragraph in the video-mode section — on calls, prefer app-navigation read-view/open-item (show while telling) over describing or squinting at frames | same `# Video Mode` section; full action docs in the `app-navigation` skill (`runtime/assembly/skills/app-navigation/skill.ts`) |
| Per-message frame context line `[Video mode: N live webcam frames … and M frames of the user's shared screen …]` + group labels | `packages/core/src/runtime/assembly/message-encoding.ts` (`convertFromMessages`) |
| `videoMode` / `coachMode` composition overrides (session-sticky; flips bust prefix cache) | `packages/core/src/runtime/turns/bridges/real-agent-resolver.ts` (`CompositionOverrides`); set from `App.tsx` `sendConfig` |

Voice input/output prompt sections (`# Voice Input`, `# Voice Output`) are
reused untouched — calls set `voiceInput` per utterance and force
`voiceOutput: 'full'`.

## Pointing at the shared screen

During a live screen share the assistant can point at the user's REAL
display: the `screen-pointer` builtin (attached by the `app-navigation`
skill) takes fractional coordinates (x/y in 0–1, estimated from the latest
screen-share frame) plus an optional tiny label, and main draws an animated
laser-dot + ping rings there. "This dip here is the weekend" now comes with
a finger on the chart.

- Tool: `packages/core/src/runtime/tools/domains/screen-pointer.ts` —
  actions `point` (x, y, `label?`, `durationMs?`, default auto-hide 8s) and
  `hide`. Executes directly in main via the DI seam
  (`IScreenPointerService`, registered in `main.ts` like browser control) —
  no renderer round-trip, and it hard-fails with an explanation when no
  share is live.
- Share gate: an App.tsx effect reports `video.screenState === 'live'` over
  `screenPointer:setShareActive`; share end tears the pointer down
  instantly.
- Overlay: `apps/main/src/screen-pointer.ts` creates a transparent,
  click-through (`setIgnoreMouseEvents`), non-focusable, screen-saver-level
  NSPanel covering the primary display (the share always captures the
  primary display), loading the renderer with `#screen-pointer` →
  `components/screen-pointer-overlay.tsx`. State pushes over
  `screen-pointer:state` (replayed on load; `nonce` restarts the ping when
  pointing twice at one spot). The window exists only while something is
  pointed at — hide destroys it.
- Prompt surface: a "You can POINT at their screen" bullet in the
  `# Video Mode` screen-sharing section (`capabilities/modes.ts`) plus a
  "Pointing at the user's shared screen" section with a worked example in
  the `app-navigation` skill.
- **Clicking/typing was explored and removed** (design notes for whoever
  revisits). A `screen-control` tool (click at frame coordinates + type
  into the focused field) shipped briefly and worked mechanically, but was
  pulled: aiming from 1280px-wide frames misses small targets, and the
  model acts BLIND between actions (frames only arrive with user
  messages), so it typed into wrong focus and reported success. The
  missing piece is a post-action verification frame in the tool result.
  Hard-won lessons if rebuilt: System Events `click at` returns success
  WITHOUT clicking on modern macOS — post real CGEvents via
  `osascript -l JavaScript` + the ObjC bridge instead (no native module,
  Accessibility-only, no Automation consent); CGEventPost from an
  untrusted process drops events silently, so an upfront
  `isTrustedAccessibilityClient` self-check is the only reliable gate; and
  TCC keys grants to the code signature, so ad-hoc builds lose the grant
  on every rebuild (Developer ID signing fixes it). Web tasks never needed
  it — the embedded browser (`browser-control`) acts element-precisely
  with page state returned per action. Full implementation: this branch's
  history (feat/screen-pointer-control, pre-removal).

## Driving the app on a call

The assistant can drive the Rowboat UI itself via the extended
`app-navigation` builtin ("app driver"): `open-view` (any main view),
`read-view` (returns the emails / background agents / chat-history data the
view renders — and the renderer simultaneously navigates there so the user
watches it happen), and `open-item` (a specific email thread, note,
background agent, or past chat, deep-linked on screen). Data comes from the
same core functions the UI's IPC handlers use (`listImportantThreads` /
`searchThreads`, background-task `listTasks`, the sessions container) — no
OCR of screen frames. The renderer applies results via
`applyAppNavigation` in App.tsx, fed from BOTH event paths: the legacy
`runs:events` ref-poll AND a watcher over the session-chat conversation (the
turn runtime does not emit legacy run events — miss this and navigation
silently no-ops while the tool reports success). Session switches seed the
watcher so replaying history never navigates. During a call, visible
navigations also collapse the full-screen call to the pill and focus the app
window (`app:focusMainWindow`) so the user actually sees the screen change.
Card labels live in `lib/chat-conversation.ts`. The call prompt and the
`app-navigation` skill teach the show-while-telling pattern: read-view →
speak the highlights → open-item when the user picks one.

## Latency

Voice-to-voice latency (user stops talking → assistant audio) is engineered
at four points; the `call_turn_latency` PostHog event measures the real
distribution (utterance → submit → first speak → audio playing):

- **Push-to-talk endpoint** (`useVoiceMode.ts` `pttEnd`): the key release
  IS the endpoint — no silence detection at all. Submit latency after
  release is just the Deepgram `Finalize` round-trip (typically well under
  the old 600–1800ms endpointing wait), and misfires (utterances cut off
  mid-thought, TTS bleed) are structurally impossible.
- **Streaming TTS** (`voice:synthesizeStreamStart` → `voice:tts-chunk` →
  MediaSource playback in `useVoiceTTS.ts`): the first segment of an idle
  queue plays from the first MP3 chunk instead of after the full body
  (ElevenLabs `/stream`, flash model). Follow-up segments keep the gapless
  full-body prefetch path. Falls back to non-streaming on any failure.
- **Early clause speech** (`turn-view.ts` `applyOverlay`): a still-open
  `<voice>` block ≥60 chars emits its last complete clause immediately, so
  speech starts while the rest of the sentence generates.
- **Acknowledgment cue** (`lib/call-sounds.ts`): a soft blip the instant an
  utterance is accepted — perceived latency matters as much as measured.

## Typing on the Skipper

The Skipper's card hosts the REAL chat composer
(`ChatInputWithMentions`): @-mentions over knowledge notes, attachments,
model/effort picker, search/code/permission toggles. A submit relays
through main with the FULL payload (`quickAsk:submit` →
`quick-ask:submit` → `handleHoverSubmit`) into the COMPANION's session —
never the app window's chat — and the reply comes back through the same
call mirror a spoken one does (`video:popoutState` → `video:popout-state`),
so there is no second answer channel. Speech follows the QUESTION's
modality: typed questions render silently, spoken ones are read aloud,
plus the explicit speaker mute on the card.

The strip above the composer carries the destination chip (which chat
this session continues, with a recents switcher and Command Center
first), new-chat, the history peek, the speaker mute, and Open-in-Rowboat.
Device controls (mic, share, end) live on the mascot's pins, in both the
open and tucked states.

**Retired** (2026-08): the `summoned` role — a standalone Spotlight-style
ask bar with its own answer panel (`quickAsk:state`), local dictation
(`quick-ask:summoned` hold-to-talk), Stop relay (`quickAsk:stop`),
dismiss (`quickAsk:hide` / blur), and voice-out + share-without-a-call
toggles (`quickAsk:setOptions` / `quickAsk:optionsState`). Those channels
and their App-side plumbing (`speakTurnRef`, `quickAskActiveRef`,
`quickAskOptionsRef`) are gone. ⌥⇧Space has exactly ONE outcome now, so
there is no second layout to flash, race, or get stuck in. A summon that
can't become a session (voice unconfigured, or the engine failed to
start) is explained in the APP window — brought to the front with a toast
that opens Settings — never by showing a different floating surface.

## Cost notes

Webcam frames ≈ 250–350 tokens each (≤12/message ≈ 3–4k); screen frames ≈
1.5–2k tokens each (≤4/message ≈ 6–8k). History keeps frames inline, so long
sessions grow but stay prefix-cached. First lever if cost bites: drop to one
screen frame per message unless the screen changed.

## Known limitations

- No open-mic barge-in — but pressing PTT while the assistant speaks
  silences it and starts listening (the run is aborted once the new
  utterance submits), so interrupting never requires the Stop button.
- Global PTT (Right ⌘ from other apps) needs macOS Input Monitoring; without
  it PTT only works while the app window is focused (DOM fallback).
- Frame sampling, not video: motion between frames is invisible (the prompt
  tells the model not to claim otherwise).
- Vocal-delivery feedback is limited: Deepgram reduces speech to text, so
  "energy" coaching leans on visual cues.
- Screen share always captures the primary display (no window/display
  picker yet).
- The full-screen call covers the chat; there's no in-call transcript drawer.
- The "attach camera frames to typed chat without a call" combination (the
  old video+chat mode) was cut in the call-model simplification; if analytics
  show demand, it should return as an attachment chip, not a mode.
