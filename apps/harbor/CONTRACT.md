# The Spaces Protocol Contract (v0)

> The wire-level contract between Harbor (the spaces server) and everything that talks to it — the Rowboat app, any MCP agent, and the stub server. The contract **is** the `@rowboat/spaces-protocol` package in this workspace; this document is its narrative. The product/protocol spec it implements lives in [rowboatlabs/harbor](https://github.com/rowboatlabs/harbor) (`SPACES_SPEC.md`) — spec §references below point there.

**Posture: v0, deliberately unstable.** Breaking changes are expected and fine while we dogfood. The one rule: **every contract change lands as a PR touching this package** (schemas + fixtures together) — never as a verbal agreement or a divergent copy. Client and server both import these schemas, so drift is structurally impossible.

## How this is consumed

- `apps/x` packages depend on it in-repo: `"@rowboat/spaces-protocol": "file:../../harbor/packages/protocol"` (adjust relative path per package). Run its `build` before consuming (`cd apps/harbor && pnpm install && pnpm build`).
- The stub Harbor (`packages/server`, `@rowboat/harbor`) consumes it as `workspace:*`; the real Harbor grows in that same package behind the same contract.
- npm publishing happens at protocol stabilization (spec §9, two speeds), not before.

## The stub Harbor (`packages/server`)

The in-memory reference implementation that unblocks client work. One process =
one org; restart = clean slate. `pnpm dev` boots it on port 4272 seeded with the
team and a Roadboard space (`src/main.ts`).

- **One core, three doors.** `service.ts` is the single implementation; `http.ts`
  (every route in `api.ts`), `ws.ts` (`/v1/live`, subscribe/replay/live frames),
  and `mcp.ts` (`/mcp`, the six tools over streamable HTTP) are thin
  projections. Rowboat's agent gets no privileged path — enforced by there being
  no other door.
- **Merge engine** (`merge.ts`): line-level three-way, passes the six golden
  fixtures (`test/merge.test.ts` is the conformance harness — it loads the
  fixture files directly). This exact engine ships in the real Harbor.
- **Fake auth** (`auth.ts`): bearer `dev-<memberId>`; first sight creates the
  member. The real OAuth journey (discovery/DCR/PKCE/refresh) replaces this file
  and nothing else.
- **Storage**: `store.ts` is the data-access boundary, `memory-store.ts` the
  stub driver. The real Harbor lands a **Postgres-only** driver — no S3 in v1:
  contents are ≤1MB text riding in the change-set log rows; current state,
  history, feed, and the event stream are all projections of that log.
  `withSpaceLock` becomes a transaction; the hub becomes LISTEN/NOTIFY when we
  ever scale past one node (deferred).
- **Blob store primitive** (`blobs.ts` + `blobs-disk.ts` + `blobs-s3.ts`):
  the spec §6 storage shape for binary/large assets, built ahead of the
  feature. Content-addressed (sha256), four-method interface, two drivers —
  disk (self-host, zero dependencies) and S3-compatible via the canonical
  AWS SDK (`endpoint`/`forcePathStyle` reach MinIO/R2/B2). One conformance
  suite runs both: disk always, S3 when `HARBOR_TEST_S3_BUCKET` (+ optional
  `HARBOR_TEST_S3_ENDPOINT`/`_REGION`, standard AWS credentials) is set.
  **Deliberately not wired to any route** — the upload endpoint + binary
  propose variant are the deferred feature (spec §12) and land as a contract
  PR to this package; this is the primitive they land on.
- **Contract self-enforcement**: the HTTP face validates responses against the
  protocol schemas before sending — drift fails in the stub, not in a client.
- **Spec §11 runs as code**: `test/day-in-the-life.test.ts` walks all nine beats
  of the Roadboard day (create/invite → standup pushes with the conflict-retry
  dance → email seam → live checkbox tick → chat grammar → scheduled tidy →
  offset-resume catch-up), asserting the full attribution spectrum ends up in
  one file's history. It doubles as the integration script for the stub→real
  swap.

### v0 semantics settled while building (fixture- or test-backed)

- A clean merge that lands **identical content still writes a change-set** (new
  version, same bytes): the second standup pusher stays visible and attributed
  (principle 4). Fixture 06 pins the merge outcome; the service behavior is
  test-pinned.
- **Same-point insertions conflict** (fixture 04) — so two agents appending to
  the same section end get the conflict-retry dance, by design. Edits at an
  edit's *boundary* merge cleanly (latitude; add a fixture if dogfood disagrees).
- **EOF newline** merges as a three-way property: the side that changed it wins;
  both-changed-and-disagree keeps the newline.
- **Replying to an archived topic unarchives it** (and emits a topic event).
- **Topic events** fire on create/retitle/archive/unarchive/merge — not on
  every reply; clients derive `lastActivityAt`/counts from message events.
- **`merge_into`** repoints the source's messages, archives the source, returns
  the *target*. Durable message events keep their original `topicId` — clients
  refetch a thread when a topic event announces a merge.
- **Unknown invite tokens are 404**; `expired`/`revoked` are resolvable states.
- **MCP face attribution**: acting mode defaults to `agent`; automations
  declare `x-acting-mode: scheduled`; `x-agent-name` carries the display label.
  Stateless transport (per-request server bound to the caller's token).

## The six wire decisions

**1. Change-sets are full content against a declared base** (`changeset.ts`). `ProposeChange = {assetPath, baseVersion, newContent, reason?, actingMode}`. The org runs a line-level three-way merge. No operation encoding, no diffs on the wire — v1 assets are small text files; simplicity beats cleverness. Three outcomes, all HTTP 200: `applied` (base was current), `merged` (stale but clean — **the returned `mergedContent` is what now exists; the proposer must adopt it**), `conflict` (nothing written; adjust and re-propose). Spec §6.

**2. Live updates: one WebSocket per org, per-space subscriptions, offset-based resume** (`events.ts`). Every durable fact (change, message, topic update, membership) is an offsetted `SpaceEvent` in one per-space sequence; subscribe with `afterOffset` to replay-then-go-live. Presence is a separate ephemeral frame with no offset. This is the same catch-up pattern as the app's turn-event spine — deliberately familiar. Spec §7 (the feed renders this stream), §9.

**3. IDs are ULIDs; links are https URLs on the org address** (`ids.ts`). Spaces, assets, topics, and change-sets are all addressable with one link grammar the app intercepts (`/s/…`, `/f/…`, `/t/…`, `/c/…`, `/join/…`). Member ids are org-scoped IdP subjects — opaque, never global. Spec §4 (identity namespacing), §5 (addressability).

**4. Auth is standard OAuth 2.x, stated as TIERED requirements, not schemas** (`invite.ts` header; spec §4, amended 2026-08-18). MUST = discovery (RFC 9728 protected-resource metadata on the org + RFC 8414 AS metadata), OAuth 2.1 authorization-code + PKCE (S256), standard bearer validation — the org itself is only ever a **resource server**; the authorization server behind it is pluggable (Supabase Auth flagship). SHOULD/org-policy = DCR (on / gated / off — off degrades "any agent" to approved-clients-only; clients must handle its absence) and refresh tokens (restricting them trades unattended automations for visible re-login). This tiering matches the MCP remote-server authorization contract (discovery MUST, DCR SHOULD), on purpose. The one auth artifact with a wire shape is the **invite link** (`/join/<token>`), resolvable pre-auth so the app can show what's being joined. Spec §4.

**5. The agent face is six MCP tools** (`mcp.ts`): `list_spaces`, `read_asset`, `propose_change`, `post_to_topic`, `search_feed`, `manage_topic` — direct projections of the core operations. Semantics live in the tool design: `list_spaces` makes discovery mechanical (space ids + full file listings in one call — agents never guess ids or paths, and never depend on the README-link convention), reads bundle recent history, conflicts return current content + history, so any well-behaved agent gets read-before-write and retry for free. `reason` is **required** on the MCP face (optional on REST) — the spec's "agents always attach a why" convention, enforced where only agents call. Rowboat's own agent uses these exact tools; no privileged path. Spec §9. (Escape hatch: if dogfood grows spaces with very large file counts, the inline listings in `list_spaces` split or paginate — a v0-legal change.)

**6. Conflicts are outcomes; errors are failures** (`changeset.ts`, `errors.ts`). A stale base is a normal result of merge-then-correct, not an error — it returns 200 with everything needed to retry in one round trip (`currentContent`, `currentVersion`, colliding `regions`, `recentHistory`). The error enum is for actual failures, with `read_only_limit` encoding the over-limit-means-read-only rule (spec §4: never lockout).

## Golden merge fixtures

`packages/protocol/fixtures/merge/*.json`, schema in `fixtures.ts`. A conforming merge engine — stub or real — **must produce exactly these outcomes**: non-overlapping and identical changes merge; same-line, delete-vs-edit, and same-point insertions conflict (zero-length regions use `baseStart = baseEnd + 1`). These six cases are the §11 acceptance scenario's write patterns distilled; add a fixture with every merge-behavior dispute, and the dispute stays settled.

## Deliberately not in this package

- The **admin surface** (`/internal/*`: org provisioning, limit knobs, counters) — control-plane-facing, outside the member protocol (spec §4).
- **Render-face Latitude details** — pagination, ETags, unread counters may be added without a contract round, provided existing fields keep their meaning.
- **Presence granularity, digest thresholds, notification policy** — spec §13 open questions; the schemas carry the minimum (`PresenceState`) and will evolve with dogfood.

## Next

1. ~~`packages/server`: the **in-memory stub Harbor**~~ — done: every route in `api.ts`, the WS frames in `events.ts`, the MCP tools, a merge engine passing the fixtures, fake single-org auth, and spec §11 running as an automated acceptance test.
2. ~~`apps/x`: the client chain against the stub~~ — done: `packages/core/src/spaces/` (SpacesClient + SpacesLive + org registry, tested against the real stub), `spaces:*` IPC, functional renderer surfaces (design pass pending), and org-add auto-registering the MCP face in `mcp.json` so the user's own agent gets the spaces tools. Note: consumption ended up as `link:` (not `file:`) — pnpm copies `file:` deps at install time, which goes stale during active co-development. **zod must stay version-identical across apps/x and apps/harbor** (pinned 4.2.1) or type identity breaks across the link.
3. ~~Postgres storage~~ — done: `pg-store.ts` implements the Store boundary over a minimal SQL adapter (`sql.ts`; node-postgres for deployments, in-process PGlite for hermetic tests). `withSpaceLock` = one transaction holding a per-space advisory lock, with every store call inside riding that transaction (AsyncLocalStorage). **The §11 day-in-the-life suite runs twice — memory and Postgres — with identical assertions**; that dual run is the storage-swap gate, permanently. `DATABASE_URL` flips `pnpm dev` to durable storage (seeding is restart-idempotent). Postgres-only on purpose: no S3 in v1 — ≤1MB text contents ride in the log rows; state/history/feed/stream are projections.
4. Real OAuth (the invite.ts header contract: discovery, DCR, PKCE, refresh) replacing dev tokens — the last piece between the stub and a deployable Harbor. Then multi-org routing, then the design pass over the functional surfaces (SPACES_DESIGN_BRIEF, private repo).
