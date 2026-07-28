# Granola Parity — Research & Gap Analysis

Goal: make Rowboat's meeting feature work exactly like Granola (granola.ai). We copy Granola's behavior — no new invention. This doc is the source of truth: how Granola works, what Rowboat has today (with file:line pointers), the gaps, and the parity plan.

Research basis: Granola's official docs (docs.granola.ai), granola.ai blog/security/jobs pages, third-party reviews and reverse-engineering writeups, plus a full audit of this codebase. Claims that are inferred (not directly documented by Granola) are marked **[inference]**.

---

## Part 1 — How Granola works

Granola is an Electron app (confirmed by their own job postings: "Granola is an Electron app with deep OS integrations", React/TypeScript UI + native OS helpers). No bot ever joins the call — it captures audio locally on the device, so nothing is visible to other meeting participants.

### 1.1 Always-running app (launch at login)

- The product model is an **always-running, menu-bar-resident app**. Granola must be running for detection/notifications to work ("You must have Granola open... for transcription to run" — their troubleshooting docs).
- A literal "open at login" toggle is **not publicly documented**. **[inference]** A clone should register as a login item (Electron `app.setLoginItemSettings`), default on, with a setting to turn it off — the entire detection value prop collapses if the app isn't running.
- The app keeps running when the window closes (menu bar presence remains).

### 1.2 Menu bar icon

- Granola "sits in your Mac's menu bar". Documented affordance: **click the menu bar icon to start recording / open the app**.
- Recording status is NOT primarily shown in the menu bar. The documented indicators are:
  - Inside the note: "green dancing bars" at the bottom while capturing.
  - When another app has focus: a **floating always-on-top "live meeting" pill** on the right side of the screen.
- Exact dropdown contents (upcoming meetings list, icon state change while recording) are not documented. The "Coming up" list lives on the home screen, not the tray.

### 1.3 Meeting detection — two signals, never auto-record

Granola detects meetings via **calendar events + microphone-in-use detection**, and it **never records without a user action** ("Granola only starts transcribing when you open a note for that meeting").

**Signal A — Calendar:**
- Google / Microsoft calendar sync. Pre-creates an auto-titled note per event with 2+ attendees; filters declined events, OOO, Focus Time.
- **In-app popup (Granola-drawn, not macOS Notification Center) 1 minute before** any scheduled call with 2+ attendees. One click on it **opens the meeting URL AND starts transcription** at once.
- **Armed auto-start:** if you have the upcoming meeting's note open before it starts, recording starts automatically at the scheduled time.

**Signal B — Mic-in-use (ad-hoc calls, incl. browser meetings):**
- "Granola notices when your microphone is in use and offers to start taking notes."
- It's app-aware: notification title is "**Huddle detected**" (Slack), "**Call detected**" (FaceTime/WhatsApp), "**Meeting detected**" (anything else, including browsers). Buttons: "Take Notes". Ad-hoc popups have a dashed left border; calendar ones a solid colored bar.
- If the ad-hoc call starts within **15 minutes** of a scheduled event, the popup adopts that event's name (merged).
- **[inference]** Mechanism: poll CoreAudio `kAudioDevicePropertyDeviceIsRunningSomewhere` on input devices for "mic in use", plus enumerate running processes against a known meeting-app list to get the app-specific title. There's no public macOS API for "process X is using the mic", so it's a heuristic combo. Browser meetings degrade to the generic "Meeting detected" title; calendar linkage supplies identity.
- Notifications are configurable in Settings (off entirely, or per-application).
- Related preference: "**Reposition Granola for meetings**" — window auto-repositions/resizes alongside the call when a meeting starts (toggleable, default on).

### 1.4 Audio capture

- Capture = **default microphone + system audio output**, at the OS level. Works with any app or browser (Chrome/Safari/Firefox/Edge) with no extension.
- Cannot isolate per-app audio — it's the combined system stream; uses the OS default sound devices.
- The two streams stay separate through transcription → transcript UI shows **grey bubbles (left) = system audio ("Them"), green bubbles (right) = your mic ("Me")**. No true live diarization on desktop — just Me/Them.
- **macOS permissions: exactly two** — Microphone, and Screen & System Audio Recording (macOS bundles system-audio capture under screen recording). No Accessibility permission.
- **[inference]** System audio mechanism: ScreenCaptureKit audio loopback (macOS 13+ baseline, they require 13+ / recommend 14.2+), possibly CoreAudio process taps on 14.4+. No virtual audio driver (setup has no driver install step).
- **Audio is never stored** — streamed to the ASR provider in real time and discarded.

### 1.5 Transcription

- Cloud, real-time streaming ASR. Subprocessors named on their security page: **Deepgram and AssemblyAI** for ASR; **OpenAI and Anthropic** for note enhancement.
- Live transcript accrues during the call, hidden behind a waveform-icon toggle in the note.

