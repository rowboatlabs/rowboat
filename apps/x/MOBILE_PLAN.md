# Rowboat Mobile v1 — Execution Plan

**Goal (pivoted 2026-09-03):** the next mobile release is **Spaces only**.
The user signs in with their Rowboat account, the app lists the orgs/spaces
they belong to, and they get the space's chat (stream + discussions:
read/post/react) and a read-only files view. No QR pairing — Spaces are
hosted by Rowboat (Harbor), so the phone talks to Harbor directly.

The earlier chat + Brain build (M1–M3 below, done) stays in the codebase
behind the `legacyChatBrain` feature flag — hidden in the release, one
switch to bring back.

**How this runs:** every phase is one PR against `main`, verified in the
simulator before it ships, merged by Gagan. App lives in
`apps/x/apps/mobile` (Expo SDK 57, expo-router).

**Design direction:** minimal and clean, native iOS feel, copy the best
apps (Slack/Discord for the space chat, Files app for files) — don't
reinvent.

---

## Architecture (settled in discussion)

- **Phone = direct Harbor client.** Reuse/port `packages/core/src/spaces/`
  (`client.ts` SpacesClient REST, `live.ts` SpacesLive WS) — both are
  near-portable fetch/WS code.
- **Login = Supabase Auth** (the same project behind Rowboat accounts).
  Harbor is only a resource server; the OAuth dance is DCR + PKCE against
  the org's pinned issuer. Mobile uses a deep-link redirect
  (`rowboat://oauth-callback`) instead of the desktop's loopback —
  needs a quick test that Supabase's DCR accepts custom schemes; fallback
  is a bounce page on the apex.
- **Org discovery:** apex `GET /v1/orgs` (already on main) — sign in once,
  get every org you're a member of with address + role.
- **Tokens** live in the iOS keychain (SecureStore), like pairing did.
- **New spaces model from main (2026-09):** every space has one `general`
  stream topic; other topics are `discussion`s that can anchor to any
  message; flat topic list; topic merges (refetch on merge events). Polls,
  server-side search, whiteboards exist in the protocol — v1 renders polls
  read-only, skips search/whiteboards.

## S1 — Login + orgs + flag

- `legacyChatBrain` feature flag (added 2026-09-03): gates the chat home,
  drawer history, and Brain. Stays ON in dev until S3 lands, then flips
  OFF for release.
- OAuth deep-link sign-in (expo-auth-session, PKCE, keychain tokens);
  verify the `rowboat://` redirect against Supabase DCR, fall back to an
  apex bounce page if refused.
- After sign-in: apex `/v1/orgs` → org list; pick org → space list.
- **Verify:** simulator signs in with a real Rowboat account and lists the
  user's actual orgs + spaces.

## S2 — Space chat

- Stream (general topic): message list with authors, live over SpacesLive
  WS, send messages.
- Discussions: flat topic list, open one, read/post; anchored-message
  context shown; refetch on merge events.
- Reactions (add/remove), polls rendered read-only.
- **Verify:** two-way chat between phone and desktop in the same space,
  live both directions.

## S3 — Files view (read-only)

- Space assets browser; tap a markdown file → rendered with the existing
  ChatMarkdown (LaTeX and all); images/blobs via authed Harbor routes.
- Live refresh on changesets.
- **Verify:** edit a file on desktop → phone view updates. Then flip
  `legacyChatBrain` OFF — app is Spaces-only.

## S4 — On the iPhone + release polish

- Dev build on the physical iPhone (`npx expo run:ios --device`).
- App icon, splash, final UX pass; demo script.
- **Verify (exit criteria):** on a real iPhone — sign in, read/post in a
  space, browse files. Clean enough to demo.

---

## Done (pre-pivot, behind the flag)

- **M1** — chat-first shell: drawer history + search, pairing, minimal
  theme (2bbcad73).
- **M2** — chat e2e: model pill, polished markdown + LaTeX (0c4b1792).
- **M3** — Brain: knowledge tree, note view, live updates (6e419969).

## Not in this plan (future scope)

QR/remote pairing back-compat, space search UI, whiteboards, file editing,
push notifications, voice, TestFlight, Android.

## Standing gotchas

- Expo Go from the App Store can't run SDK 57 — simulator uses the bundled
  Expo Go; a physical phone needs the S4 dev build.
- reanimated/worklets crash in Expo Go → `npx expo install --fix`; worklets
  babel plugin needs @babel/* grafts in `pnpm-workspace.yaml`
  packageExtensions.
- Core `workspace:readdir` allowedExtensions skips dirs (recursion broken)
  — client filters instead; core fix pending.
