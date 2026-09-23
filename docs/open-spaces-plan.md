# Open spaces — Harbor implementation plan

## Summary and scope

Deliver **item 1 as a server-first PR**: protocol, database, access policy, REST/MCP operations, live subscriptions, tests, and documentation. Desktop and mobile UI work follow separately.

An authenticated org member can discover and read a shared, open space without joining. Joining creates ordinary space membership; only then can they act in the space or acquire personal read/follow state.

The plan is grounded in the [Harbor guide](../apps/harbor/AGENTS.md), [SPEC §5 answers 1–2](../apps/harbor/SPEC.md#5-the-space), and the existing implementation. Before implementation, update from `main`, recheck those files, and create an isolated feature branch. Preserve the existing untracked `docs/qa/` work.

**Explicit exclusions:** team invites, default spaces, org-wide member listing, profile changes, admin controls, visibility changes after creation, archive/delete, guests, and cross-space search. Existing spaces—including `general`—remain private after migration.

## 1. Public contract and persistence

### Visibility

Introduce `SpaceVisibility = 'private' | 'open'` and a defaulted `Space.visibility` field.

- Payloads lacking visibility parse as `private`.
- REST `createSpace` and MCP `create_space` accept optional visibility, defaulting to private.
- Creation remains available to ordinary org members.
- DM creation explicitly produces private spaces.
- Preserve the current service call shape by adding an optional visibility argument after `name`.
- Update MCP `list_spaces` explicitly: it constructs its own projection and does not automatically inherit new `Space` fields.

Do not add a visibility-change route or event. That belongs to Admin controls.

### New operations

| Operation | REST | MCP | Result |
|---|---|---|---|
| Browse open spaces | `GET /v1/spaces/browse` | `browse_spaces` | `{ spaces: [{ space: Space, joined: boolean }] }` |
| List files while previewing | Existing `GET /v1/spaces/:spaceId/assets` | `list_assets({ spaceId, includeDeleted? })` | `{ entries: Asset[] }` |
| Join an open space | `POST /v1/spaces/:spaceId/join` | `join_space({ spaceId })` | `{ space: Space, membership: Membership }` |

Browse semantics:

- Include all shared, open spaces in the caller’s org, including ones already joined.
- Compute `joined` from the caller’s actual membership.
- Order by lowercase name, then ID.
- Return the complete list in v1; no pagination, search parameter, member counts, or embedded asset listings.
- Return an empty list when no spaces qualify.
- Keep existing REST/MCP joined-space listings unchanged in meaning.

Join needs no additional request fields. It joins the authenticated caller; it cannot nominate another member.

Do not add a standalone space lookup in this PR. Browse results provide metadata for open spaces, and existing read endpoints accept their IDs. App integration can use those contracts without expanding this server slice.

Register browse and join in protocol definitions, the service facade, HTTP, and MCP dispatch. Add `list_assets` as the MCP projection of the existing readable file-listing route: `list_spaces` only discovers files in joined spaces. Mark `browse_spaces` and `list_assets` as read-only MCP tools. Update tool descriptions to explain discovery, preview, and explicit joining.

### Database

Append the next available migration; do not modify previous migrations.

- Add `spaces.visibility`, non-null, default `private`.
- Constrain visibility to `private | open`.
- Add a CHECK requiring direct spaces to remain private.
- Preserve every existing row’s membership and content.

Update all space projections and mappers, including joined listings, operator listings, and direct-space lookups. Creation persists visibility; rename preserves it.

Add one org-scoped store query for browse results, using a membership join or `EXISTS` for `joined`. Avoid one membership query per result. Space IDs and member IDs from other orgs must not affect results.

## 2. Authorization and the join transaction

### Separate reading from acting

Keep decisions in `policy.ts` and fact loading in the kernel.

Introduce a read decision and `requireReadableSpace` gate:

> Allow an existing space member, or an existing org member when the space is both shared and open.

Validate org membership for the new non-membership path using the org-scoped member store. A caller-provided member ID alone is not evidence of org membership. Existing HTTP/MCP/WS authentication remains the first boundary.

Keep `requireMember` and the check inside `lockedAs` strictly membership-based. Never implement browsing by weakening the gate that writes already use.

For an org member attempting a membership-required action in an unjoined open space, return:

```json
{
  "code": "forbidden",
  "message": "join this space to post"
}
```

Preserve current private-space denial and foreign/missing-space behavior. Invalid requests still undergo normal schema validation.

### Classify every existing access-gate caller

Switch only these operations to the read gate:

- Stream, message, thread, and topic reads.
- Space roster.
- In-space search.
- Asset listing, content and versions, history, diffs, and blob downloads.
- Live catch-up/replay authorization.

Keep these membership-only:

- Messages, reactions, votes, polls, and topic mutations.
- Asset creation, edits, namespace operations, restoration, and uploads.
- Rename, invitations, and departure.
- Read marks, follow/unfollow, and membership-scoped Activity operations.
- Presence and whiteboard publishing.

Blob downloads must retain the existing space-specific blob-registry check. Knowing a hash must not grant access to bytes registered only in another space.

Guests have no implemented representation today. Add no placeholder flag; keep the new policy centralized so the eventual guest restriction has one place to integrate.

### Self-join algorithm

Use `k.locked`, because this operation creates the membership that `lockedAs` requires.

Inside the transaction:

1. Load the space and verify the caller belongs to its org.
2. Require a shared, open space. Private spaces and DMs refuse without changes.
3. Load the existing membership.
4. If it exists, return it and the space immediately.
5. Apply the org’s write-limit guard.
6. Insert the membership with one `joinedAt` timestamp.
7. Append the existing `membership` event with action `joined`.
8. Return the committed space and membership.

Consequences:

- Concurrent joins produce exactly one membership and one event.
- Retrying after a lost response returns the original membership.
- A repeat join succeeds even when the org has subsequently become read-only.
- A first join under that limit fails with the existing `read_only_limit` error.
- A failed transaction produces neither a membership nor a published event.
- Joining does not initialize read marks, follows, or historical notification delivery.

After a newly created membership commits, send the existing member-addressed `space_added` frame to the joining member’s connections, with `spaceKind: 'shared'` and `by` equal to the caller. Repeated joins send no frame. No new event or frame kind is needed.

### Preserve membership checks during races

Existing content writes already recheck membership inside `lockedAs`; preserve that behavior and test it on an open space.

For membership-only operations currently lacking the inner check, cover their mutation boundary as part of the access audit:

- Read marks, follows, and invite persistence run within `lockedAs`.
- Blob registration rechecks membership under the lock after byte upload; the existing content-addressed byte storage is not itself permission to reference the blob.
- Presence and whiteboard publishing must not pass a membership check and then publish after a committed departure. Use the existing lock/outbox mechanism for authorized publication.

Do not introduce a new transaction abstraction.

## 3. Live behavior and compatibility

### Browsing subscriptions

Allow open-space browsers through `service.replay`. Preserve the existing subscribe-before-replay buffering and offset deduplication.

Browsers may receive ordinary space events and ephemeral frames. Receiving a frame does not make them members or authorize publishing one.

The new subscription must not:

- Add membership.
- Advance read cursors.
- Create follows.
- Add unread or Activity state.
- Add the browser to push-notification recipients.

### Departure and pending subscriptions

Keep `space_removed` terminating the member’s existing subscription before forwarding the frame.

After leaving:

- A private-space subscription attempt still fails.
- An open-space subscription attempt succeeds as a browser.
- Writes still fail until another explicit join.

Protect pending replay against cancellation: associate each subscription attempt with its own identity/generation and check it before sending its acknowledgement, replay, or buffered frames. An unsubscribe, departure, socket close, or replacement subscription must prevent an older pending attempt from resuming delivery.

This is necessary because the replay call is asynchronous while member-addressed departure frames can arrive independently.

### Existing clients

This is an additive wire change:

- Missing visibility continues to mean private.
- `kind` and existing event variants remain unchanged.
- Joined-space listings do not suddenly include browsable spaces.
- Existing app creation requests continue to create private spaces.
- New behavior reuses existing membership events and `space_added`.

Run X compatibility checks against the rebuilt protocol/server packages. Any required TypeScript fixture changes are compatibility maintenance, not app feature work.

Visibility revocation and org removal remain responsibilities of the later Admin controls item. That work must account for nonmember live subscribers; this PR does not claim to implement revocation for operations that do not yet exist.

## 4. Verification and acceptance

Use the real REST, MCP, and WebSocket faces over PGlite. Use focused policy and store tests for decisions and database constraints.

Create fixtures with a creator, an org member who has never joined, an existing member, a private space, a DM, and a second org. Create test spaces explicitly so seeded membership cannot accidentally invalidate the browser scenario.

| Area | Required scenarios |
|---|---|
| Visibility | Omitted value defaults private; explicit open persists; invalid values fail; database rejects open DMs |
| Migration | Existing shared spaces and DMs become private; memberships/content unchanged; rerunning migrations is safe |
| Discovery | Only this org’s shared open spaces appear; joined flags and ordering are correct; joined listings remain unchanged |
| Authentication | Missing/invalid credentials fail; valid OIDC identity without org membership cannot browse, read, or join |
| Preview reads | Stream, threads, messages, topics, roster, search, assets, versions, history, diffs, and blobs work without joining |
| Denied actions | Valid requests for every membership-only operation fail with the prescribed error and no state change |
| Personal state | Preview and live delivery create no membership, read marks, follows, unread entries, Activity, or push delivery |
| Join | First join, repeat join, concurrent join, lost-response retry, read-only limit, and rollback |
| Live | Preview replay and ongoing delivery; replay deduplication; canceled pending subscriptions; departure and explicit resubscription |
| Races | A write losing to departure stays forbidden even though the space remains readable |
| Isolation | Private spaces, DMs, foreign IDs, and foreign blob hashes remain inaccessible |
| MCP parity | Browse/join and visibility-aware creation work through a real MCP client; outputs validate against tool schemas |

For no-op and denied-action tests, check durable state and event counts—not only response codes. For successful joins, assert one durable `joined` event and one membership-added notification per connected recipient.

Run:

1. Harbor workspace install, typecheck, and complete test suite.
2. Harbor build.
3. X workspace install and existing typecheck/test suites against the linked packages.

Manual acceptance with two identities:

1. A creates an open space and posts content.
2. B discovers it, reads content, and receives live updates without joining.
3. B cannot post and has no membership-derived personal state.
4. B joins once and can post; A sees B in the roster.
5. B leaves, can preview again, and cannot post.
6. Equivalent private-space and DM access remains denied.

## 5. Documentation, delivery, and follow-up

Update `CONTRACT.md` with dated semantics for visibility, browse/join, read-versus-act authorization, exact refusal text, idempotence, and live behavior. Name every new route and MCP tool so documentation tests pass.

Update the Harbor guide to distinguish the read gate from the membership gate. Update affected comments with the date and spec decision. No product-rule change is intended, so do not rewrite SPEC.

Use one server feature branch and PR to `main`. Describe the change as additive and deploy Harbor before any app release that exposes Open spaces. Verify browse, preview, join, and a private-space denial on the deployed server using authorized test identities.

No new telemetry system is required; use existing request errors and live-connection/subscription counters.

The follow-up app work will add creation visibility, a browser, read-only preview, and Join. It must keep preview state separate from joined-space/sidebar state and suppress automatic read marks, presence, follows, editing, and background agent actions until membership exists. Desktop/mobile delivery scope will be decided in that follow-up.
