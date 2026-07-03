# Video Mode — Deep Dive

Video mode lets the assistant *see* the user (webcam) and their screen (screen
share), in three presentations: frames attached to normal chat, a hands-free
spoken call, and a full-screen Meet-style call. This doc covers the product
flow, the technical pipeline, and the LLM prompt surface with exact pointers.

## Product flow

The composer's video button (`chat-input-with-mentions.tsx`) toggles video
mode; a chevron dropdown picks one of three modes (`VideoChatMode`):

| Mode | What it does |
|------|--------------|
| `chat` — "Video + chat" | Camera on. Webcam (and screen-share) frames ride along with every typed or dictated message. Small PiP preview floats above the composer. |
| `call` — "Video call (hands-free)" | Everything in `chat`, plus: continuous listening (each utterance auto-submits as a voice message) and forced full read-aloud TTS. No typing needed; composer still works. |
| `meeting` — "Video call (full screen)" | Same pipeline as `call`, presented as a full-screen Meet-style layout: user tile + animated mascot tile, captions, control bar. |

On top of any mode:

- **Screen share** (`MonitorUp` buttons on the PiP overlay and the meeting
  control bar): captures the primary screen; frames go to the model as a
  separately labeled group. In the meeting view the screen becomes the big
  tile with user + mascot in a side rail.
- **Camera off** (Meet-style mute): video mode and screen share keep running,
  no webcam frames are captured; tiles show a silhouette avatar.
- **Mascot dismissal** (meeting view): swaps the animated mascot for a
  Meet-style letter avatar ("R").
- **Popout**: while screen sharing, if the app window loses focus (the user
  switched to the app they're sharing), a small always-on-top frameless
  window pops out with the user + mascot mini-tiles; refocusing dismisses it.
  Its expand button focuses the main window (`video:focusMain`).

`call`/`meeting` options are disabled unless both voice input (Deepgram) and
voice output (TTS) are configured. Entering a call saves the user's TTS
settings and forces `full` read-aloud; leaving restores them.

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

`App.tsx` `handlePromptSubmit` (~line 2767) attaches the drained frames to
the outgoing message as `UserImagePart`s and sets
`composition.videoMode: true`. Frames also become `isVideoFrame` display
attachments (filmstrip in the transcript — `chat-message-attachments.tsx`;
history hydration in `lib/run-to-conversation.ts`).

## Message schema & model encoding

- `packages/shared/src/message.ts:51` — `UserImagePart`: inline base64
  (`data`, `mediaType`), `source: 'camera' | 'screen'`, `capturedAt`. Unlike
  file attachments (path references read via the `LLMParse` tool), image
  parts go to the model as real multimodal image parts.
- `packages/core/src/agents/runtime.ts` `convertFromMessages` (~line 1013):
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

Mode transitions live in `App.tsx` `handleVideoModeChange` (~line 1161):
call ↔ meeting switches are presentation-only (mic/TTS untouched);
entering/leaving hands-free saves/restores TTS settings. Push-to-talk is
disabled while a call owns the mic.

## Popout window

- Renderer asks `video:setPopout {show}` (main handler:
  `apps/main/src/ipc.ts:1742`); main creates a frameless, `alwaysOnTop`
  ('floating'), all-workspaces BrowserWindow at the top-right of the primary
  display, loading the renderer bundle with `#video-popout`
  (`apps/renderer/src/main.tsx` branches on the hash →
  `components/video-popout.tsx`).
- Call state streams over the `video:popout-state` push channel; main caches
  the last payload and replays it on popout load. Shown with
  `showInactive()` so it never steals focus (that would re-hide it).
- The popout captures its **own** camera preview (MediaStreams can't cross
  windows) and synthesizes the mascot mouth level (no audio in that window).
- `video:focusMain` matches only real app windows by URL — `getAllWindows()`
  also contains hidden utility windows (PDF export) that must not be shown.

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
| `# Video Mode (Live Camera)` system section — how to use webcam frames, coaching guidance, screen-share rules ("treat the screen as the primary subject", "last screen frame is current"), etiquette (never comment on appearance) | `packages/core/src/agents/runtime.ts:386` (`composeSystemInstructions`, gated on `videoMode`) |
| Per-message frame context line `[Video mode: N live webcam frames … and M frames of the user's shared screen …]` + group labels | `packages/core/src/agents/runtime.ts:~1013` (`convertFromMessages`) |
| `videoMode` composition override (session-sticky; flips bust prefix cache) | `packages/core/src/turns/bridges/real-agent-resolver.ts:57,125`; set from `App.tsx` `sendConfig` |

Voice input/output prompt sections (`# Voice Input`, `# Voice Output`) are
reused untouched — calls set `voiceInput` per utterance and force
`voiceOutput: 'full'`.

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
- The meeting view covers the chat; there's no in-call transcript drawer.
