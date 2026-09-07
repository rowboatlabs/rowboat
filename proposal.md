# Proposal: Decouple server display names from addresses

**Status:** Draft for discussion
**Date:** 2026-09-07
**Scope:** Spaces (client `apps/x`, server `apps/harbor`)
**Related:** Spaces create/join UX revamp (org → "Server" rename, first-run redesign, clickable invites, personal servers)

## Summary

Today, creating an org requires the user to pick two things at once: a display name ("Org name") and a globally unique address ("Address" — a slug that becomes `<slug>.<apexDomain>`). This couples two properties with opposite constraints: names want to be free-form, friendly, and non-unique ("Book Club"); addresses must be unique, DNS-safe, and permanent. The visible symptom is the setup form itself — asking for an "address" makes creation feel like infrastructure provisioning, and uniqueness pressure will eventually force users into ugly compromises like `arjun0012`.

This proposal adopts the Discord model: **the display name is what users see and it is non-unique; the unique identifier is opaque and hidden; the only handle that travels between people is the invite link; readable addresses become an optional vanity claim made later, not a setup cost.** Concretely: the create flow asks for a name only, the server generates the address by suffixing the name with random characters, the address is not shown anywhere in the normal UI, and pretty addresses can arrive later as aliases via the already-many-to-one `org_domains` table.

## 1. Problem

### Uniqueness and readability are fused in one field

`POST /v1/orgs` takes `{name, slug}` and mints the org at `<slug>.<apexDomain>` (`apps/harbor/packages/server/src/apex.ts`). The client's create form (`apps/x/apps/renderer/src/components/spaces/atoms.tsx:305–358`) exposes both: "Org name" and "Address", with the slug auto-derived from the name but editable and mandatory. Because slugs are first-come-first-served on a shared apex, the good ones will run out, and the failure mode is a user staring at `"acme" is taken` during their first minute in the product — or settling for `acme-inc-2`, which then appears in every invite link they ever share.

### The address does three jobs and is named three ways

- Create form: "Address" = a slug (`acme`)
- Dev dialog: "Org address" = a base URL (`http://localhost:4272`)
- About card: a row labeled "Server" = a host (`acme.spaces.rowboatlabs.com`)

### The one identifier that should be stable is thrown away

The server mints a durable org id (`org-<ulid>`, `directory.ts`), but the client's `upsertOAuthOrg` (`apps/x/packages/core/src/spaces/orgs.ts:314–320`) generates its own local id and never reads `body.org.id` from the create response. Meanwhile the slug is *not* persisted anywhere — it exists only transiently as input to org creation, immediately baked into a domain. So today the hostname is the de-facto identity, which is exactly the thing that should be free to change.

## 2. Prior art: how Discord resolves this

Discord's answer is that servers have **no user-facing address at all**:

1. **Display names are non-unique.** Thousands of servers are named "Minecraft". The unique identifier is an internal snowflake ID users never see. The name field carries zero uniqueness pressure.
2. **The only handle that travels is the invite link, and it is deliberately opaque** (`discord.gg/aB3xYz9`). It is clicked or pasted, never read aloud or typed from memory. Nobody expects it to be pretty.
3. **Readable addresses are a vanity claim made later**, not a setup step: a custom `discord.gg/fortnite` unlocks at boost Level 3 (14 boosts) or partner/verified status, first-come-first-served, revocable. Readability is opt-in polish for established communities.
4. **The username precedent.** Discord lived the `arjun0012` problem for years with user discriminators (`Arjun#0012`) and killed them in 2023, splitting identity into a unique, rarely seen handle and a free-form display name.

The general pattern: **uniqueness and readability are never resolved in the same string.** What users see is free and non-unique; what is unique is opaque and hidden; pretty unique names are optional and claimed later.

## 3. Proposed model

Every server has three identifiers with distinct jobs:

| Identifier | Example | Unique? | User-visible? | Mutable? |
|---|---|---|---|---|
| Display name | `Book Club` | No | Everywhere (sidebar, headers, invites, toasts) | Freely |
| Address (host) | `book-club-x4f2.spaces.rowboatlabs.com` | Yes | No — embedded in invite URLs, never shown as UI | Via aliases (additive) |
| Org id | `org-01J8…` | Yes | Never | Never |

Plus the one artifact that moves between people: the **invite link** (`https://<address>/join/<token>`), which inherits the address but — per the Discord precedent — is clicked, not read. The invite landing page and in-app join card show the *display name* prominently; the hostname is incidental.