### 1.6 Meeting end & post-meeting flow

- **Auto-stop conditions** (documented): (a) call-end heuristic — transcript inactivity + whether the call software is still in use + scheduled end time for calendar-linked meetings; (b) **15 minutes of silence**; (c) computer sleeps; (d) manual stop. Note: "on macOS, meeting auto-end detection requires admin rights" — without it, manual stop only.
- **On stop, enhancement runs automatically** — no click needed. Enhanced notes are ready in seconds (~30s max reported).
- A "**notes ready**" notification fires when enhancement completes — that's the re-entry point back into the app if you switched away. The note itself was already open (recording ran inside it), so the enhanced version replaces the raw view in place. There's no documented "force-focus the window" behavior; the notification does the redirecting.
- Extras: auto-drafted follow-up emails (toggleable), pre-meeting briefs.

### 1.7 Notes UI

**During the meeting:** a plain notepad — the user types rough bullets; transcription runs invisibly. Green dancing bars at the bottom = capturing. Waveform button (next to the per-note "Ask anything" chat bar) opens the live transcript side-by-side. Mid-meeting you can ask the chat to catch you up.

**After the meeting (enhanced notes):**
- Enhancement merges exactly three inputs: **transcript + your raw notes + calendar metadata**, through a template.
- Signature affordance: **your words render black, AI-generated text grey**.
- Per-line provenance: magnifying-glass icon on a line reveals where it came from in the transcript.
- Templates: built-ins (1:1, standup, sales discovery) + custom; re-enhance with a different template (✨), regenerate (🔁), edit raw notes and re-enhance.
- Chat: per-note "Ask anything" bar, global chat (⌘J), cross-meeting chat over folders; edit-by-asking.
- Home screen: "**Coming up**" strip (next ~5 meetings) + reverse-chronological past notes list; folders; recurring meetings grouped by recurring-event ID + title; shareable links.

---

## Part 2 — What Rowboat has today (audit of main)

Two separate feature families exist in `apps/x`; only the second is Granola-adjacent:
- **"Calls" (video mode)** — live voice/video chat *with the Rowboat AI* (`VIDEO_MODE.md`). Not meeting capture.
- **"Meetings"** — real meeting capture → transcript → AI notes. Working pipeline, but **calendar-triggered and manual-click only**.

### What EXISTS (and is solid)

| Area | Status | Where |
|---|---|---|
| Mic + system-audio capture, 2-channel | ✅ | `apps/renderer/src/hooks/useMeetingTranscription.ts:282-299` — mic `getUserMedia` (ch 0) + `getDisplayMedia({audio})` loopback (ch 1), merged to 16 kHz PCM (`:424-485`); loopback auto-approved in `apps/main/src/main.ts:216-226` |
| Realtime ASR | ✅ | Deepgram realtime WS, `nova-3`, multichannel + diarize (`useMeetingTranscription.ts:9-21`); proxy or raw key (`:253-280`) |
| Speaker labels | ✅ | ch 0 → "You", ch 1 → diarized `Speaker N` (`:335-347`) |
| Transcript storage | ✅ | Markdown + frontmatter + fenced transcript block, `knowledge/Meetings/rowboat/<date>/<name>.md` (`:93-136`, `:487-510`) |
| AI meeting notes on stop | ✅ | `packages/core/src/knowledge/summarize_meeting.ts` — LLM summary, attendee-name resolution from calendar; orchestrated in `App.tsx:5601-5661`; notes prepended above transcript |
| Auto-stop heuristics | ✅ (partial) | silence RMS backstop, calendar-end gating, system-track ended/muted — `useMeetingTranscription.ts:378-549` |
| Calendar sync | ✅ | Google OAuth via `googleapis`, `packages/core/src/knowledge/sync_calendar.ts`, per-event JSON in `~/.rowboat/calendar_sync/` |
| Pre-meeting notification | ✅ (system toast) | `packages/core/src/knowledge/notify_calendar_meetings.ts` — polls every 30s, notifies ~1 min before, deep-links `rowboat://action?type=join-and-take-meeting-notes` |
| Meetings screen | ✅ | `apps/renderer/src/components/meetings-view.tsx` — "Coming up" (+Join / Take-notes buttons, inline prep) + past-notes table |
| Transcript rendering | ✅ | `apps/renderer/src/extensions/transcript-block.tsx` (TipTap, colored speakers, collapsible) |
| Meeting prep briefs | ✅ | `meeting_prep_scheduler.ts`, `meeting_prep_brief.ts` (Granola has this too) |
| Permissions flows | ✅ | mic `ipc.ts:2090-2106`; screen recording check/open-settings `ipc.ts:2003-2018`; Info.plist strings `forge.config.cjs:201-204`; entitlements OK |

