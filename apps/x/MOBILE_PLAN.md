# Rowboat Mobile v1 — Execution Plan

**Goal:** an iOS app that feels like the best chat apps (Claude, ChatGPT):
end-to-end chat working, clean minimal UI, and read-only Brain (knowledge)
browsing. Full peer — new chats, model picking — against the same
rowboat-server the desktop uses, paired over QR on the local network.
Same-machine server only for now (remote/AWS is future scope).

**How this runs:** same rhythm as SEPARATION_PLAN.md — every phase is one PR
against `main`, verified in the simulator before it ships, merged by Gagan.
The app lives in `apps/x/apps/mobile` (Expo SDK 57, expo-router); it reuses
`@x/shared` turn logic verbatim and speaks the server's HTTP `/rpc` + WS
`/events` protocol — no server changes expected in this plan (the protocol
is the one the desktop client exercises daily).

**Design direction:** minimal and clean. System font, white/near-black
grounds, one accent, generous spacing, native feel (safe areas, gestures,
haptics). Skills installed for reference: `expo-native-ui`,
`sleek-design-mobile-apps`, `vercel-react-native-skills`.

---

## M1 — Revive + app shell

The parked app predates the separation's later phases. Bring it up against
today's server and give it the chat-first shape:

- Verify pairing (QR + manual + `pair-dev` deep link), RPC, WS resync
  against the current server; fix drift.
- Restructure navigation: app opens into a chat; left drawer with chat
  history + search + New chat; Brain and Settings entries at the drawer
  foot. Minimal theme pass (light + dark).
- **Verify:** simulator pairs with the Mac's server, opens an existing
  session, streams a live reply.

## M2 — Chat, end to end

- New chat from the drawer; title appears when the server names it.
- Model picker in the chat header (models:list / models:getConfig — same
  catalog as desktop).
- Reconnect catch-up (app background → foreground refetch), send-failure
  states, keyboard/scroll behavior, streaming indicator, stop button.
- **Verify:** full conversation lifecycle on simulator incl. app
  backgrounding mid-turn; desktop shows the same session in sync.

## M3 — Brain (read-only)

- Drawer → Brain: the knowledge folder tree (folders collapsible, notes
  listed), tap → rendered markdown.
- Images/attachments in notes load via the server's authed `/workspace`
  route.
- Live updates: `workspace:didChange` / `knowledge:didCommit` over the WS
  refresh the tree and open note.
- **Verify:** edit a note on desktop → phone view updates; images render.

## M4 — On the iPhone + demo polish

- Dev build on the physical iPhone (`npx expo run:ios --device`, free
  Apple ID) — fixes the Expo Go SDK mismatch that blocked this before.
- QR pairing scanned with the real camera against the Mac (LAN toggle on).
- App icon, splash, final UX pass; demo script for the team.
- **Verify (exit criteria):** on a real iPhone — pair by camera, hold a
  conversation, browse the Brain. Clean enough to demo.

---

## Not in this plan (future scope)

Remote/AWS servers from the phone, push notifications, voice PTT,
knowledge editing, TestFlight distribution, Android.

## Standing gotchas

- Expo Go from the App Store can't run SDK 57 — simulator uses the bundled
  Expo Go; the physical phone needs the M4 dev build.
- One server = one user; the phone acts as the paired Mac's user.
- The Mac must be awake with the app (or standalone server) running.
