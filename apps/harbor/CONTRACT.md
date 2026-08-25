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
- **Auth is a driver boundary** (`auth.ts`): `authenticate(token) → identity
  (iss, sub)` then `resolveMember(identity) → member`. Two drivers: `dev`
  (bearer `dev-<memberId>`; first sight creates the member — local dev and
  tests only) and `oidc` (`auth-oidc.ts`: pinned issuer, RFC 8414 discovery,
  JWKS-verified JWTs via jose, and an (iss, sub) → member lookup that NEVER
  auto-creates — a valid token with no mapping is `not_a_member`, the state
  the invite ceremony converts). With oidc configured, the org serves RFC 9728
  protected-resource metadata at `/.well-known/oauth-protected-resource` and
  401s carry `WWW-Authenticate: Bearer resource_metadata=…`, so MCP clients
  find the OAuth dance mechanically. Live-verified against a real Supabase
  Auth stack (ES256 access tokens, all three faces). `AUTH_ISSUER` flips
  `pnpm dev` to oidc.
- **The invite-binding ceremony** (`service.bindInvite`): accept-invite is
  the ONE route whose caller may be authenticated-but-not-yet-a-member — it
  binds (iss, sub) → member (minted ULID id; subjects live only in the
  mapping table), seeds `displayName` from IdP profile claims, and adds the
  membership. Every bind-time condition is org policy checked there and
  nowhere else — v1 is the email-domain rule (`HARBOR_ALLOWED_DOMAINS`),
  refusals are `policy_refused` with a human message. `Member` carries the
  org-level admin bit (`role`; seed/provisioned creator = admin) — data now,
  enforcement routes arrive with org management. Live-verified: a real
  dance-issued token went not_a_member → bind → full access, and an
  outsider's real token was policy-refused.
- **Schema is versioned migrations** (`migrations.ts`): an in-code,
  append-only ladder (`schema_migrations` ledger, advisory-locked, each
  entry transactional). 001 is the bootstrap-era schema verbatim — fully
  idempotent, so pre-migration databases adopt the ladder by no-opping
  through it. Every future schema change appends an entry; arbitrary SQL
  (backfills included) is legal from 002 on.
- **Multi-org deployment** (`deployment.ts` + `directory.ts`, spec §4
  tenancy): `startHarborDeployment` serves 1..N orgs from one process over
  one Postgres — Host (X-Forwarded-Host wins) → org → a cached per-org
  runtime (service + faces + per-org issuer/policy). `HarborService` stayed
  single-org by design; migration 003 org-scopes members/spaces/identities
  (`member_identities` keys `(org_id, iss, sub)` — the same identity is a
  different member per org); space-scoped tables are untouched (globally
  unique ULIDs; one shared hub is therefore safe). Existing single-org data
  adopts `org-default`. `startHarbor` remains the single-org self-host/dev
  path, unchanged. Issuer-less orgs are refused unless the deployment opts
  into dev orgs. Isolation is test-pinned (`test/multi-org.test.ts`): spaces,
  members, invites, policy, live and agent faces all org-bounded.
- **Login/consent page** (`consent.ts`, `GET /oauth/consent`): the human
  moment of the dance, mounted only with oidc + `AUTH_PUBLISHABLE_KEY`.
  Social sign-in ONLY (Google + Microsoft) — every credentialed call goes
  browser → AS directly; Harbor serves static HTML and never sees or proxies
  a credential. Drives GoTrue's consent state machine (claim GET is
  mandatory before the approve/deny POST; the response's `redirect_url`
  carries the code back). Deployment wiring: the AS's `site_url` must point
  at the org address (consent redirect target = site_url +
  authorization_url_path). Live-verified: a real DCR + PKCE authorize 302s
  onto this route, and the page's exact fetch sequence completes the dance.
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
- **Every space is born with its stream**: a `kind: 'general'` topic (titled
  "messages", empty — no seed message) seeded at space creation, exactly one
  per space (partial unique index). All other topics are `kind: 'discussion'`.