Rules:

- **Creation asks for a name only.** The address is generated, not chosen.
- **The org id becomes the client's durable identity** for a server (persisted from the create/list responses), so addresses can change without breaking anything local.
- **Addresses are additive.** `org_domains` is already many-to-one (`migrations.ts:127–144`; the client comment at `orgs.ts:41` even anticipates this: "addresses can change via aliases"). Claiming a pretty address later adds a domain; old invite links keep resolving.

## 4. UX changes

### Create flow

One field: **Server name** (placeholder: "Acme, book club, just me…"). No address field, no caption, no availability check in the UI. Submit → browser sign-in (unchanged) → land in the seeded first space with an "Invite your team" callout. The generated address is not shown anywhere in the normal UI — not even the About card. The org id becomes the support/debug identifier; a "Copy diagnostics" affordance (or the existing dev tier) can expose the address when troubleshooting genuinely needs it.

### Address generation is app-side — and always suffixes

**Decided 2026-09-07: no Harbor changes for creation.** The app derives a prefix from the name (the same normalizer the create dialog uses today), **always appends a short random suffix** (`book-club` → `book-club-x4f2`), and submits the existing `POST /v1/orgs {name, slug}` unchanged. On the vanishingly rare `"…is taken"` response, it regenerates the suffix and retries (bounded). If the name normalizes to nothing (emoji, non-Latin scripts), a neutral fallback prefix is used. The server keeps validating exactly as it does now.

Always-suffixing (rather than trying the bare name first and suffixing only on collision) is deliberate, for three reasons:

1. **Uniformity.** Once the address is invisible, a clean slug has zero user value — but try-bare-first would make some servers "lucky" and others not, which matters the moment any address leaks (invite URLs).
2. **No probing.** Try-bare-first turns creation into an availability oracle for taken names and needs a retry loop in the common case; with always-suffix the app never submits a bare name and the first attempt essentially always lands (a 4-char suffix is ~1.7M variants per prefix).
3. **It preserves the clean namespace.** Bare `acme` stays unclaimed until someone deliberately claims it via the vanity feature (§ below). Otherwise early throwaway creates silently squat the names real communities will want later.

The name-derived prefix is kept (rather than a fully random `s-x7f2k9`) for operators, not users: logs, DB rows, and support conversations stay human-legible. The explicit `slug` path remains available to API users and self-hosters; its `"taken"` / `"reserved"` errors are unchanged. The accepted trade of doing this app-side is that create isn't atomic against a racing identical slug — with random suffixes that race is effectively impossible, and the retry covers it anyway.

### Vanity addresses: "Claim a custom address" (later phase)

A server-settings action for admins: pick `acme` → validated against the existing slug rules and reserved list → added as an alias domain; the new domain becomes **primary** (used by `inviteUrl()` when minting new links) while old domains keep working. Unlike Discord, we don't need to gate this behind an earned tier — it's just deferred from setup to settings, where the user who cares can find it. Rate-limit claims (e.g. a few per server per month) to blunt squatting.

### Sidebar disambiguation

Non-unique names mean a user could have two "Book Club" servers in their own sidebar. Discord disambiguates with server icons; we should do the same lightweight version: a per-server color/glyph (derived from org id, admin-overridable later), with the address available as tooltip/About-level secondary text. This turns the collision problem into a display concern — which is where it should live.

### Personal servers

