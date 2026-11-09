# Harbor — how it is built

Harbor is the Spaces server: one server, its members, flat spaces, an append-only log, three faces (orgs were dissolved 2026-11-09, spec §4). This file is the mechanics — where things live, the invariants, the slice a capability cuts through, how to run and ship. What Spaces *is* and why is [SPEC.md](./SPEC.md); what the wire *means* is [CONTRACT.md](./CONTRACT.md). One kind of fact per document; link, never restate.

## Layout

Two pnpm workspace packages under `packages/`:

- **`protocol/`** — `@rowboat/spaces-protocol`, the contract: zod schemas imported by the server *and* the app, so drift is structurally impossible. `core.ts` (the objects), `blob.ts` (blob metadata and the download filename policy shared with desktop, 2026-11-06), `ids.ts` (ids, the link grammar and its one parser), `changeset.ts`, `events.ts` (`SpaceEvent` and the live frames), `invocation.ts` (the agent contracts: `Invocation`, its states, `InvocationOption`, `InvocationUpdate`, `ConnectorCapabilities`), `approval.ts` (`Approval`, an agent's request for a person's OK, and its choices), `api.ts` (`routes`), `mcp.ts` (`mcpTools`), `mentions.ts`, `agent-prompt.ts` (what every connector writes into its agent's message: the request, the thread, files, the standing paragraph; 2026-10-28), `search.ts`, `invite.ts`, `errors.ts`, `fixtures/merge/` (the golden merge cases every engine must pass).
- **`server/`** — `@rowboat/harbor`:

| `src/` | Owns |
|---|---|
| `core/kernel.ts` | store, hub, the server's address, the read-only knob, the space lock with its publish-after-commit outbox, `append` / `nextOffset` / `appendNext`, `requireSpace` / `requireMember` / `requireAdmin` (the space's admin bit, 2026-11-09), `guardWrite`, `attributionOf`, `publishProfile` (notifying everyone who shares a space with the member after profile persistence, 2026-10-22) |
| `core/spaces.ts` | spaces, direct messages and the reach rule, invites (to a space or a person) and the bind ceremony, roles and the last-admin inheritance, contacts, `me`, agent members (`createAgent`), push registration, the membership-gated replay and live relays |
| `core/agents.ts` | agent members' owners and keys: add an agent, list the ones a member manages, create and revoke keys; a platform agent's alert hook (set, clear, and the pre-auth delivery's secret check) |
| `core/agent-presence.ts` | whether an agent whose connector holds its own key is connected (local agents, 2026-10-28): live connections counted per agent from `ws.ts`, the roster's `online`, and `agent_presence` to every member after a grace; human connections share that count and grace through `onlinePeople` / `member_presence` (2026-11-04) |
| `core/hosting.ts` | managed agents (spec §8 Maritime, 2026-10-26): the hosting record per agent Rowboat's own platform account runs, creation (intent, then the platform, then the member with the platform's id and the deployment's key sealed as its credential), deletion, the worker that follows the platform to `ready` and through `deleted`, and managing the VM (2026-10-27: environment, power, commands, logs, files, skills, triggers) for the owner; the platform's calls are a `HostingProvider`'s and its `HostingOps` (`connectors/maritime/provisioning.ts`) |
| `core/invocations.ts` | invoking agent members (spec §8): the trigger `Feed.postMessage` runs in its transaction, the per-(agent, conversation) queue, the connector's operations, cancel and stop, and approvals (part 4: raised with their card in `Feed.postMessage`'s transaction, decided by a person, settled by the connector; `approval-card.ts` writes the card's text); its frames leave after the commit through its own outbox, which also accumulates per-turn activity in memory and clears it on terminal states (2026-11-01); snapshots attach history, live frames carry only the new entry |
| `core/super-agents.ts` | super agents (spec §4 Agent members, 2026-11-02; the owner's switch since 2026-11-09): a super agent's `create_agent` and `delete_agent`, at once, as an approval card Harbor raises on its turn and applies once its owner allows it, or as a setup card its owner completes by adding the agent with the card as `request` |
| `core/assets.ts` | assets by id, versions, the change log, blobs, history, diff |
| `core/images.ts` | profile images: a member's avatar, the server's image registry (`images`) and its read gate |
| `core/feed.ts` | messages, threads, topics, reactions, polls, search, mention stamps and their backfill, and the secrets a message shares with the members it mentions (sealed apart from the log, read only by those readers, 2026-11-04) |
| `core/read-state.ts` | read marks, follows, unread, Activity, read-all |
| `service.ts` | `HarborService`, the facade: one delegate per public method, `server` / `readOnly` accessors |
| `policy.ts` | who may do what — pure decisions over facts the core loads; `enforce` throws |
| `store.ts`, `pg-store.ts` | the data boundary and its one driver; `PgStore.transaction(fn)` for an org-level all-or-nothing write; `sql.ts` (node-postgres), `sql-pglite.ts` (Postgres in-process) |
| `migrations.ts` | the append-only schema ladder |
| `http.ts`, `ws.ts`, `mcp.ts` | the three faces; `origin.ts` (the public origin behind the proxy); `cors.ts` (the browser origins the render face answers); `session.ts` (the web app's session cookie: minting it, and when a request may use it); the consent page and `DELETE /v1/me` mount here since 2026-11-09 |
| `auth.ts`, `auth-oidc.ts` | the drivers, `bindAuth` / `ServerAuth` (which resolves agent keys ahead of any driver), `authenticateRequest`, the RFC 9728 helpers; `consent.ts` (the login page); `agent-keys.ts` (minting and hashing an agent key) |
| `runtime.ts` | `buildRuntime` — the one assembly of the server |
| `billing.ts` | billing for managed agents (2026-11-04): the `BillingAccounts` Harbor reports to and asks, and its HTTP client for rowboatx-backend's internal routes; `core/hosting.ts` owns when it is called |
| `server.ts`, `main.ts` | `startHarbor` and the dev seed; the binary (PGlite in dev, Postgres with `DATABASE_URL`). The multi-org deployment, directory and apex modules were deleted 2026-11-09 |
| `notify.ts`, `push.ts` | the one notification decision; Expo delivery |
| `hub.ts`, `blobs*.ts`, `mime.ts`, `merge.ts`, `search.ts`, `mentions-backfill.ts` | in-process fan-out, blob drivers, sniffing, the three-way merge, query parsing, the mentions backfill |
| `connectors/` | connectors Harbor runs for platform agents (spec §8 Connectors): `platforms.ts` (the registry), `host.ts` (one per platform agent, started with the org), `replicas/` (the Replicas connector: its API client and event stream, turn reading, the prompt), `agent37/` (the Agent37 connector: its API client and SSE parser, the turn loop, the prompt, and `setup.ts`, the Add flow's listing and creating of instances, 2026-11-02), `conductor/` (the Conductor connector: its API client, polling, transcript reading), `maritime/` (the Maritime connector: its API client, one shell template per runtime in `runtimes.ts`, the exec-driven turn loop with separate catalogue maintenance after settling a turn (2026-11-01), `provisioning.ts`, the managed-hosting provider, and `setup.ts`, the Add flow's listing of the agents a key reaches), `common/` (what the coding-agent connectors share: the thread context and files, reading a coding agent's events), `thread-prompt.ts` (what both write into a prompt: attachments, the request marker, the standing paragraph; since 2026-10-28 a re-export of the protocol's `agent-prompt.ts`, which the desktop's local agents use too, as `common/prompt.ts`'s `buildPrompt` is); `commands.ts` (bots: a service's agent answering commands from its API, 2026-10-03) with `posthog/` and `cal/`, each a client, its commands and what its alerts say; `attio/` validates Attio credentials and read access through the same bot host; `sealing.ts` seals their platform keys under `HARBOR_INTEGRATION_KEY` |
| `stats.ts`, `internal.ts` | the live-load counters (connections, subscriptions, frames per minute by kind, deliveries) and the operator face that reads them, `GET /internal/stats` behind `HARBOR_INTERNAL_KEY` |

`examples/echo-agent.mjs` is the smallest connector for the agent contract (spec §8): one agent's key, the live frame plus a list every minute, acknowledge, report, reply in the thread. Run it against a dev Harbor to watch invocations end to end, and start a real connector from its shape. The Hermes connector is that shape as a Hermes platform plugin, in its own repo ([rowboatlabs/hermes-rowboat](https://github.com/rowboatlabs/hermes-rowboat)); nothing in Harbor is specific to it. The Replicas, Agent37 and Conductor connectors are the same shape run inside Harbor (`connectors/replicas/`, `connectors/agent37/`, `connectors/conductor/`), because Harbor calls those platforms; `test/fake-replicas.ts`, `test/fake-agent37.ts` and `test/fake-conductor.ts` stand in for their APIs in the tests. Jev's connector was removed with the orgs (2026-11-09, spec §8 Jev).

`test/` has one file per feature, every one on in-process Postgres. `helpers.ts` gives `startTestHarbor` (a harbor over a fresh database, closed with it), `restClient`, `agentClient`, `liveClient`, `startFakeAs` (a fake authorization server: discovery, JWKS, minted JWTs). `day-in-the-life.test.ts` is spec §11 as code; `mcp-parity.test.ts` proves the agent face; `policy.test.ts` pins every rule without a store.

## Invariants

- **One core, three doors.** The faces hold `{ service, auth: ServerAuth }` and never the store. Rowboat's own agent uses the same MCP tools as any agent; there is no privileged path.
- **Rules live in `policy.ts`.** Every question of the form "may this actor do this to this space or message" is a pure decision there; the core loads the facts and asks; no face decides anything.
- **Membership is the one gate (2026-11-09; open spaces retired).** `requireMember` loads the space and the caller's membership row for `canAccessSpace`; `requireAdmin` adds the row's admin bit for membership acts (spec §4 Roles). `lockedAs` re-verifies the same inside the transaction. Durable events use the transaction outbox, never publish an uncommitted write.
- **Every write to the log runs inside the space lock (2026-09-25, PR #1121).** Membership-gated relays and personal state check the gate and act directly, without a transaction. A member's log write uses `k.lockedAs(ctx, spaceId, …)`, which re-verifies access inside the transaction, so a write that lost a race to a removal is refused, never landed; acts that create the membership themselves, and operator passes, use `k.locked`. On Postgres the lock is the transaction. Events go through `k.append` / `k.appendNext`, which hold frames until the commit returns, so a subscriber never sees an uncommitted fact or a rolled-back phantom.
- **The log is append-only, with two named exceptions.** Message deletion and message editing redact the stored event, because replay must never resurrect the text. Nothing else edits a stored event.
- **Migrations are append-only.** One concern per entry, never edit an applied one, arbitrary SQL is fine from 002. Generated columns belong to Postgres; code never writes them.
- **One store driver.** Tests and `pnpm dev` run the production SQL on PGlite. Do not add an in-memory store.
- **Parity.** Every member operation exists on both the render face and the agent face; `reason` is required on the agent face's file operations. `mcp-parity.test.ts` is where a new tool proves itself. The one exception is secrets (2026-09-29): a secret never passes through a tool, so agent keys are managed, and a message's secrets handed over and read (2026-11-04), on the render face only.
- **Attribution is universal.** Every act is a member's, built by `k.attributionOf(ctx, input)`; `actingMode` records how, never who else. Author-only checks compare member ids, not modes: a member's agent counts as the member.
- **One server, one identity.** A person is one member row, keyed by `(iss, sub)` in `member_identities`; nothing carries an `org_id` (dropped by migration `0NN-no-orgs`, 2026-11-09). Member and space ids are global ULIDs.
- **Every space-keyed table cascades from its space (2026-10-13, migration 039, spec §6).** A new table with a `space_id` gets `foreign key (space_id) references spaces(id) on delete cascade` in the migration that creates it; `space-cascade.test.ts` fails otherwise, because deleting a space is one statement and a table without the cascade would keep rows for a space that no longer exists.
- **Bytes-derived facts are the org's.** Mime, image dimensions, hashes — computed from the bytes at upload; a client's claim is a fallback, never a fact.
- **Conflicts are outcomes, errors are failures.** A stale base returns `conflict` with everything needed to retry; `HarborError` carries a contract `ErrorCode`.

## Adding a capability — the slice

Every feature cuts the same places, in this order. The DM feature (PR #984) is a complete worked example in `git log`.

1. **Protocol.** Types in `core.ts`; the route in `api.ts` (`routes.<name>` with params, query, request, response); the event in `events.ts` if it is a space fact; the tool in `mcp.ts`; a fixture under `fixtures/merge/` if merge behavior changes.
2. **Migration.** Append to `migrations.ts` as `0NN-<concern>`.
3. **Store.** The method on `store.ts`, its SQL in `pg-store.ts`.
4. **Policy.** If there is a who-may rule, a decision in `policy.ts` and a case in `policy.test.ts`.
5. **Core.** The method in the right aggregate under `core/`, in the shape below.
6. **Facade.** One delegate in `service.ts`.
7. **Faces.** The route in `http.ts` (`parseWith` for params and query, `body` for JSON, `reply` validates the response against the contract before it leaves); the case in `mcp.ts`'s `dispatch`.
8. **Tests.** A file under `test/` over `startTestHarbor`, speaking the wire through both faces where the operation has both.
9. **CONTRACT.md.** A dated bullet in the settled-semantics section saying what the wire means. `docs.test.ts` fails if a route or tool goes unmentioned.
10. **SPEC.md.** Only if a product rule changed: amend the section, dated.

The write-path shape every core method follows:

```ts
async renameSpace(ctx: ActorCtx, spaceId: string, input: RenameSpaceInput): Promise<Space> {
  const space = await this.k.requireMember(ctx, spaceId);   // gate: load the facts, policy decides
  enforce(canRenameSpace(space));                            // the rule, from policy.ts
  this.k.guardWrite();                                       // the org may be read-only
  const by = this.k.attributionOf(ctx, input);               // who, and how
  return this.k.lockedAs(ctx, spaceId, async () => {        // the space lock — the transaction; access re-verified inside
    const current = (await this.k.store.getSpace(spaceId)) ?? space;   // re-read inside it
    if (current.name === input.name) return current;         // idempotent no-op: no write, no event
    const updated: Space = { ...current, name: input.name };
    await this.k.store.putSpace(updated);
    await this.k.appendNext(spaceId, this.k.now(), { type: 'space_renamed', space: updated, by });
    return updated;                                          // frames leave the hub after the commit
  });
}
```

Preconditions about the object's state — a tombstone, a closed poll, a stale base, an occupied path — stay in the method. Rules about the actor or the space's kind go to `policy.ts`.

## Style

- Comments say **why**, with the date and the decision they implement — `(spec §4, amended 2026-08-19)`, `(PR #944)`. The code says what.
- The domain's names: member, space, asset, change-set, topic, stream, thread, root, offset. `Topic` on the wire, "Discussion" in the UI.
- Wire-visible behavior gets a test that speaks the wire, not a test of internals. Idempotent no-ops are tested as no-ops: no write, no event.
- Nothing speculative: no seat reserved for a rule that has no route yet.

## Run and test

```sh
cd apps/harbor
pnpm install
pnpm -r typecheck && pnpm -r test          # every test on in-process Postgres, about ten seconds
cd packages/server && pnpm dev             # a seeded server on :4272 — PGlite in memory, restart = clean slate
DATABASE_URL=postgres://… pnpm dev         # the same on durable Postgres
```

Dev auth is `Authorization: Bearer dev-<memberId>` (first sight creates the member; never expose it). `AUTH_ISSUER` switches to real OIDC; `AUTH_PUBLISHABLE_KEY` mounts the login page. After changing protocol or server code, restart `pnpm dev`: tsx loads source at start, and a stale server silently rejects new frame fields.

## Auth, as built

Harbor is only ever a **resource server**. A driver turns a bearer into an identity (`dev`, or `oidc`: pinned issuer, RFC 8414 discovery, JWKS-verified JWTs) and the server's identity table turns `(iss, sub)` into a member — never auto-created; a valid token with no mapping is `not_a_member`, and two routes accept it: the invite-bind ceremony (`bindInvite`) and becoming a member on first contact (`enroll`, `POST /v1/me`, 2026-11-09). The server serves RFC 9728 resource metadata and its 401s point at it, so MCP clients find the OAuth dance mechanically. A browser (the Spaces web app) presents the same token as Harbor's session cookie, which `POST /v1/session` sets. The cookie counts only from a listed origin, and a header always wins over it (`session.ts`; CONTRACT.md). The login page (`consent.ts`) is static HTML that drives the authorization server's consent state machine in the browser; Harbor never sees a credential.

Verified against Supabase Auth (2026-08-18/19), the flagship AS: tokens on a shared realm are realm-generic (`aud: "authenticated"`), so **membership is the authorization boundary**, not the audience; the consent flow is claim-then-approve (`GET /oauth/authorizations/{id}` before the `POST`); with DCR off the `registration_endpoint` disappears from discovery, so clients detect the policy mechanically; refresh tokens rotate on use; the OAuth server ships in GoTrue itself, so self-hosting needs no Supabase fleet.

## Ship

- `DATABASE_URL`, `HARBOR_ADDRESS` (the public host, e.g. `spaces.x.rowboatlabs.com`; links and discovery are built on it), `AUTH_ISSUER`; optional `AUTH_PUBLISHABLE_KEY`, `HARBOR_WEB_ORIGINS` (the browser origins allowed cross-origin; dev defaults to the web app's `http://localhost:5174`), `HARBOR_WEB_APP_URL` (the web app an org link opened in a browser offers beside the desktop app; the same dev default), `BLOBS_S3_*` or `BLOBS_DIR`, `HARBOR_MAX_BLOB_BYTES`, `DATABASE_POOL_MAX`, `HARBOR_INTERNAL_KEY`, `HARBOR_INTEGRATION_KEY` (sealing platform agents' keys; without it Replicas, Agent37, Conductor, PostHog, Cal.com and Attio agents can't be added), `HARBOR_MARITIME_API_KEY` (Rowboat's Maritime key, deploy, secrets and manage scopes, which managed agents are created with; without it the app offers none) `HARBOR_MARITIME_LLM_CAP_CENTS` (the trial: the monthly AI spend a new managed agent may draw from Rowboat's Maritime credits until its owner adds a key, or thirty days pass) `HARBOR_MARITIME_IDLE_SECONDS` (how long a managed VM stays awake after its last activity; unset = Maritime's default), and `HARBOR_BILLING_URL` with `HARBOR_BILLING_KEY` (2026-11-04: rowboatx-backend's origin and its internal key; with both, managed agents bill to their owners' Rowboat accounts and there is no trial; optional `HARBOR_BILLING_ISSUER`, the issuer whose subjects are Rowboat accounts, and `HARBOR_BILLING_UPGRADE_URL`, else the backend's own app address). The `Dockerfile` header lists them. Migrations self-apply at boot under an advisory lock. The one-server release (migration 061, 2026-11-09) also needs `scripts/flatten-blobs.ts` run once against the blob store before the new build starts: blob bytes move from the per-org prefixes to the one flat prefix (idempotent; nothing is deleted).
- **Server before app.** A breaking wire change deploys the server first and the app build the same day; an additive change needs no coupling. Say which in the PR. The no-orgs release (2026-11-09) is the breaking case: rehearse its migration on staging against a restored production snapshot first.
- **One instance.** Autoscaling stays off until everything in [SPEC.md §4 *Running more than one instance*](SPEC.md#running-more-than-one-instance--deferred-added-2026-09-30) is addressed: the hub's shared bus, and the lease for connectors Harbor runs. `GET /internal/stats` with the operator key shows what the instance carries — connections, subscriptions, frames per minute by kind, deliveries — the numbers that say when one stops being enough; the same line lands in the log once a minute whether or not the key is set. When a second instance comes, the counters feed an OpenTelemetry push and the hub gets its bus in the same change.
- The S3 blob driver's conformance suite runs when `HARBOR_TEST_S3_BUCKET` is set; the disk driver's always.

## Before you open a PR

1. Did a **product rule** change? → amend the SPEC.md section, dated.
2. Did the **wire** change? → the protocol package and a dated CONTRACT.md bullet.
3. Did the **structure** change — a module, an invariant, the slice? → this file.

Availability (2026-11-05): `core/human-presence.ts` owns per-socket human activity leases and `member_presence`; `core/agent-presence.ts` owns agent connection presence only. `protocol/availability.ts` validates preferences and evaluates schedule/status expiry identically in the notification decision and renderer. `Spaces.updateProfile` patches the member's JSON preferences atomically via `Store.patchAvailability`; ordinary profile/avatar writes leave them alone. `notify.ts` excludes paused recipients before either delivery channel.