- **A topic can grow from a message**: `anchorMessageId` on topic creation
  (validated, at most one topic per message). Provenance, not hierarchy — the
  anchored message may live in any topic; clients render a flat topic list.
- **Change-sets carry topic provenance**: `ChangeSet.topicId`, from an explicit
  (validated) `topicId` on the proposal or derived from the `· topic:<id>`
  reason suffix that prompt-driven agents write (`topicIdFromReason`, best
  effort). Harbor migration 004 backfilled all three fields from the legacy
  client conventions (title match, first-message marker, reason suffix).
- **`merge_into`** repoints the source's messages, archives the source, returns
  the *target*. Durable message events keep their original `topicId` — clients
  refetch a thread when a topic event announces a merge.
- **Reactions are per-(member, emoji) toggles on messages** (Slack semantics,
  `reactToMessage` route + the `reaction` event): any member, any message, the
  emoji itself on the wire (never a `:name:`). Re-adding what exists / removing
  what doesn't is an idempotent 200 no-op — no write, no event. `Message`
  carries folded `reactions` groups (first-reacted order) on reads; the copy
  inside a stored `message` event is its at-post snapshot (empty), so clients
  fold `reaction` events or refetch. Attribution rides the reaction
  (`by: Attribution`) like every other act. Render-face only for now — the
  six MCP tools deliberately don't react (an agent's ack is a reply).
- **Message deletion is an author-only tombstone** (`deleteMessage` route + the
  `message_deleted` event): the content plane stays role-flat, so deleter ==
  author, always. The row keeps its id/offset (threads stay anchored) but
  `body` is redacted to `''` and `deletedAt` set — **in the messages row AND
  the stored `message` event**, the one in-place log rewrite the design
  allows, because a deleted body must be unrecoverable, replay included.
  Deletion decrements the topic's `messageCount` without bumping
  `lastActivityAt` and emits no topic event. Re-deleting is an idempotent 200
  no-op. Tombstones take no new reactions (`invalid_request`); removes still
  work so cleanup stays possible. Render-face only, like reactions.
