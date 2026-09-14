# Push notifications from Harbor (plan)

Phones need pushes when a message lands and their app is closed. The sender
must be always-on and see every message — that is Harbor's write path. v1 of
the phone shipped with the Mac relaying pushes (core/spaces/phone-push.ts);
this moves the sender where it belongs. The Mac relay stays as a fallback
until this deploys, then dies.

## What the big apps do (research, 2026-09)

- **Slack** runs every message through a decision tree: channel muted? →
  prefs allow this class (all / DMs+mentions / mentions / nothing)? → DND? →
  active on desktop? → then push. Prefs are per-user with per-channel
  overrides; tokens are per-device.
- **Expo push service** (we use Expo tokens; the APNs key lives with EAS):
  POST up to 100 messages to `exp.host/--/api/v2/push/send`, no auth
  required, 600/s limit. Tickets come back immediately; **receipts** should
  be checked ~15 min later, and any `DeviceNotRegistered` token must be
  dropped (dead tokens hurt delivery reputation).
- Store **every token a member registers** (phone + iPad = two tokens), fan
  out to all, prune via receipts.

## The v1 cut

Per-member preference, per-device tokens, decision made inline on the write
path, sent async. Deliberately not in v1 (future column): per-space mutes,
DND windows, active-elsewhere suppression (hub presence makes this possible
later), thread-following, badges, digests.

### Data (migration)

- `push_tokens(token pk, member_id, updated_at)` — a member's devices.
- `push_prefs(member_id pk, level)` — `off | mentions | dms | all`,
  default `dms` (Slack's default: DMs + mentions).

### Protocol (api.ts + CONTRACT note)

- `registerPush`: POST `/v1/push/register` `{token, level}` → `{ok}` —
  upserts the device token AND the member's level (the phone sends both;
  idempotent, called on every app start / pref change).
- `unregisterPush`: POST `/v1/push/unregister` `{token}` → `{ok}` (sign-out).

Org-scoped like every route (auth = the org's member). A member in three
orgs registers three times — each org pushes for its own spaces.

### Decision, per message append (service.postMessage → after commit)

recipients = space members − author. For each:

1. level `off` → skip; no tokens → skip
2. classify the message, code spans excluded (the wire carries
   `@<memberId>` addresses, so the scan is exact):
   - **mention** — `@<their memberId>` or `@here` → needs `mentions`+
   - **dm** — `space.kind === 'direct'` → needs `dms`+
   - **message** — anything else → needs `all`
3. Push: title like the desktop notifier ("Author · Space"; DMs just
   "Author"; mentions "Author mentioned you · Space"), body = excerpt,
   `data: {orgId, spaceId, threadRootId}` for deep links.

Sending is fire-and-forget after the space lock releases — the write path
never waits on Expo. Batches of ≤100; ticket-level `DeviceNotRegistered`
prunes immediately; a receipts check ~15 min later prunes the rest.

### Files

- `packages/protocol/src/api.ts` — the two routes (+ CONTRACT.md note).
- `packages/server/src/push.ts` — classify + send + prune (fetch injectable
  for tests).
- `packages/server/src/{store,memory-store,pg-store,migrations}.ts` — the
  two tables.
- `packages/server/src/service.ts` — register/unregister + the post-append
  hook. `http.ts` — routes.
- `packages/server/test/push.test.ts` — decision matrix, author exclusion,
  DM/mention/all levels, pruning.

### Phone side (separate commit, apps/x)

`registerWithMac` grows a sibling: after Spaces sign-in the app calls
`registerPush` on every org it belongs to, and again when the level
changes. Same Notifications screen, no UI change.

## Amendment 2026-09-10 — mentions are stamped, not parsed

The classifier no longer scans bodies. Mentions on the wire are link tokens
(`[@Name](#member:<id>)`, `[@here](#here)`) and the org stamps
`Message.mentions` / `mentionsHere` at post and edit (CONTRACT.md, the
mentions bullet); `classifyFor` reads the stamp, so a push and a badge can
never disagree about whether someone was addressed. The per-member level and
the Expo delivery path are unchanged; the org-side notification policy that
replaces the level is a later layer of the unread arc.

## Amendment 2026-09-10 — one decision, two deliveries

The decision moved out of this module into `notify.ts` (CONTRACT.md, the
notifications bullet): after a message commits, the org decides once, for
every member of the space, whether and why they should hear about it —
`mention` > `here` > `dm` > `reply` (a thread they follow) > plain — and the
same rows reach desktops as a `notify` frame on the member channel and
phones through this sender. `PushSender.onMessage` became `send(space,
message, rows)`: level gating and Expo delivery only. Two consequences for
the phone: replies in followed threads now push (every level but `off`,
Slack's default-on threads toggle), and a member's own agent addressing them
pushes them (an agent's post is the agent's act — the same symmetry read
state keeps). The per-member level is still phone-only and still the
placeholder for the org-side policy layer.