### What is MISSING (the entire "ambient" layer)

| # | Gap | Detail |
|---|---|---|
| 1 | **Launch at login** | Zero `setLoginItemSettings` / auto-launch code anywhere. |
| 2 | **Menu bar (tray) icon** | Zero `Tray` usage. No background presence: on macOS closing the window leaves only the Dock; no way to start recording without the full window. |
| 3 | **Meeting detection** | No mic-in-use detection, no process detection (Zoom/Teams/Slack/FaceTime), no browser awareness. Only calendar (time-based). Ad-hoc calls are invisible. |
| 4 | **Auto/one-click start UX** | Capture starts only via explicit button click or clicking the calendar toast. No "Meeting detected — Take notes?" popup, no armed auto-start when a note is open at meeting start time. |
| 5 | **Headless capture** | Capture depends on the renderer window holding a live `getDisplayMedia` stream. No native audio helper → can't capture while the app is "in the background" the way Granola does. |
| 6 | **Meeting-end redirect** | On stop, the note refreshes in place, but there's **no "notes ready" notification** and no bring-the-user-back moment if they're in another app. |
| 7 | **Notes UI polish (Granola signatures)** | No black-vs-grey authorship distinction (we replace, they merge raw notes + transcript), no during-meeting notepad-first flow (we show the transcript note), no per-line provenance, no templates/re-enhance, no floating "recording" pill. |

### Honest assessment

Rowboat has built the *second half* of Granola well — what happens once you're recording, and after the meeting ends. It has essentially none of the *first half* — noticing a meeting is happening and quietly being there without the user opening the app. That first half is exactly items 1–5 above, and it's where all the work is.

---

## Part 3 — Parity plan (copy Granola, no new stuff)

Ordered so each phase is shippable and testable on its own.

### Phase 1 — Resident app: login item + tray
- `app.setLoginItemSettings({ openAtLogin: true })`, default on, toggle in Settings. When launched at login: no window, tray only **[inference — Granola undocumented, but implied]**.
- Electron `Tray` with template icon; menu: "Start recording", "Open Rowboat", recording status line, Quit. Keep app alive on window close (already macOS default; add tray so it's reachable).
- Acceptance: reboot → icon in menu bar, no window; click tray → start an ad-hoc meeting note.

### Phase 2 — Meeting detection + "Take notes?" popup
- Native signal (small Swift helper or node addon, polled from main): mic-in-use via CoreAudio `kAudioDevicePropertyDeviceIsRunningSomewhere` + running-process match against a known list (zoom.us, Teams, Slack, FaceTime, browsers…).
- Granola-style app-drawn popup (small always-on-top BrowserWindow, like the existing video popout): "Huddle detected / Call detected / Meeting detected — [Take Notes]". Merge with a calendar event if within 15 min. Never auto-record.
- Upgrade the existing 1-min-before calendar toast to the same popup style; one click = open meeting URL + start capture (deep-link plumbing already exists in `deeplink.ts`).
- Armed auto-start: meeting note open before start time → auto-start at start time.
- Per-app notification settings.
- Acceptance: start a Meet call in Chrome with no calendar event → popup appears; click → recording.

### Phase 3 — Meeting end → notes ready redirect
- Keep existing auto-stop heuristics; add the missing "call software no longer active" signal from the Phase-2 process watcher; keep 15-min silence backstop (ours is stricter — align to Granola's 15 min).
- On summary completion: fire a **"Your meeting notes are ready" notification**; clicking focuses the app on the note (deep link exists). This is the "redirect when we cut the call" the feature needs.
- Acceptance: leave the call → recording stops on its own → notification within ~30s → click lands on finished notes.

### Phase 4 — Notes UI parity
- During meeting: notepad-first note (user types; transcript behind a waveform toggle); green capture indicator in-note; floating "live meeting" pill when app unfocused (reuse the video-popout window machinery).
- After meeting: enhancement merges **raw notes + transcript + calendar event** (today we only use the transcript); render user text black / AI text grey; ✨ re-enhance + 🔁 regenerate; keep transcript below as today.
- Home: Meetings view already ≈ Granola's home (Coming up + past list) — minor polish only.

### Phase 5 (only if needed for true parity) — Headless capture
- Native mic + ScreenCaptureKit system-audio capture in main/helper process so recording doesn't require the renderer window. Biggest lift; Phases 1–4 deliver the Granola experience with the window opening on record start, which is acceptable Granola-like behavior (their note opens on start too).

### Key implementation notes
- Permissions stay exactly two (mic + screen-recording) — we already handle both.
- Deepgram nova-3 multichannel already matches Granola's Me/Them model — no ASR change needed.
- Reuse: popup ← video popout window pattern; deep links ← `deeplink.ts`; detection loop ← same main-process init pattern as `notify_calendar_meetings.ts`.