- **Unknown invite tokens are 404**; `expired`/`revoked` are resolvable states.
- **MCP face attribution**: acting mode defaults to `agent`; automations
  declare `x-acting-mode: scheduled`; `x-agent-name` carries the display label.
  Stateless transport (per-request server bound to the caller's token).

## The six wire decisions

**1. Change-sets are full content against a declared base** (`changeset.ts`). `ProposeChange = {assetPath, baseVersion, newContent, reason?, actingMode}`. The org runs a line-level three-way merge. No operation encoding, no diffs on the wire — v1 assets are small text files; simplicity beats cleverness. Three outcomes, all HTTP 200: `applied` (base was current), `merged` (stale but clean — **the returned `mergedContent` is what now exists; the proposer must adopt it**), `conflict` (nothing written; adjust and re-propose). Spec §6.

Amended 2026-08-24 (spec §6 binary assets, previously Deferred §12): a proposal carries **exactly one of `newContent` (text) or `blob` (a sha256 already uploaded to the space via `uploadBlob`)**. Upload is two-phase: `PUT /v1/spaces/:id/blobs` (raw bytes + mandatory `x-blob-sha256` the org recomputes; `content-type` advisory, org sniffs and its verdict is authoritative) → reference the hash (a message body's `/b/` link, or the blob propose). Version rows, change-sets, `listAssets` entries, and `ReadAssetResult` all carry `{hash, size, mime}` for binary versions — one namespace, one log. **Binary staleness never merges**: any binary side of a stale propose is `conflict` with `regions: []` and `currentBlob` (conflict-or-replace). Serving (`GET /v1/spaces/:id/blobs/:hash`) is membership-gated and either streams (disk driver) or 302s to a presigned URL (S3-family) — driver choice is invisible in client code; sniffed images serve inline, everything else forced `attachment` + nosniff (no upload-time type restrictions, by decision). Blob readability is space-scoped (`space_blobs` registry — the read gate); byte dedup underneath is per org, never global.

**2. Live updates: one WebSocket per org, per-space subscriptions, offset-based resume** (`events.ts`). Every durable fact (change, message, topic update, membership) is an offsetted `SpaceEvent` in one per-space sequence; subscribe with `afterOffset` to replay-then-go-live. Presence is a separate ephemeral frame with no offset. This is the same catch-up pattern as the app's turn-event spine — deliberately familiar. Spec §7 (the feed renders this stream), §9.

**3. IDs are ULIDs; links are https URLs on the org address** (`ids.ts`). Spaces, assets, topics, change-sets, and blobs are all addressable with one link grammar the app intercepts (`/s/…`, `/f/…`, `/t/…`, `/c/…`, `/b/…`, `/join/…`). Member ids are org-scoped IdP subjects — opaque, never global. Spec §4 (identity namespacing), §5 (addressability).

**4. Auth is standard OAuth 2.x, stated as TIERED requirements, not schemas** (`invite.ts` header; spec §4, amended 2026-08-18). MUST = discovery (RFC 9728 protected-resource metadata on the org + RFC 8414 AS metadata), OAuth 2.1 authorization-code + PKCE (S256), standard bearer validation — the org itself is only ever a **resource server**; the authorization server behind it is pluggable (Supabase Auth flagship). SHOULD/org-policy = DCR (on / gated / off — off degrades "any agent" to approved-clients-only; clients must handle its absence) and refresh tokens (restricting them trades unattended automations for visible re-login). This tiering matches the MCP remote-server authorization contract (discovery MUST, DCR SHOULD), on purpose. The one auth artifact with a wire shape is the **invite link** (`/join/<token>`), resolvable pre-auth so the app can show what's being joined. Spec §4.

Amended 2026-08-19 (spec §4: invites/profile/roles): an invite is one shape — an **open bearer secret**; acceptance binds to the authenticated (issuer, subject), and **every bind-time condition is org policy checked in one place at acceptance** (v1: the email-domain rule; a per-person email-bound invite variant was considered and dropped — policy checks never live in the token). Wire impact when built: the accept path gains a policy-refused state; `Member` gains the org-level **admin bit** (membership/policy powers only — the content plane stays role-flat) and later a `handle` (org-unique, deferred until human mentions ship; attribution keys on member id, never name/handle).

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
4. ~~Real OAuth~~ — **DONE end to end, live-verified against Supabase Auth**: the `oidc` auth driver, the login/consent page (buttons derived from the AS's /settings), the invite-binding ceremony, and the app side — `core/spaces/oauth.ts` (discovery → DCR → PKCE via system browser + one-shot loopback) with rotating-refresh token lifecycle in the org registry (`freshTokenFor`: single-flight, persist-rotated-refresh-before-use, needs-relogin marking) and the paste-invite-link join UI. The one unautomatable step: a real Google/Microsoft click-through, pending provider creds on a Supabase project.
5. ~~Multi-org routing~~ — done (`deployment.ts`, see the stub notes above), plus the **apex face** (`apex.ts`): self-serve org creation on the deployment's apex domain, identity-level auth, caller = provisioned first admin, realm-generic tokens work at the new org immediately. Decision 2026-08-20: creation is free-for-now and Harbor-native; `/internal` + limit knobs are PARKED until the knob discussion lands (billing later gates these calls, it doesn't replace them). `HARBOR_MODE=deployment` + the Dockerfile make the container real (live-verified against Postgres). Next: the actual Render deployment (wildcard-cert verification, billing-Supabase OAuth wiring), then the design pass over the functional surfaces (SPACES_DESIGN_BRIEF, private repo).
