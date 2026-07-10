# Calls (Video Mode) — Deep Dive

Calls let the user talk to the assistant hands-free while it *sees* them
(webcam) and their screen (screen share). There is ONE call engine —
continuous listening, auto-submitted utterances, forced read-aloud TTS, frame
capture — entered through four presets that differ only in starting devices.
This doc covers the product flow, the technical pipeline, and the LLM prompt
surface with exact pointers.

## Product flow

The composer has a **call split-button** (`chat-input-with-mentions.tsx`).
The main click is the "work together" default — preset `share`: screen
sharing ON, camera OFF, floating pill, so the user keeps working while the
assistant watches along (the button tooltip discloses the screen share). The
chevron menu holds the deviations. While a call is live the button turns red
and ends it.

| Preset | Starting devices | First surface |
|--------|------------------|---------------|
| `share` — main click | screen on, camera off | floating pill |
| `voice` — "Voice call" | camera off, screen off | floating mascot pill |
| `video` — "Video call" | camera on | full-screen call |
| `practice` — "Practice session" | camera on, + coaching persona | full-screen call |

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

In-call controls (identical bar on both surfaces): mic mute, camera toggle
(silhouette avatar while off, no webcam frames captured), screen share
toggle, mascot ⇄ "R" letter avatar, end call. **Mute is a full input
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

**Popout mechanics**: a small always-on-top frameless window (camera tile
when on + mascot tile, live caption, control bar) floating over every app —
including Rowboat. Control-bar actions round-trip `video:popoutAction` →
main → `video:popout-action` → app window, which owns the mic/camera/capture;
`expand` also refocuses the app window (handled in main).

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

## Hands-free voice loop

`apps/renderer/src/hooks/useVoiceMode.ts`:

- `startContinuous(onUtterance)` (line 404): push-to-talk params but with
  `endpointing=1800` (line 25) so thinking pauses don't cut the user off,
  plus `utterance_end_ms=2000` (line 38) as a second end-of-speech signal.
  **Gotcha:** Deepgram's `speech_final` usually arrives on a result with an
  EMPTY transcript — empty finals must reach the endpoint check or
  utterances never complete (see the NOTE in `ws.onmessage`).
- `setPaused(true)` (line 414) while the assistant thinks/speaks: drops mic
  audio (so TTS is never transcribed back), discards half-heard buffer,
  sends Deepgram KeepAlives every 5s. `App.tsx` drives this from
  `activeIsProcessing || tts.state !== 'idle'`.
- Mid-call socket drops reconnect after 1s; the offline audio backlog is
  capped (~30s).

Call lifecycle lives in `App.tsx` `startCall(preset)` / `endCall()`:
entering a call saves/forces TTS settings, cancels any push-to-talk
recording, and starts the continuous loop; ending restores everything.
Push-to-talk is disabled while a call owns the mic.

## Popout window

- The popout window keeps the Dock icon alive: it uses
  `setVisibleOnAllWorkspaces(true)` WITHOUT `visibleOnFullScreen` — that flag
  turns the app into a macOS "agent" app and hides its Dock icon while the
  window exists (looks like Rowboat vanished). Trade-off: the popout doesn't
  hover over other apps' fullscreen Spaces.
- Shown iff the derived `callSurface === 'popout'` (effect in `App.tsx`).
  Renderer asks `video:setPopout {show}`; main creates a frameless,
  `alwaysOnTop` ('floating'), all-workspaces BrowserWindow at the top-right
  of the primary display, loading the renderer bundle with `#video-popout`
  (`apps/renderer/src/main.tsx` branches on the hash →
  `components/video-popout.tsx`).
- Call state streams over the `video:popout-state` push channel; main caches
  the last payload and replays it on popout load. Shown with
  `showInactive()` so it never steals focus.
- The popout captures its **own** camera preview (MediaStreams can't cross
  windows) and synthesizes the mascot mouth level (no audio in that window).
- `video:popoutAction` relays control-bar actions to the app window, matched
  only by real app-window URLs — `getAllWindows()` also contains hidden
  utility windows (PDF export) that must not be shown or messaged.

## Permissions

- Camera: `voice:ensureCameraAccess` settles the macOS TCC prompt before
  `getUserMedia` (same pattern as the mic). `NSCameraUsageDescription` is in
  `forge.config.cjs` `extendInfo`.
- Screen: `getDisplayMedia` is auto-approved with the primary screen by
  `setDisplayMediaRequestHandler` in `main.ts` (no picker);
  `meeting:checkScreenPermission` registers the app in macOS Screen
  Recording settings on first use.

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

- **Smart endpointing** (`useVoiceMode.ts`): Deepgram endpoints at 600ms and
  the client decides — a transcript ending in terminal punctuation fires
  immediately (~600ms after last word); a mid-thought trail holds another
  1.2s (resumed speech cancels the hold). Complete sentences turn around
  ~1.2s faster than the old fixed 1800ms endpoint.
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

## Cost notes

Webcam frames ≈ 250–350 tokens each (≤12/message ≈ 3–4k); screen frames ≈
1.5–2k tokens each (≤4/message ≈ 6–8k). History keeps frames inline, so long
sessions grow but stay prefix-cached. First lever if cost bites: drop to one
screen frame per message unless the screen changed.

## Known limitations

- Turn-taking is strict — no barge-in (would need echo cancellation against
  TTS output).
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
