# Meeting Prep — "Next up" prep card

## Goal

When a meeting is imminent, surface who will be there by pulling up each
attendee's existing `person.md` from the knowledge base and showing it — no
click, no LLM in the hot path. An ambient card that's just *ready* when you
look.

This is a deliberately light, deterministic surface. It does **not** replace
the two existing meeting-prep paths:
- the chat skill (`assistant/skills/meeting-prep/`) — LLM brief on demand
- the pre-built automation (`pre_built/meeting-prep.md`) — LLM brief files

It complements them with an instant, no-LLM "who's in this meeting" view.

## Decisions (settled)

| Axis | Choice |
|------|--------|
| Surface | **Ambient card**, no notification. Pinned at top of Meetings view. |
| Activation | Next eligible meeting is **≤ 30 min away**. Outside that → no card. |
| Depth | **Just show `person.md`** — render the note, no LLM synthesis. |
| Who | **Everyone incl. teammates.** Skip self / all-day / declined / cancelled. |
| Sparse meetings | **Notes-first**: attendees with notes shown prominently; the rest collapse into "N others — no notes yet" → expand to create. |
| No-note action | **Offer to create** a note for that attendee. |

## Resolution rules

For each attendee (excluding `self`):
1. **Email exact match** (case-insensitive) against `KnowledgeIndex.people[].email` — reliable.
2. Else **name/alias match** on `displayName` → `people[].name` / `people[].aliases`,
   only when it's a **single unambiguous hit**.
3. Matched → read `person.md`, return `{ name, role, org, path, markdown }`.
4. Unmatched → returned as a "no note" attendee (name + email).

Org notes (`Organizations/{Org}.md`) are **deferred** — `person.md` already
carries Org/Role inline, enough for v1.

## Architecture

| Piece | Location | Notes |
|-------|----------|-------|
| Attendee → note resolver | **new IPC** `meeting-prep:resolve` in `apps/main/src/ipc.ts` | Input: attendee list (`{email?, displayName?, self?}[]`). Builds/uses `buildKnowledgeIndex()`, resolves per rules above, reads matched notes, returns structured payload. Deterministic + fast. |
| Shared types | `packages/shared/src/` | `MeetingPrepAttendee`, `MeetingPrepResult` request/response shapes + IPC channel typing. |
| "Next up" card UI | **new component** rendered above `UpcomingEvents` in `meetings-view.tsx` | Picks next event ≤30 min out, calls IPC, renders notes-first + collapsed others. Reuses existing markdown rendering. |
| Create-note action | reuse the note-creation agent (only LLM touch, user-initiated) | v1: open a prefilled Copilot chat to create the note (visible/steerable) rather than firing silently. |

No new background loop — the renderer already polls `calendar_sync/` every
minute, so the card stays current for free.

## Build slices

1. **Resolver IPC + shared types** — `meeting-prep:resolve`, wired through
   preload. Unit-testable in isolation. ← first slice
2. **"Next up" card UI** — component + 30-min gating + notes-first / collapsed
   rendering, reading from the IPC.
3. **Create-note action** — prefilled Copilot chat for an unmatched attendee.

## Out of scope (fast-follow candidates)

- Notification variant (extend `notify_calendar_meetings.ts` tick).
- Org-note surfacing.
- Configurable lead time (hardcode 30 min for v1).
- LLM-synthesized brief button on the card.

## Phase 2 — Proactive, meeting-aware prep (6h ahead)

Shift from a static contact viewer to meeting-aware prep, generated ahead of time.

### Decisions
- **Trigger:** a calendar-driven tick (clone of `notify_calendar_meetings.ts`), NOT the
  cron/bg-task engine — fire time is `start − 6h`, which varies per event, so a
  calendar scan + state file is the right fit (self-healing on reschedule/cancel).
- **Storage:** write a real note → `knowledge/Meetings/prep/<slug>-<date>.md` (openable/editable).
- **Notify:** none — silent background generation; appears in the Meetings view.
- **Adaptive by meeting type:**
  - Recurring (`recurringEventId` + prior notes found) → lead with **"Last time" recap**
    (prior instance's `## Action items` / summary), then roster.
  - One-off / new → lead with **agenda** (event `description`), then roster + company.
- **Roster:** always list every attendee; ones with a note link to it, ones without
  get **Create note**.
- **AI brief:** the only LLM step. Reuses the `summarizeMeeting` path exactly —
  `generateText` against the user's configured model (`getMeetingNotesModel` /
  `getDefaultModelAndProvider`), tagged `useCase: 'meeting_prep'`. Deterministic
  parts (roster, recap, agenda) are assembled in code; the model only writes the
  "what matters" summary.

### Build slices
- **A. Core generator** (`meeting_prep_brief.ts`): assemble context (roster + recap +
  agenda, meeting-type aware) → `generatePrepBrief()` (one model call) → render +
  `writePrepNote()` to `knowledge/Meetings/prep/`. Frontmatter stamps `eventId` /
  `recurringEventId` / `meetingDate` / `generatedAt`.
- **B. Scheduler** (`meeting_prep_scheduler.ts`): tick (~few min), scan `calendar_sync/`,
  for events starting within 6h, not ended, ≥1 non-self attendee, not already prepped
  (state file keyed by eventId) → generate + write. `init()` wired in `main.ts` beside
  `initCalendarNotifications()`.
- **C. Card integration:** the inline prep card prefers the generated prep note when it
  exists (instant), else falls back to the live deterministic resolve.

### Open detail / enabler
- Notes don't store an event id today, so recap linking is a title/date heuristic.
  Stamp `eventId`/`recurringEventId` into captured notes' frontmatter going forward so
  future links are exact.

## Verification

- Resolver: feed known attendee emails → correct note match; unknown → no-note.
- Card: appears only inside the 30-min window; notes-first ordering; collapse
  toggles; create action opens prefilled chat.
- `npm run deps && npm run lint` clean.