This proposal is what makes the personal-server plan clean: the address can be `u-arjun-x7f2.…` — fully invisible — while the sidebar says "Arjun's server". Reserve the `u-` slug prefix for personal provisioning (today's `RESERVED_SLUGS` in `apex.ts:25–28` reserves exact names only; extend with a prefix rule) so personal servers never contend with team slugs and vice versa.

### Copy sweep

| Where | Today | Proposed |
|---|---|---|
| Create dialog fields | `Org name` + `Address` | `Server name` (only) |
| About card row | `Server` (showing the host) | Removed |
| About card row label | `Organization` | `Server` |
| Dev dialog field | `Org address` | `Server URL` |

## 5. Server changes (Harbor)

1. **Nothing for creation.** Slug generation is app-side (decided 2026-09-07); `POST /v1/orgs` and its validation are untouched.
2. **`u-` prefix reservation** alongside `RESERVED_SLUGS` (personal-server phase).
3. **Primary-domain notion** for `org_domains` (a flag or ordering) so `inviteUrl()` mints from the preferred address. Today `domains: string[]` has no stated precedence.
4. **Alias-claim endpoint** (vanity phase): admin-gated, adds an `org_domains` row after slug validation, sets primary. Lives on the apex since domains are apex-scoped.
5. Nothing else: Host-header routing (`deployment.ts:129–141`), invites, auth, and the member-facing protocol are untouched. An org gaining a domain is already a supported shape.

## 6. Client changes

1. **Persist the server org id.** `upsertOAuthOrg` must store `body.org.id` (new field on `OrgRecord`) instead of discarding it. This is the keystone: it makes the address a mutable attribute rather than the identity.
2. **Wire the dead `GET /v1/orgs`** (implemented at `apex.ts:127–146`, never called by the client) so sign-in on any device rehydrates the server list keyed by org id. Without this, org-id durability has nothing to attach to across installs.
3. **Create dialog:** drop the Address field and the slug-derivation keystroke logic; submit name only. The slug (prefix + always-appended random suffix, bounded retry on `"taken"`) is generated in the create path before the existing `POST /v1/orgs` call.
4. **About card and copy sweep** per §4.
5. **Refresh address on connect:** `GET /v1/health` on an org subdomain already returns `{org: {name, address}}` — use it to pick up primary-address changes and heal stale local records.

## 7. What does not change

- **Self-hosting and dev mode.** Single-org Harbor (`startHarbor`, port 4272) has no apex and no slugs; the dev dialog keeps its explicit base-URL field. Addresses remain fully visible to the technical tier — that's the audience they serve.
- **Invite mechanics.** Space-scoped bearer links, resolution, bind ceremony, policy checks — all untouched. The hostname inside invite URLs stays (unlike Discord we route by Host, so it's load-bearing), but per the Discord precedent an opaque hostname in a clicked link costs nothing.
- **The wire protocol.** No new member-facing objects; org identity stays out of the content plane.

## 8. Risks and edge cases

- **The address still peeks through in three places, and that's accepted.** (a) Invite URLs carry the hostname — Host-header routing is load-bearing, and the Discord precedent says opaque clicked links cost nothing; a later polish option is minting apex-hosted links (`spaces.rowboatlabs.com/j/<token>`) that resolve token→org via the shared deployment DB, removing the hostname from links entirely. (b) Derived MCP server names use the slug (`spaces-<slug>`, `orgs.ts:144–170`) and can surface in agent/tool listings — switch derivation to the display name with the org id as the dedup tiebreaker. (c) Dev mode and self-hosting keep explicit addresses by design.
- **Hidden ≠ gone: support still needs an identifier.** With no address in the UI, "which server are you on?" is answered by the org id via a diagnostics affordance, not by reading a hostname off the About card.
- **Squatting shifts to the vanity claim.** First-come-first-served pretty addresses invite squatting (Discord has this problem too). Rate-limiting claims and keeping the reserved list are the v1 answer; don't over-engineer beyond that.
- **Two servers, same name, in one sidebar** — handled by iconography (§4); accept it otherwise.
- **Stale addresses in old local records.** An org whose primary address changed still answers on the old domain (aliases are additive), and §6.5 heals the record on connect. No breakage window.
- **`arjun0012`-style leakage.** The generated address will appear in shared invite URLs. This is the accepted trade — the landing page and join card foreground the display name, and no flow ever asks a human to read or type the host.

## 9. Rollout

1. **Phase A (with the create/join revamp):** name-only create with app-side slug generation; hidden address; persist org id; copy sweep; sidebar glyphs.
2. **Phase B:** `GET /v1/orgs` recovery keyed by org id; address refresh via health.
3. **Phase C:** primary-domain support + "Claim a custom address" in server settings; `u-` prefix reservation landing with personal-server provisioning.

## 10. Open questions

- ~~Should the generated address be shown once at creation or in About?~~ Resolved: fully hidden — the address appears nowhere in the normal UI; the org id is the support identifier.
- Should invite links eventually move to apex-hosted `spaces.rowboatlabs.com/j/<token>` so the hostname disappears from the last user-visible surface? (Deployment mode has the shared DB to resolve token→org; self-host keeps per-org links.)
- Does display-name rename (trivial: `orgs.name` is just a column, but there's no rename endpoint or UI today) ride along in Phase A? It's cheap and reinforces the "names are free" contract.
- For self-hosted orgs joined by URL, should the sidebar ever fall back to showing the host instead of the name? (Probably yes when the name is unset/unreachable.)
