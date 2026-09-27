# Rowboat Spaces — Shared Spaces for Humans and Their Agents

> A space is a shared container — files, a threaded feed, and members — that lives in an **org**: any OAuth-speaking server implementing the spaces protocol. The org stores bytes; every act of intelligence happens on a member's own machine, as that member.

**Status:** v1 · live in production · first draft 2026-08-13 · amended through 2026-09-22.

This spec lives beside the code it governs (moved here 2026-09-22 from the private `rowboatlabs/harbor` repo at `28ffe08f`, now retired). Three documents, one kind of fact each: **this file** owns the product model and its rules; [`CONTRACT.md`](./CONTRACT.md) owns the wire shape and its settled semantics; [`AGENTS.md`](./AGENTS.md) owns how the server is built. A fact appears in one of them and is linked from the others, never restated.

---

## How to read this spec

Every design statement in this document carries one of three weights:

- **Decided** — set in stone. These are the principles and semantics the design was argued from; changing one requires revisiting the argument, not just the code.
- **Latitude** — the implementer's choice. The spec states the requirement and the shape; the mechanism may evolve freely.
- **Deferred** — explicitly out of v1, listed in §12 so its absence reads as a decision, not an oversight.

Unmarked prose is context and rationale. When in doubt, the principles in §2 win.

**Terminology (decided 2026-08-14, settled after three rounds):** the guiding principle — **user vocabulary coheres with the feature; operator vocabulary coheres with the infrastructure.** Users live in **Rowboat Spaces**, so their words are **space** and **org** (the tenant: your team's own corner — its sign-in, its members, its spaces). The org is deliberately demoted in everyday UI: it surfaces as a badge and an address (e.g. `acme.rowboat.space`), and the phrase people actually share is the space-level **invite link** — the tenant noun is rarely spoken. Operators deploy **Harbor**, the open-source server (`apps/harbor` in the rowboat monorepo; its own repo is §13's last question); one **deployment** serves one org or many. "Harbor" and "deployment" never appear in the app UI. "Host" is only a verb or adjective (self-hosted, Rowboat-hosted, managed hosting). A harbor-as-tenant naming ("harbor links") was tried and reverted the same day: it exported the server's metaphor into user sentences where it has no anchor. Harbor's name is deliberately not globally unique — always Rowboat-scoped ("Rowboat Harbor"); the collision with goharbor.io (the CNCF container registry) was considered and accepted on that basis. The protocol remains the descriptive "**spaces protocol**".

## Table of contents

1. [Vision](#1-vision)
2. [Principles](#2-principles)
3. [Concepts](#3-concepts)
4. [Orgs and identity](#4-orgs-and-identity)
5. [The space](#5-the-space)
6. [The change-set log](#6-the-change-set-log)
7. [The feed](#7-the-feed)
8. [Agents in spaces](#8-agents-in-spaces)
9. [API surface: one core, two faces](#9-api-surface-one-core-two-faces)
10. [Client integration (apps/x)](#10-client-integration-appsx)
11. [V1 slice: the team roadmap dogfood](#11-v1-slice-the-team-roadmap-dogfood)
12. [Explicitly deferred](#12-explicitly-deferred)
13. [Open questions](#13-open-questions)

---

## 1. Vision

### The problem

Real collaboration between people who each work with an AI agent is currently routed through platforms that were designed for humans only. Three scenes from our own team:

**The PR review.** Arjun pings Slack with a PR link. Ramnique reviews it with a coding agent, asks follow-ups, then has the agent serialize its findings into a GitHub comment — prose deliberately formatted with file/function pointers "so the author's agent can be pointed at any bullet." Arjun then pastes that comment into his own agent session — the one that produced the PR and still holds all the intent. Two agents with rich structured context communicate through a flattened text comment, and the humans act as packet routers between three platforms. The refuted findings, the reasoning, the author's intent — each hop loses most of it.

**The launch post.** Arjun drafts a Show HN post in Rowboat with agent help. He wants Ramnique's input — on the document, in context, with both of their agents able to participate. Today that means exporting to a Google Doc or pasting into Slack, severing the draft from the agent context that produced it.

**The team roadmap.** Five people capture standup notes in their own Rowboats. Customer signals arrive in individual inboxes all day. The team wants one living backlog document that everyone — and everyone's agent — can update, see live, and trust. Today that document lives in someone's stale note or a chaotic Slack channel.

The pattern: the collaboration is **human A + agent A ↔ human B + agent B**, but the substrate is fragmented across an attention layer (Slack), an artifact layer (GitHub/Docs), and each person's private context+compute layer. Every hop is a manual copy-paste with context loss.

### The bet

Give Rowboat a native shared container — a **space** — where the files, the conversation, and the agents' participation live together. Humans join as themselves. Agents join as extensions of their humans. Nothing is exported or re-imported, because the artifact, the discussion about it, and the work on it are one continuous context.

Spaces is **not**: a Slack clone (the feed is coordination, not the team's memory), a Google Docs clone (documents are agent-collaborative, commit-based, provenance-first), or a hosted agent platform (the server runs no agents, ever — see §2).

### Why Rowboat can build this and incumbents can't

The unit of collaboration here is not a message or a document — it is an **attributed change with reasoning**, produced equally by a human hand or a member's agent. Products built human-first bolt agents on as "bots" with special accounts and special permissions. In Spaces, agents are not members; *people* are members, and every agent action is an act of its person. That single choice dissolves the permission, billing, and identity questions that sink "team AI" products.

---

## 2. Principles

These eight rules are the constitution. Every later section is derivable from them. All are **Decided**.

1. **The hub never thinks.** The server — Harbor — stores state — files, messages, membership, history — and moves bytes. It runs no agents, holds no model keys, executes no tools. "We host bytes, not brains."
2. **All agency lives at the edges.** Anything that acts — drafting, reviewing, housekeeping, summarizing — is some member's agent running on that member's machine with that member's models, tools, accounts, and permissions.
3. **Only you command your compute.** No one can instruct another person's agent. Requests to another person's agent are requests to the *person*, made socially, in the open.
4. **Attribution is universal.** Every act in a space belongs to a member: "Ramnique", "Ramnique (via Rowboat)", "Ramnique (via Rowboat, scheduled)". There are no unowned actions.
5. **No write is ever silently lost.** Concurrent edits merge or surface a conflict; they never clobber. Last-write-wins at document granularity is rejected.
6. **Convention over enforcement; merge-then-correct.** The system records everything and gates almost nothing. Coordination (who pushes standup notes, who housekeeps) is social; the complete history is the safety net. Designed for high-trust teams first.
7. **Structure is recovered by agents, not demanded from humans.** No required titles, no mandatory categorization, no ceremony at write time. Agents title, route, dedupe, and tidy afterward.
8. **Identity belongs to the org, not to Rowboat.** An org manages its own identity and membership with its own IdP. A Rowboat account is never required — BYOK users with no login collaborate fully.

Principles 1+2 make Harbor commodity infrastructure — easy to self-host, easy to trust — which is what makes principle 8 possible. The decisions compose.

---

## 3. Concepts

| Concept | What it is |
|---|---|
| **Org** | The tenant: a logical origin — a URL that speaks OAuth + the spaces protocol, owns its own identity and membership, and holds many spaces. An org is served by a deployment of Harbor (the open-source spaces server); one deployment may serve one org or many (§4), and clients cannot tell the difference. In everyday UI the org appears mostly as a badge and an address. |
| **Space** | The shared container: a directory of assets + one feed + members. The unit of sharing and the privacy boundary. A **direct message** is a space of kind `direct` — the same container with a fixed two-member roster, named by the other person (§5, added 2026-09-07). |
| **Member** | A person, identified by the org's IdP. Members act directly or through their agents; both are the member acting. |
| **Asset** | A file in the space: mergeable text rendered wiki-style (§5), or an uploaded binary (images render inline). One canonical live copy, held by the org — no per-user replicas. Its **path** is its product identity; storage keys on an internal id so moves never rewrite history (§6, the inode model). |
| **Change-set** | The atom of writing: an attributed, optionally-reasoned group of edits to an asset, applied against a known base version. Produced identically by human draft→apply, agent tool call, or scheduled automation. UI word: a **change**; the log renders as **history**. |
| **Feed** | The space's single conversation surface: ONE stream of root messages, flat threads behind reply chips, plus a rendered activity strand. |
| **Thread** | A flat reply chain under one stream message — pure structure, not an object: a write-once `threadRoot` pointer on each reply (annotation model, 2026-09-01). Born by replying, no ceremony, never nested. |
| **Topic** | The deliberate conversation object: one row ANNOTATING a thread's root with a stated goal (title) and an archived flag. It contains no messages — removing it loses nothing, archiving it hides nothing. UI word: a **Discussion** (label may drift; the wire keeps `Topic`). A thread whose annotation accumulates agent work is structurally the same object as a session. |
| **@rowboat** | The universal agent name. In any space, `@rowboat` always resolves to *the speaker's own* agent. The grammar makes commanding someone else's compute unexpressible. |

Mental model for the stack, top to bottom: **orgs** (own identity) → **spaces** (own membership) → **change-set log** (owns truth) → **edges** (own compute). Each layer's authority is exclusive.

The user-facing analogy: orgs are like mail accounts, spaces are like shared folders on them. Add an org, sign in, its spaces appear.

---

## 4. Orgs and identity

### The org contract — **Decided** (amended 2026-08-18: auth requirements tiered)

An org is any origin that:

1. Is addressable by URL (its **address**, e.g. `acme.rowboat.space` or a custom domain).
2. Meets the **auth interop floor** below.
3. Implements the spaces protocol (§9): one core, two faces — REST + live stream for rendering, MCP for agents.

Whether the org is backed by a dedicated deployment or is one tenant of a multi-org deployment (see *Deployment and tenancy*, below) is deliberately invisible to clients — the contract is the same either way.

**The auth contract mandates interoperability shape; organizational policy stays with the org** — the same stance the rest of the spec takes (invite caps are "org policy may cap or ignore"; §6 is convention-over-enforcement). Earlier drafts said "MUST support Dynamic Client Registration"; that over-mandated — the MCP authorization spec itself makes discovery MUST but DCR only SHOULD, and an enterprise whose security team requires allowlisted clients must still be a conforming org.

**MUST — the interop floor (no opt-out):**

- **Discovery is mechanical**: the org serves OAuth protected-resource metadata (RFC 9728) naming its authorization server, and that AS serves standard metadata (RFC 8414). Without discovery nothing can *find* the dance — structure is mechanical, never conventional. Note the composition: the org itself is only ever a **resource server**; the authorization server behind it is pluggable (Supabase Auth, Keycloak, corporate IdP, anything conforming).
- **OAuth 2.1 authorization-code flow with PKCE (S256)** — the security floor; no legitimate reason to disable.
- Standard **bearer-token validation**: the org pins its AS's issuer, verifies signatures offline via JWKS, and maps (issuer, subject) to a member. **Authorization is always the org's membership check** — the token proves *who*, membership decides *what*. (Spike-verified 2026-08-18: shared AS realms — e.g. one Supabase project serving many managed orgs — cannot audience-bind tokens per org, so membership is the boundary by design, not by fallback; a dedicated per-org AS realm adds cryptographic isolation on top, which is the enterprise shape.)

**SHOULD / org policy — knobs, each with its consequence named:**

- **Dynamic Client Registration (RFC 7591): SHOULD** — on, gated (registration requires approval), or off, per org policy. DCR-on is what makes "any agent is your member's edge" frictionless. DCR-off means clients need pre-registered IDs: the org admin registers the Rowboat app once, and a member's *foreign* agent needs admin blessing before it can join the dance — the "any agent" property deliberately degrades to "any *approved* agent." Clients MUST handle DCR's absence gracefully, and the app surfaces it honestly ("this org requires client approval"), never as a cryptic failure.
- **Refresh tokens: SHOULD** — required in practice for automations (§8), which act while no browser is open. An org MAY restrict or shorten them, accepting the named consequence: scheduled pushes and housekeeping crons degrade to the visible "org needs re-login" state instead of running unattended.
- Client allowlists, token/session lifetimes, membership policy, domain rules, which IdP (Supabase, Auth0, Okta, Rowboat accounts, anything), enterprise lockdown — all org-side, all invisible to the protocol.

This tiering is deliberately aligned with the MCP remote-server authorization spec — not a coincidence (§9): Rowboat already implements this dance for MCP servers, and an org's agent face *is* an MCP server.

### Deployment shapes — **Decided**

Three shapes, one protocol; the client cannot tell them apart:

- **Rowboat-managed**: cloud orgs on our multi-tenant fleet, spun up Slack-style — create an org, add your identity config, done. This is the flagship that makes "create a space" a five-minute experience.
- **Self-hosted**: the same Harbor deployed anywhere (an EC2 box, a homelab).
- **Enterprise**: self-hosted behind a VPN with corporate SSO. The enterprise story costs no extra product work because auth was pushed to the party that already solved it.

### Adding an org, joining a space — **Decided** (flow) / **Latitude** (mechanics)

- **Add an org**: paste/open its address in Rowboat → OAuth journey (in-app browser or system browser) → tokens stored in the OS keychain (as GitHub/ChatGPT tokens are today) → the org's spaces appear.
- **Join a space**: the protocol defines a standard **invite link** shape. Opening one triggers: resolve the org → OAuth if not yet signed in → membership per org policy → the space appears. The ceremony must be identical regardless of the IdP behind it; if every org joins differently, the product feels broken. In practice the invite link is the phrase people share — the tenant noun rarely needs to be spoken.
- **Session expiry**: org sessions will lapse. The failure mode must be visible and gentle (an "org needs re-login" surface, mail-client style) — never silently failing automations.

*Amended 2026-09-22 (open spaces, §5):* **you join the org.** An invite admits you to the org and to the spaces it lists, on top of the org's default spaces; every other open space you browse and join yourself; a private space you enter only when one of its members adds you or lists it on your invite. The ceremony above is unchanged — one link shape, one OAuth journey, one bind-time policy.

### Identity is namespaced per org — **Decided**

You are whoever the org's IdP says you are, per org. Mentions, member lists, and attribution are org-scoped. There is deliberately no global Rowboat-wide identity. The UI must present this honestly (org badges, org-scoped people-pickers) so it reads as a feature — the same way git remotes do.

### Invites: one shape, policy gates at bind — **Decided** (semantics) / **Latitude** (mechanics) *(added 2026-08-19)*

An invite is an **open bearer secret**. Possession plus a successful sign-in at the org's IdP is the whole claim; the sharing channel (a DM, an email, a WhatsApp group) is the security boundary, deliberately — this is the link people actually pass around. Acceptance binds to the authenticated **(issuer, subject)** — the cryptographic identity — creating the member (if new to the org) and the membership. Nothing downstream of binding ever depends on how the invite was gated. There are no per-token claim checks: **every bind-time condition is org policy, checked in one place at acceptance.**

**Domain rule — the v1 policy.** An org MAY restrict membership to IdP-verified email domains (e.g. `@acme.com`). Its payoff: a **standing open invite** (no expiry) under a domain rule is a safe de-facto public join link — anyone from the domain joins self-serve, everyone else bounces at bind. Policy shape is org-side and invisible to the protocol — it can grow (per-email exceptions, allowlists) with zero contract impact; only the refusal *state* is on the wire.

**Why gating lives at bind, not in tokens** (rationale, spike-verified 2026-08-18): an enterprise IdP gates at authentication — non-employees can't sign in at all. On a shared AS realm (the managed fleet), authentication admits anyone with an account; **bind-time policy and membership are the only boundary**. A per-person email-bound invite variant was considered and dropped: it duplicated the org-policy check inside the token shape; per-person binding remains available as an additive change if dogfood demands it.

**"Invite by email" is delivery UX, not a security artifact**: the admin types an address, the org creates an ordinary invite and delivers it there. Binding is untouched.

**Failure honesty**: a policy refusal is a resolvable, human-readable state — "this org admits only @acme.com accounts" — never a cryptic 401. Same stance as expired/revoked today.

**Wire impact** (lands as a contract PR): the accept path gains one distinguishable policy-refused state. Everything else — single-use vs. standing, expiry defaults, revocation UI, policy shape itself — is latitude or org-side.

*Amended 2026-09-22 (Slack parity — decided with §5 Open spaces):*
- **An invite is to the org, with an optional list of spaces.** Accepting creates the member (if new), joins the org's default spaces, and joins the listed ones. Today's per-space link is the case of an invite that lists one space; there is no second shape.
- **Any member may create an invite, by default** — Slack's default and the stance already above. The org knob is `members | admins`, admin-set. A "members request, admins approve" mode is Deferred (§12).
- **Listing a space on an invite requires being a member of it.** For a private space that is the whole rule; for an open space it is harmless (the person could self-join) and keeps the rule free of a kind check. The same rule governs adding an existing org member to a space (`addMembers`, §5).
- **Guests are Deferred with the shape settled:** a member flag that removes browsing, self-join, and the org-wide roster (a guest sees only people who share a space with them — the roster bound that was the default until 2026-09-22); only admins invite one. The browse gate is therefore "org member and not a guest", built with the flag's slot in mind and nothing reserved for it.

### Member profile — **Decided** *(added 2026-08-19; amended 2026-09-22: v1 field set, avatars, handle retired)*

- **`displayName`**: seeded from the IdP profile at first bind, editable by the member, org-scoped, **not unique, display-only**.
- **The invariant that matters**: attribution is keyed by member **id**, never by name — renames can never re-brand or spoof history. (Mirror of the existing rule: `agentName` is display-only, never an identity.)
- **Profile v1 = display name, title, avatar** *(2026-09-22)*. Title is the one Slack field a roster actually shows; pronouns and time zone are additive text columns whenever wanted (the cost is UI, not schema). One route to update your own profile and its agent-face twin. **Only you edit your profile in v1**; admin edits of others' profiles are Deferred (§12).
- **The avatar is an org-level blob at a Harbor URL, or absent** *(2026-09-22)*. Same content-addressed driver as space uploads, a second registry keyed by org, one upload route and one read route any org member may hit; image only, mime sniffed from the bytes, capped small, no server-side resizing (the client crops square, as Slack's does). A free-text avatar URL was rejected: it points every teammate's client at an arbitrary host — a tracking pixel aimed at the whole org — and IdP pictures hotlink-block and expire. Seeding the avatar from the IdP picture at bind (fetch once, store as an org blob) is Deferred (§12): a server-side fetch of a claimed URL wants its own small review.
- **No live frame for profile changes in v1.** The log is per space and a rename is an org fact; clients re-fetch the roster on listing sync, focus, and reconnect and label people by id from it, so a rename propagates within a session. Trigger for an org-wide signal: a stale name noticed in a live conversation.
- ~~**`handle`**~~ — **retired 2026-09-22.** Mentions shipped as id tokens through the picker (§7 Mentions, 2026-09-10), and name → id resolution for agents goes through the org-wide roster (§5), so the unique-handle field never became necessary. Nobody should build it.

### Roles: one admin bit — **Decided** *(added 2026-08-19)*

One org-level role: a member is an **admin** or not. The first admin is named at org provisioning (managed: the account that created the org; self-host: named in the `/internal` provisioning call). Admin powers are **membership and policy, never content**:

- create and revoke any invite; set invite policy (default: **any member may invite** to their spaces; policy may restrict to admins-only)
- set domain rules and other org knobs
- remove members (from a space, or from the org entirely); promote/demote admins — an org always keeps ≥1 admin
- register clients when DCR is gated/off (see the org contract above)

**The content plane stays role-flat**: within a space, every member writes equally — admins get no editorial superpowers. This is principle-bearing, not an omission (§2: membership *is* the trust decision; small trusted teams). Per-space roles (viewer/editor) are **Deferred** with a named revisit trigger: dogfood producing a real "this person should only read" need. IdP-level revocation (banning the account at the AS) is an operator act on the control plane, distinct from org-level removal — removal is the protocol-visible act.

*Added 2026-09-07:* **admins cannot read direct messages.** A DM is a space whose members are exactly its two participants; the content plane is role-flat and the access gate is membership, so there is no admin path into one — by construction, not by policy. Managed customers will ask; the answer is written here so nobody softens it in a support thread.

*Amended 2026-09-22 — the concrete list (Slack's defaults, decided with §5 Open spaces):*

**Admin-only, org level:** remove a member from the org; promote and demote admins (the org always keeps at least one); set invite policy, the domain rule, and the default-space flag; revoke any invite. **Admin-only, space level — membership acts, never content:** change a space's visibility; remove a member from any shared space (Slack's default; a member's own tool is *leave*, not *kick* — opening removal to all members is a Deferred knob, §12); archive, unarchive, and delete a space (§6, the deletion doctrine). **Never on a DM** — its membership is fixed and there is no admin path into one. **Any member:** create a space and choose its visibility at creation; rename (as today); invite under the org's policy; add existing members to spaces they are in; self-join open spaces; leave; everything on the content plane.

- **Org removal keeps the member row** with state `removed`: every membership goes, with a `removed` event on each space's log and the `space_removed` frame; the identity binding is severed so their token maps to no member. Re-inviting the same identity **reactivates the same row**, so attribution stays continuous. Everything they wrote stays, attributed, exactly as Slack keeps a deactivated account's history. The roster (§5) lists `active` members only.
- **Agents perform admin acts their member may.** Parity (§9): the role check is on the member, not the acting mode; every admin act is attributed with the mode, so the record shows it was the agent. Confirmation of a high-blast-radius act (org removal, delete) is the app's tool-approval step, not a Harbor carve-out that would make the agent face second-class.
- **Org facts have no log in v1.** A role change or an invite-policy change is a state change visible through the roster and org settings; its space-level consequences land on the space logs as events, which is what Slack shows in-channel. An org-level audit log is Deferred (§12; trigger: a compliance ask).

### Deployment and tenancy — **Decided**

An org is a **logical origin, not a machine**: internally a stable org record, externally one or more domain aliases (TLS/SNI at the edge; OAuth discovery documents generated per org). Three rules govern how the open-source service and the managed offering relate:

1. **One Harbor deployment serves many orgs.** A deployment serves 1..N org records, resolved from the HTTP `Host` header — each org with its own domain aliases, IdP config, and data namespace. The single-org configuration is the default self-host path and must stay one-domain-one-config-file simple. Multi-org mode is not a managed-only capability (an agency can run orgs for its clients); it is the same capability the managed fleet runs on — the Discourse-multisite / Zulip-realms precedent.
2. **One codebase, no managed fork.** The managed offering runs the unmodified open-source artifact, orchestrated by a closed **control plane** — an extension of the existing rowboatx-backend (which already owns Supabase identity, Stripe, plans, and the account/billing web app, and stores no user content). The control plane owns: the signup console ("create your org" in the existing Next.js app), org provisioning, per-plan limit setting, metering ingestion, and payment. Managed billing is flat seats/storage subscriptions — orgs run no AI, so the LLM credit/settlement machinery is never involved.
3. **Harbor never knows what money is.** The OSS repo has no concept of plans, payment, or Rowboat-the-company. It exposes **usage counters** (members, spaces, storage bytes) and accepts **limit knobs** (max members, max storage, retention) — neutral features any self-hoster wants. Managed behavior is composed entirely from counters + knobs + provisioning. Over-limit behavior is **read-only mode, never lockout**.

The admin surface follows the house API pattern: Harbor exposes `/internal/*` (bearer-key, server-to-server: org provisioning, limits, metrics) alongside the member-facing faces of §9; self-hosters use the same admin API for their own operations. It is control-plane-facing and sits outside the member-protocol stabilization promise.

**Flagship IdP:** Rowboat-managed orgs authenticate members with Rowboat accounts (the existing Supabase auth) as their IdP — one instance of the general contract, not a privileged path. A client already signed into a Rowboat account gets a near-one-click join on managed orgs; a free account is never a paid requirement. Self-hosted orgs bring their own IdP.

**Latitude:** where Harbor incubates (an open package in the rowboat monorepo, per house TS/Hono conventions, is the pragmatic start; extraction to `rowboatlabs/harbor` with a one-command self-host path when third-party hosting is announced).

---

## 5. The space

### Anatomy — **Decided**

A space is a **directory of assets + one feed + members**. Opening a space lands on two things side by side: the **README** (what this is) and the **feed** (what's happening). Everything else — inner files, other topics — is one click deeper.

The symmetry that makes the anatomy teachable: **README.md is to files what the feed is to chats** — the designated front door of its kind.

### The wiki model — **Decided**

Assets render GitHub-style: `README.md` loads first; **relative links navigate** to inner files; markdown renders rich with the existing viewer/editor. Any member can browse the directory and edit any text file directly.

This is not cosmetic. The wiki absorbs the team's *state* (roadmaps, decisions, briefs), which relieves the feed of being the team's memory — half the answer to chat chaos (§7).

**Latitude:** exact rendering details, file tree UI, non-markdown text file treatment. Binary assets/uploads — once Deferred here — shipped 2026-08-24 exactly on the pre-decided storage shape (§6); the design round the deferral was staged for was never needed. Relative links now resolve in messages too, not only inside the wiki: a relative markdown link in a message is a file link resolved from the space root, standard syntax on the wire, nothing for agents to special-case (recorded as a contract convention under the link grammar).

### One canonical copy — **Decided**

An asset has one live copy, held by the org. Members' Rowboats are windows onto it (the "Google Doc, not synced replicas" model). No vault-merging, no per-user forks. Shared assets are visually and structurally distinct from the private vault — a user must never wonder "is this note mine or ours?"

### Addressability — **Decided**

Spaces, assets, topics, and change-sets are all addressable by link. One link grammar works in wiki relative links, feed messages, activity rows, and cross-boundary mentions from private chats (§10).

*Amended 2026-09-14 (PRs #1054, #1055, #1059):* people are addressable too — a member link (`/u/<memberId>`) opens the DM with them, and a message link lands in its thread. A **file is addressed by its id**, never by its path (§6). Inside message text a person is a mention token and another space is a `#space` token, so a link into another space resolves from anywhere. The grammar and its one parser are recorded in [CONTRACT.md](./CONTRACT.md), decision 3.

### Direct messages — **Decided** *(added 2026-09-07)*

**A DM is a space.** Kind `direct`, between exactly two org members, on the same substrate as every other space — stream, flat threads, discussions, files, uploads, search, offsets, presence, unread, `@rowboat` sessions — nothing forked. Every mature chat system converged here (Slack's `im` conversation type, Discord DM channels, Mattermost direct channels, Matrix DM rooms); the ones that built DMs as a second object type rebuilt every feature twice. The alternatives were argued and rejected: a separate conversations object (parallel plumbing for every space-keyed path), and private asides *inside* a shared space (per-reader filtering of one offset log poisons replay, search, unread, and what an agent reading the stream sees — the space is the privacy boundary, §3).

- **Fixed membership, private forever.** Both participants hold ordinary membership rows (the access gate is unchanged); the org additionally keys the DM on its sorted participant pair, so two members can only ever have one and opening it is get-or-create from either side. No invites, no leaving; the two `joined` events are the whole membership history. **Any future path that opens spaces to non-members — browsing, self-join — MUST require kind `shared`.** Admins cannot read DMs (§4).
- **No invite, no acceptance.** The org is the trust boundary, as inside one Slack workspace: opening a DM puts the other person in it. They are told live by the protocol's first *member-addressed* frame (`space_added` — ephemeral, never replayed; the durable truth is on the new space's own log, which they could not have been subscribed to yet), their client refreshes its listing and subscribes from offset 0 so a first message that beat the subscription still notifies; offline, the next listing catches up.
- **Named by the other person.** The stored name is a placeholder; every surface labels a DM by the other participant's *current* display name from the DM's own roster (rename-safe, nothing to go stale). Notifications default to every message — a DM is addressed to you by construction.
- **Opt-in on both faces.** Listings return shared spaces unless asked for DMs (`includeDirect`), so a pre-DM client or skill never renders a DM as a space — additive on the wire, server deploys first, no same-day coupling. Agents see a member's DMs exactly as the member does, when they ask.
- **1:1 only in v1.** Group conversations are named spaces — spaces are cheap and already scoped, and the group-DM-vs-private-channel confusion is Slack's most famous UX debt. The participant-pair key extends to groups later if dogfood demands it. **Self-DM shipped 2026-09-08**, a day after the deferral: your own id opens a one-participant direct space — notes to self that live on the org, so every device sees them and your agent reaches them through the same face (`self: true` on `list_spaces`). It is also the landing spot the deferred personal-agent briefings never had. The private vault stays the local, one-machine store; the self-DM is the org-hosted one.
- **Files stay.** A DM with a shared scratch directory both agents can read is the "human A + agent A ↔ human B + agent B" pattern at its smallest — something Slack DMs cannot do. The UI leads with the conversation; files are one tab away.

*Why now, against the September frame ("stop competing with Slack at chat"):* DMs are why Slack stays open; the sidebar cannot be the team's home without them, and the PR-review relay example (§1) was itself a DM relay. The follow-on this conversation also settled — **open spaces** (org membership as a first-class thing; a `visibility` flag so any org member can list, read, and self-join an open space) — is what makes spaces feel as light as channels: today every space is a Slack *private* channel, and the per-space invite, not the URL, is the heaviness. Independent of DMs, additive, sequenced after them by decision.

### Open spaces and org membership — **Decided** *(direction 2026-09-07; shape 2026-09-22 — Slack parity, irrespective of what shipped first)*

Until 2026-09-22 every space was a Slack *private* channel: membership arrived only through a space-scoped invite, and the per-space invite — not the address — was what made spaces feel heavy. The model now:

- **Org membership is first-class.** You join the org (§4 Adding an org, amended); spaces are where you go once inside.
- **Spaces carry a visibility.** Any org member can list, read, and self-join an *open* space; joining puts it in the sidebar, the roster, and notifications (Discord's subscribe semantics, Slack's channel preview). Browse and self-join are routes on both faces.
- **The access gate widens once, in policy** — "a member of the space, *or* an org member (not a guest) and the space is open" — **and that path requires kind `shared`**: a direct message is private forever (above).
- **Additive on the wire**; then the client work that makes cross-pollination light: cross-space typeahead for people and files (shipped 2026-09-14 as tokens), in-app cards for links into other spaces, search across open spaces later.

**The six shape questions, answered 2026-09-22:**

1. **Representation — a `visibility` field, not a third kind.** `Space.visibility: private | open`, default `private`, on the wire and in the table; a schema CHECK pins a `direct` space to `private`, so the DM invariant lives in the schema and not only in a comment. Kind says what the container *is*; visibility says who may *find* it — a DM's identity (the participant-pair index) keys on kind, and changing visibility later is an ordinary space update with its own event, the shape of rename. A third enum value was rejected on the wire: the app parses every live frame with the protocol schema and `space_added` carries the kind, so a new value would break every older build on that frame; a defaulted field is invisible to them. `public` was rejected as the name — it suggests outside the org.
2. **Browsing grants read, everything readable; acting requires the membership row.** A browsing org member gets the stream, threads, topics, search, live delivery (subscribing is a read), the files with their history and diffs, and the roster. Every write refuses with `forbidden` and the message *join this space to post* (the client's cue for a Join button; no new error code on the wire). No per-member state until joined: no read cursor or unread badge, no follows, no notifications, no Activity rows — the notification decision already runs over the roster, so this falls out. **Self-join** (`joinSpace`, both faces) is allowed when the space is shared and open, creates the membership and appends the same `joined` event an accepted invite does, and is an idempotent no-op for a member. Read-and-post without joining was rejected: the roster becomes ambiguous (who is "in" the space for `@here`, the member list, replies), and auto-join-on-first-post is a hidden side effect where one click is not.
3. **Org invites — one shape, defaults only.** An invite is to the org with an optional list of spaces (§4 Invites, amended). **Default spaces are a flag on open spaces**: org join adds a membership to every default space, one `joined` event each; `general` is marked default at provisioning; admins toggle the flag; only an open space may be default (an org invite must not be a back door into a private one). **Joining the org joins the defaults, not every open space** — open spaces are one click away, and auto-joining all of them makes "open" mean "mandatory". `general` stays leaveable: Slack's un-leavable `#general` was considered and skipped (a refusal in the leave path plus an at-least-one-default invariant for a rule nobody has asked for; trigger: someone leaves it and the team notices).
4. **The roster is org-wide — a recorded reversal.** On 2026-09-09 `listOrgMembers` was bounded to shared membership so Spaces exposed no privacy surface beyond what a space already does. Org membership as a first-class thing reverses that, on the argument the DM decision already made: inside one org, the org is the trust boundary, as inside one Slack workspace. One list for everyone — id, display name, avatar, admin bit; no pagination in v1 (trigger: an org large enough to notice); admins see nothing members do not (admin powers are acts, not visibility). Anyone can DM anyone in the org. Mention pickers offer everyone, but **stamping stays space-scoped**: a mention of a non-member is dropped and does not notify, as today; the client shows *not in this space* on the token. The roster lists `active` members only; departed members stay resolvable for attribution (§4 Roles). The bounded query survives as the guest path (§4).
5. **Profiles** — decided in §4 Member profile: display name, title, avatar in v1; the avatar is an org-level blob at a Harbor URL; only you edit; the handle is retired.
6. **Admin scope** — decided in §4 Roles: the concrete list, member state `active | removed`, reactivation on re-bind, agents allowed, org audit log deferred; archive and delete in §6.

Two mechanics the removal path needs are in place *(2026-09-22)*: a member's write re-verifies access inside the space lock, so a write that lost a race to a removal is refused rather than landing after the departure; and a member-addressed `space_removed` frame ends live delivery for the space on every connection the member holds — `leaveSpace` sends it today, removal and delete will send it tomorrow. Removal itself is the delegated work.

---

## 6. The change-set log

The write substrate for all assets. This section is the heart of the spec. All **Decided** except where marked.

### The log

Each space carries an **append-only log of change-sets**. An asset's current content is the fold of its change-sets. The log is the single source of truth; the feed's activity strand (§7), each file's history view, and every diff are *projections of the same log* — nothing renders from a second source, nothing exists only in chat scrollback.

### The deletion doctrine — **Decided** *(2026-09-22; supersedes the amendment pending since 2026-08-26)*

**Append-only holds inside a living space, with two named exceptions.** Message deletion (shipped 2026-08-25, author-only) redacts the deleted body **inside the stored message event** — on the rule that *replay must never resurrect a deleted body*; the event keeps its offset and attribution, only the content blanks, and the tombstone (`deletedAt`) is what replays. Message editing (shipped 2026-08-26) is the second such rewrite, on the same rule — the superseded text must not resurface through replay. Nothing else edits a stored event. Files are never destroyed inside a living space: delete is a freeze (the inode model, below).

**At the space grain there are two admin acts, as in Slack, and neither exists for a DM:**

- **Archive is a space state.** An archived space refuses writes with a clear error, drops out of the sidebar, stays readable and searchable to its members, and — if open — still lists in the browser under archived. Unarchive flips it back. Two events on the space's own log. This is the act teams actually use, and the one to build first: it needs nothing new in storage.
- **Delete drops the space whole.** The space row goes and every row that hangs off it goes with it — the log, messages, files and their versions, memberships, read state, search rows. Blob bytes are removed only where no other space or org registry still references the same content. Every member gets the `space_removed` frame; links into the space from elsewhere go dead, as a Slack link to a deleted channel does. No undo, no grace period — Google-style trash (archived for a window, then purged) was considered and rejected for v1 as a third state plus a purge job. The client confirms by name.
- **Mechanism, decided with it:** every space-keyed table carries a **foreign key to `spaces` with cascade on delete**, so deletion is one statement rather than a hand-written sweep that a new table silently escapes. (This closes the foreign-keys question left open by the 2026-09-18 code review.)

Why this is not a conflict with the log's rule: the rule is about *history inside a space that exists* — nobody rewrites it. Removing the whole space is a different act at a different grain; Slack shows both can be true at once. Deactivating a person keeps everything they wrote (§4 Roles). Erasing a real person's data on request is an operator act outside the protocol, Deferred (§12).

### A change-set carries

- **Who**: the member, plus the acting mode — direct, via agent, via scheduled automation.
- **What**: the edits, applied against a declared base version of the asset.
- **Why** (optional): a commit-message-style reasoning line. Convention: agents essentially always attach one (they are already narrating; it is free). Humans may.

### Write paths — one mechanism, every writer

- **Humans: draft → preview → apply.** Editing happens in a draft state; the member sees what changed and applies deliberately. One apply = one change-set. If the underlying asset changed while drafting, the system says so and whether the draft still applies cleanly. No keystroke-level events; commits are deliberate, like a line edit or a save — a checkbox tick is a tiny change-set.
- **Agents: one tool call = one change-set.** The write tool **bundles read-before-write**: current content and recent history come with every write operation, so "the agent read the doc first" is mechanical fact, not hoped-for etiquette.
- **Automations: identical.** A housekeeping cron produces ordinary change-sets attributed "(via Rowboat, scheduled)". Nothing about housekeeping is special.

### Merge semantics

- Non-overlapping concurrent change-sets **auto-merge** (line-level three-way merge against the declared base).
- Overlapping ones surface a **conflict to the later writer**, who adjusts and re-applies (for agents: the tool returns the conflict; for humans: the draft view shows it). Merge-then-correct philosophy applies: surface and fix, don't lock and block.
- **Rejected:** document-level last-write-wins (destructive), and keystroke-level CRDT sync for v1 (character-level merges of prose produce text nobody wrote; live co-typing adds machinery without serving the deliberate-commit model).
- **Latitude:** the merge engine's implementation. An operational log + three-way merge satisfies v1. The change-set substrate deliberately does not foreclose a CRDT engine later if live co-editing (Deferred) is wanted.

### What falls out for free

Version history, per-line provenance ("git blame for the roadmap": click a line → the change-set that wrote it → its reasoning → the feed moment it landed), diffs between any versions, and time-travel to any version. These are views of the log, not features built beside it.

### Namespace operations: the inode model — **Decided** *(added 2026-08-26)*

Move/rename, delete, and restore shipped (2026-08-25) with an identity architecture argued from first principles and a survey of how MediaWiki, Obsidian, Notion, and Drive handle renamed and deleted paths: **the path stays the product's and the wire's identity; storage keys on an internal per-asset id that never leaves the server.** Consequences, each load-bearing:

- **Ops are property updates.** A move or delete appends one attributed, op-tagged change-set with versions unchanged — **only content edits bump versions**. History and bytes never relocate; per-file history is an id filter, not a chain walk.
- **Moves follow the propose discipline**: declared base; stale = conflict bundle; occupied destination = refused, never overwritten. The old path keeps a **redirect** — reads answer with the file's current path (the client's re-point signal), stale proposes refuse with a pointer to where the file went, and a fresh create claims the vacant lot as a new lineage.
- **Delete is a freeze, not a shredder.** The file keeps its full history, lists under a trash view, and restores while its path is free. **A deleted path never blocks re-creation** — uniform vacancy; a tombstone-blocks-the-name rule was designed, challenged, and rejected as hostile (no surveyed system does it).
- **Agents move and delete through the agent face (reason required); restore is deliberately human-only for now.**

*Amended 2026-09-14 (asset ids are the identity — PR #1054; supersedes "the path stays the product's and the wire's identity" above):* the internal id **is** the identity on the wire — every operation, every link, and a discussion's document pointer address a file by `assetId`, the way a Google Doc is addressed by its id. The **path is a display property**: the tree's label, unique among living files, named at birth by `createAsset` and changed by `moveAsset`. Redirects are gone — a move changes nothing an address depends on. The restore-is-human-only clause is superseded too: `restore_asset` reached the agent face 2026-09-09 (parity, §9). Wire detail: [CONTRACT.md](./CONTRACT.md), decision 1.

Folders remain pure key prefixes — creating `a/b.md` is what creates `a/`; there is no folder object anywhere in the system.

### Storage architecture — **Decided** (shape) / **Deferred** (binary feature work)

How log and content are physically held. Decided against a survey of ~20 comparable systems (wikis, doc products, sync/CRDT backends — 2026-08-17); the shape below is the industry consensus, adopted deliberately.

**Merges happen at write time; reads never assemble.** When a change-set applies, the org runs the merge *then* and stores the complete resulting content as the new version. Every version is a full materialized snapshot; reading any version — current or historical — is one fetch. The log is provenance (who/why/when, the feed, blame), never an ingredient of a read. Precedent: every production wiki stores full content per revision (MediaWiki, Confluence, Outline, BookStack); op-log systems (Google Docs, Etherpad, Automerge/Yjs) all bolt on checkpoint/compaction machinery to bound replay — machinery the deliberate-commit model never needs. Obsidian Sync, the closest analog, is exactly this shape: per-file snapshots, merge at write, one fetch on read.

**Mergeable text lives inline in the org's transactional database** (Postgres), committing in the same transaction as the log rows. Load-bearing, not incidental: the three-way merge reads base + current under the space lock; a conflict returns current content in one round trip; history, blame, and full-text search compute over text where it sits *(the "later" arrived 2026-09-02, PR #946: generated `tsvector` columns + GIN on message bodies and topic titles — tombstones and edits reindex in the same transaction, by construction — plus a derived extraction table for asset text, written in the same transaction as the version row; deliberately Postgres FTS, not a second search system)*. No two-store saga on the write path — search included.

**Binary and large assets go to a content-addressed blob store.** Decided as shape first; shipped as feature 2026-08-24, on exactly this shape:

- Bytes are keyed by sha256 and stored outside the database, behind a **blob-store interface Harbor owns** — immutability + hash keys shrink it to roughly `put/get/has/delete(hash)`, so any object storage can implement it. Two drivers ship: a plain directory for self-hosted single-node (the one-`docker-compose` story holds) and S3-compatible object storage (which MinIO, R2, B2, GCS-interop all speak) for managed deployments (presigned uploads, CDN). Not an AWS commitment — the interface is the contract, S3-compatible is just the broadest second driver. Git's object model, verbatim.
- Version rows in the database carry `{hash, size, mime}` — same tables, same attributed change-sets, same feed and history. **One namespace, one log**: `design.pdf` sits beside `README.md`; only the populated column differs.
- Hash-keying buys immutability (matches the append-only log), idempotent retry-safe uploads, dedup, integrity a client can verify (matters for federation), and cache-forever semantics. Dedup scope is **per org**, never global — existence checks must not leak "someone on this deployment already has this file" across tenants.
- **Binary staleness never merges.** A stale replace surfaces as conflict-or-replace; there is nothing to three-way-merge in a JPEG.

*Amended 2026-08-24/25 (the feature landed; settled semantics):* upload is **two-phase** — put the bytes (sha256-addressed; the org recomputes the hash), then reference the hash from a message body or a binary propose. **The org's sniff of the bytes is the authoritative fact about them**: mime from magic bytes (a client's declared type is a fallback, never a fact) and — same posture — **image pixel dimensions**, parsed from header bytes at upload and carried as display metadata so clients reserve exact layout before the bytes arrive (the Slack/Discord placement; blob links may also carry them as display-only query params beside the filename, the nostr-`imeta` idea). **Serving is where safety lives**, not upload gating: no type restrictions at upload, only sniffed images serve inline, everything else is forced attachment + nosniff — a stored HTML file can never execute in a browsing context (Buzz's stored-XSS posture, ported). Blob readability is space-scoped; byte dedup underneath is per org, never global.

**The boundary is mergeable-document vs. attachment, not text vs. binary.** Inline means: participates in the substrate — line merge, diffs, blame, agents reading it into context. That is text up to the inline cap (1MB ≈ 500 pages of prose; real docs run 5–50KB). A 200MB CSV is text but not collaborative text: it takes the blob path. Over-cap or non-UTF-8 proposals are rejected with "attach this instead" — explicit, never silently spilled.

**Future decisions, named but not taken** (see §12): cold-history compression/tiering, version retention policy, blob GC. Each has a known industry answer waiting; none changes the read path or the logical model above.

### Substrate considered and rejected: Nostr — **Decided** *(recorded 2026-08-25)*

Asked directly (and worth answering in-repo, so the absence reads as a decision): should the wire have been Nostr events over a relay, the way buzz builds its workspace? No — three structural mismatches, each fatal alone:

1. **Our server must think about content; a relay must not.** The core primitive here is the attributed three-way merge under the space lock — the org computes and stores content nobody's client signed. Nostr's entire value is client-signed immutable events verified without trusting the relay; either the relay mints events (destroying that value) or merge moves client-side (destroying write atomicity — the concurrent-agents race the lock exists to serialize). The constitution's split is precise: the hub never thinks about *agency*, but it is **required** to think about *content*. A Nostr relay is forbidden both.
2. **Ordering.** Replay, resume, and the feed-as-projection all rest on server-assigned per-space monotonic offsets. Nostr has client-set `created_at` — skewable, unordered, no gap-free replay. Every Nostr system needing real order (buzz included) bolts on custom relay behavior, i.e. a bespoke server dressed in Nostr framing.
3. **Identity and access.** Members here are org-scoped OIDC identities — invite-bind, email-domain policy, admin revocation, IdP-swappable without rewriting history. Nostr identity is a keypair the human custodies forever (lose = gone, leak = impersonated — the ecosystem's defining UX failure), and relays are public-read by default; membership gating means NIP-42 plus custom ACLs — the bespoke server again, minus the interop payoff (generic clients can't read private spaces, and our objects have no Nostr kind).

Buzz chose Nostr because its *product thesis* is Nostr's thesis — sovereignty, agents as first-class keypairs, a relay you own. Ours is a trusted org inside a named boundary: bytes, not brains. The right relationship to that ecosystem is the one already practiced: port the patterns (content-addressed blobs, upload-then-reference, address-vs-cite scanning, attachment+nosniff serving), never the substrate. If federation ever becomes the bet, signing **our** events is a small step from an append-only log of typed facts + content-addressed blobs; adopting Nostr's worldview today buys none of that and costs the merge model.

---

## 7. The feed

### Topic-first, friction-free — **Decided**

One feed per space. The feed is a list of **topics**; conversation lives inside them. The top level reads like an inbox of titles, not a scrollback.

- **Zero ceremony**: typing a message creates a topic; the first message *is* the title. No required fields, ever (principle 7).
- **Agents maintain the structure**: retitling, suggesting "this belongs in the existing topic," merging duplicates, archiving stale topics — via ordinary attributed tools, by convention and by the DRI's housekeeping automation. Topic-first models (Zulip-style) famously work but demand human discipline; here the discipline is mechanized.
- **Spaces are the channels.** There is no multi-channel structure inside a space. If one feed wants to become two standing streams, that is usually two spaces — spaces are cheap and already scoped. This kills channel proliferation at the root.

*Amended 2026-08-21 (recorded 2026-08-26) — surface vs. substrate:* after team dogfood pushback ("be exactly like Slack"), the shipped **surface** is a free message stream with optional break-out threads — Slack ergonomics — while **topics stay the substrate**: every conversation unit is still an addressable topic (agent sessions, presence, receipts, and doc anchoring all key on them), and a thread is a topic anchored to the message it grew from. `anchorMessageId` is **provenance, not hierarchy** — clients render a flat topic list with breadcrumbs, never trees, and the org enforces one general stream per space and one topic per message. The original "inbox of titles" reading above describes the substrate's shape, not the shipped surface. One more surface rule settled in dogfood (2026-08-25): a reply gesture creates **nothing** until the first reply is actually sent — an abandoned reply pane must leave no topic behind. Reads over the feed are **windowed** (newest page first; the space's monotonic offsets are the cursor) — full-history reads no longer exist on the wire.

*Amended 2026-09-01 — the annotation model (supersedes the container mechanics above; the Slack surface stays):* dogfooding proved the topic-as-container substrate wrong at the root. Every reply minted a container and the first line became its title, so the rail was a log of interaction mechanics, not intentions — 21 accidents, zero renamed, unnavigable; meanwhile "Archived topics disappear!" was structural, not a bug: messages lived *inside* an archivable object. The model is now inverted (Harbor migration 011, PR #944; proposal doc: "One Stream, Topics as Annotations"):

- **One stream per space; a reply is a write-once `threadRoot` pointer on the message.** A thread is not a row anywhere — it is "all messages whose `threadRoot` = X". Flat by shape (the pointer always names a ROOT; the org normalizes reply-of-reply, Slack-style). The seeded general topic is gone; the stream is not an object.
- **A topic is one annotation row pointing at a thread's root**: title (a stated goal — the one deliberate ceremony) + archived. It holds no messages, so the founding failure is impossible by construction: archiving flips one field, and `remove` ("convert back to thread") deletes the row while the conversation stays in the stream untouched. At most one topic per root. UI word: **Discussion**.
- **Five verbs, five one-row ops** — create (promote an existing thread, or post-and-annotate in one step: nothing is ever born outside the stream), retitle, archive, unarchive, remove — for humans and agents alike, each narrated on the log with its actor. **Archive is the whole v1 lifecycle** (resolve-with-outcome deferred; status is stored extensibly). **Gmail revive rule**: a new reply to an archived topic un-archives it.
- **Durable identity keys on `(space, threadRoot)`, never the topic row** — agent sessions, presence scopes, unread marks, and change-set provenance (`threadRootId`; reason suffix `· thread:<root>`) all anchor on the permanent root message, so annotations are disposable and downgrade → re-promote round-trips losslessly. `anchorMessageId` and `Topic.kind` left the contract; reply-to-activity-row provenance rides the root message (`anchorChangeSetId`).
- **Reply denorm on roots** (`replyCount`, `lastReplyAt`) makes every listing's chip a direct read; the stream and each thread window identically (newest page first, offsets as cursor).
- **Thread membership is immutable, permanently** — `threadRoot` is write-once, so split/merge does not exist (`merge_into` retired); the sanctioned answer is spin-off: start a new root, link back. The "agents maintain the structure" bullet above now operates on annotations (title/archive/remove via `manage_topic`), never on messages.
- **Rationale recorded:** per-message human curation (a labels layer was proposed and rejected) is the graveyard of collaboration tooling — effort-now, payoff-diffuse; the evidence was our own rail. The one gesture humans reliably perform is closure with immediate payoff, so the rail lists only deliberate goals and empties as they archive. This is the convention→contract ladder running in reverse for once: the 2026-08-21 promotion encoded the wrong convention, and the annotation model replaces it wholesale.

### The activity strand — **Decided**

Change-sets render into the feed as **activity rows**: visually distinct from human talk, grouped ("5 changes · Gagan (via Rowboat) · `roadmap.md`"), collapsed by default, linking to diffs. A filter toggles **All / Talk / Activity**.

- Agents do not *write* announcement messages; **the feed renders the log**. Narration is automatic because it is a view — nobody remembers a convention, nobody can spam with it.
- **The Activity filter is the space-level changelog.** There is no separate changelog surface; a separate one would either duplicate this strand or drift from it.
- **Activity rows are discussable**: replying to one creates a topic *anchored to that change-set* — "why did SSO drop to P2?" hangs off the change that dropped it, diff and reasoning in hand. Talk and record stay cross-referenced with no one maintaining the references.
- **Digest thresholds** — **Latitude**: agent change-sets with reasoning surface prominently in the default view; human micro-edits fold into quiet grouped rows or appear only under Activity. The record never depends on the threshold; tune it freely.

### Agent turns in topics — **Decided** (v1 shape)

A topic where an agent works holds its turns, **collapsed by default** (summary line; expand to the full turn view the app already renders everywhere). A thread and a session are the same object at different sizes: v1 ships feed+threads only; "promote a heavy thread to a named session" (**Deferred**) requires no schema change later.

### Read state — **Decided** *(added 2026-09-09)*

The org owns read state, per member, in **offsets**. Every mature chat system keeps the cursor server-side per user per conversation (Slack `last_read`, Discord read states, Mattermost channel members, Matrix receipts, Telegram `read_inbox_max_id`, Google Chat read states); none computes unread on the client from loaded history, and every one with a monotonic id uses it as the cursor rather than a timestamp. Harbor already has the ideal cursor — the space's event offset (§6) — and the annotation model keys thread identity on the root, so:

- **One stream mark per space, one mark per followed thread** (the Mattermost `ThreadMembership` / Matrix threaded-receipt shape). Marks only advance. A thread nobody follows has no read state — **v1 tracks followed threads only**; what constitutes following is org behaviour, not client convention (provisional rules: replying follows, and a root's author follows from its first reply on). *Amended 2026-09-11:* a thread takes a mark whether or not the member follows it — reading is what clears an Activity row; following governs badges, counts, and notifications.
- **Posting reads.** A direct post advances the author's own mark to it (Slack/Mattermost); an agent's post does not — your Rowboat working at 3am must not read as you having seen the room.
- **Two numbers ride the cursor**: unread roots per space and unread replies per followed thread, both computed by the org, excluding the member's own messages and tombstones. Mention counts arrive with server-stamped mentions (the next layer).
- **Marks are private, not log facts.** They never enter the space's log — nobody else's replay should carry your reading — so the member's other connections learn by an ephemeral member-addressed frame, and a reconnecting client refetches the snapshot. The Matrix private-receipt posture.
- **Client obligations**: mark the newest root actually displayed, never head (Slack's rule); send marks debounced; fold live frames onto the last snapshot; badges need no history loaded.
- **The badge** *(decided 2026-09-10, Ramnique's design, from a live mock sheet)*: a **dot and a figure** on every row with anything unread, no fill. A grey dot means nothing here is for you and the figure is the unread count; a red dot — the one red in Spaces — means the figure is how many are for you (mentions, or every message in a DM); hover gives both; the name bolds when unread. Not Slack's red pill by intent. Discussions badge the same way: with the space expanded, its row carries only the stream's share and each followed discussion its own replies; collapsed, the row sums them. A discussion you don't follow shows nothing — the followed-only rule made visible.

### Mentions — **Decided** *(added 2026-09-10)*

A mention is a **link token whose href carries the member id and whose label is a hint**: `[@Ramnique Singh](#member:<memberId>)`. The fixed addresses are tokens too — `[@here](#here)`, `[@rowboat](#rowboat)` — because an address is something a composer emitted deliberately, never a word that happened to be in prose (Slack's `<!here>`, Zulip's `@**all**`, Teams' entities; Matrix moved from body-matching to structured mentions for the same reason). Consequences, all load-bearing:

- **One grammar, one parser.** The protocol package owns the token grammar; every regex that used to turn names into ids or ids into names — on send, on render, in the watcher, in push, in search — is gone. Names are not unique (`displayName` is display-only) and were never a safe key.
- **The org stamps who a message addresses**, at post and edit, from tokens alone, keeping only ids that are members of the space. Unread counts, push, the chip, and later Activity read the stamp; nothing re-parses text. A bare `@Name` or `@id` is prose and reaches nobody — including in a voice transcript.
- **Labels are re-resolved from the roster** wherever a person reads: renames never touch stored text, two members with the same name cannot collide, and the agent face rewrites labels before a body reaches a model, so a stale or spoofed label is never trusted.
- **A mention follows you into its thread** — the third follow rule beside replying and being the root's author; `@here` follows nobody.
- **The pre-token spelling was rewritten once**, through the ordinary edit path as the author (dogfood decision: the "(edited)" mark is accepted), so exactly one spelling exists anywhere.

The client-side notification-level module that predated this (a per-install scanner with all/mentions/mute levels and do-not-disturb) was removed the same day so nothing here inherits it; notification policy returns server-centric, on top of these cursors, in a later layer. §13 open question 4 stays open until then. Wire and storage shapes: `apps/harbor/CONTRACT.md` (read-state bullet), migration 016 (015 is the push tables from PR #998).

### Notifications — **Decided** (delivery) / **Open** (policy) *(added 2026-09-10)*

**The org decides, once; every surface only shows.** After a message commits, the org decides for each member of the space whether and why they should hear about it, and the same decision reaches every connection the member holds — desktops as an ephemeral `notify` frame on the member channel, phones as a push. This is Slack's shape (the server emits a `desktop_notification` beside the message) rather than Mattermost's, Discord's or Zulip's (the server ships the facts, each client applies its own preferences), for two reasons that are ours: a phone and a desktop must never disagree, and the policy that will gate these decisions (levels, quiet hours, active-elsewhere suppression) belongs to the org, where a second device can see it — the per-install module removed on 2026-09-09 is exactly what "client decides" grows into.

- **Reasons the org can decide today**, in priority: `mention` (a token named you), `here`, `dm` (the space is direct), `reply` (a thread you follow). All read off the stamp and the follow rows — never the text. A plain message is not a reason; only a phone's `all` level wants it.
- **Who is left out:** the author of their own direct post. An agent's post is the agent's act, so your own agent addressing you reaches you — the same symmetry read state keeps (an agent's post never advances your mark).
- **The org renders the text** (names resolved from the roster, tokens flattened, a short excerpt) so a toast and a banner read identically; clients add nothing. The desktop shows it only while the app is in the background, links to the space or thread, and keeps no policy of its own.
- **Never replayed.** A closed desktop catches up from badges, a phone from push. A missed toast is not a lost fact — the Activity inbox (next layer) makes the same decision durable, with these reasons as its rows.
- **Open (§13 question 4, narrowed):** per-space levels and mutes, quiet hours, suppression when you are active on another device (presence is already in the hub), `@channel`, mentions added by edit. All org-side, all on top of this decision function — none change the frame.

Wire shape: [CONTRACT.md](./CONTRACT.md) — the notifications and push bullets.

### Activity — **Decided** *(added 2026-09-10; amended 2026-09-11, 2026-09-15)*

Everything that involves a member across every space and DM they are in, newest first, is a **query over facts the org already keeps** — the stamped mentions, the follow rows, the DM kind, the reactions — never an inbox table fanned out on write. Slack, Discord, and GitHub materialize; Zulip's Mentions and Inbox views query, and at per-org scale so do we: edits, deletes, and backfills stay consistent for free, and the read marks remain the one source of truth for unread. A message resolves to one kind by priority — mention > here > dm > reply in a followed thread; reactions fold per (message, emoji) with reactors newest first; the member's own posts never appear.

- **Mark everything read** *(2026-09-11)* moves the same marks single reads move — every space to its head, every thread holding an Activity row to its newest reply — so Activity, the badges, and every device agree afterwards. Never a watermark on the feed alone.
- **Reactions read by the conversation cursor** *(2026-09-15)*: viewing the chips on your message advances that conversation's mark; merely opening Activity acknowledges nothing.
- **Deliberately absent:** "added you to a space" — no durable fact records who added whom (`Membership` has no `by`); it arrives with that fact (§5, open spaces).

Wire and storage: [CONTRACT.md](./CONTRACT.md), the Activity bullet.

---

## 8. Agents in spaces

### The grammar — **Decided**

- **`@rowboat` always means the speaker's own agent** — one name, per-person resolution, everywhere in the product. The rule "only you command your compute" is thereby enforced by grammar: the sentence addressing someone else's agent cannot be formed.
- **Agents are silent by default.** An agent speaks in a space only when (a) its person addressed it, or (b) it is running an automation its person owns. (Edit announcements are not speech — they are the rendered log.) Humans talking to humans never trip an agent response.
- **Cross-person requests are social.** "Can someone's agent pull the SSO numbers?" is a message to *people*; a person answers it by instructing their own `@rowboat`. V1 needs zero machinery for this — asking a human in chat already works. (UI sugar — an "Assign to my Rowboat" CTA rendered on the *recipient's* screen, so the command still originates from the owner — is **Deferred**.)

### Where agents run — **Decided**

On their member's machine, always (principles 1–2). Consequences, accepted knowingly:

- **Availability**: automations run when their owner's machine is awake; missed crons run on next wake (existing local-cron semantics). Fine at dogfood scale. The escape hatch that preserves the model: a headless Rowboat added as an ordinary member — still an edge, just server-shaped (**Deferred**; design nothing that assumes it, foreclose nothing).
- **Liveness**: "agent is working…" depends on the addressed member's machine. Should be visible (presence for agents as well as humans — **Latitude** on granularity).

### The seam: private context → shared space — **Decided**

Members push from private context (meeting notes, emails, chats) into a space **explicitly** — "add this to the Roadboard." What crosses the boundary is an **agent-authored summary written for the room**, never pasted private content; the resulting change-set appears in the feed where the pusher sees exactly what crossed and can correct it. The privacy control at the seam is **visibility, not gating** — no approval dialogs (principle 6). Standing subscriptions ("auto-propose roadmap-relevant items from my inbox") are **Deferred** — they are the magic version, and they wait until explicit push proves the loop.

### Coordination is social — **Decided**

- **DRI pattern**: housekeeping (dedupe, prune shipped items, normalize format, archive stale topics) is a member's local scheduled task pointed at shared assets. One person takes charge, or several — the system doesn't referee.
- **First-pusher-wins**: five people captured the same standup; whoever pushes first sets the baseline, and later agents' bundled read-before-write makes them add only deltas. Redundant-observer dedup is a social problem the system declines to solve.

---

## 9. API surface: one core, two faces

### Architecture — **Decided**

Harbor is **one core service layer with two protocol faces**, exposed per org. The core owns the real operations — apply change-set, read asset with history, post message, list topics, membership. The faces are *sibling projections of the core*, never wrappers around each other (HTTP-wrapping-HTTP adds a hop and lets the faces drift; siblings over one core cannot):

- **Render face** — REST + a live event stream, for human clients and renderers.
- **Agent face** — an **MCP server**, the canonical interface for every agent.

An agent holds no credentials of its own; both faces authenticate with the member's OAuth token, and attribution (member + acting mode: direct / via agent / scheduled) is a parameter of the core operations. **The change-set log neither knows nor cares which face an operation entered through.**

### Core operations every org must expose — **Decided** (capabilities) / **Latitude** (shapes, names)

| Area | Capabilities |
|---|---|
| **Auth** | OAuth discovery metadata, DCR, PKCE authorization, token refresh. |
| **Spaces** | List my spaces; create (per org policy, choosing visibility); resolve an invite link; read membership; leave. *Amended 2026-09-22:* browse open spaces; join; add members; admin acts — change visibility, remove a member, archive/unarchive, delete. |
| **Org** *(added 2026-09-22)* | The org-wide roster; my profile (name, title, avatar); invites to the org; org settings — invite policy, domain rule, default spaces, roles; remove a member from the org (admin). |
| **Assets** | List directory; read asset (content + current version); **propose change-set** (base version, edits, optional reasoning, acting mode) → applied \| merged \| conflict; read history; read diff between versions; read version. |
| **Feed** | List topics (with activity strand data); read a topic; post a message; create topic (implicitly, by posting); edit/retitle/archive/merge topics (the tidying operations). |
| **Live** | An event stream per space (WebSocket or SSE): new change-sets, new messages, topic changes, presence. This is part of the protocol, not a deployment implementation detail — clients render live from it. |
| **Admin** | `/internal/*`, bearer-key, server-to-server (§4 Deployment and tenancy): org provisioning, limit knobs, usage counters. Control-plane-facing; outside the member-protocol stabilization promise. |

### The render face

REST + WS/SSE, shaped for a reactive UI: pagination, caching/ETags, typed structured responses, diffs, unread state, presence. This face exists because a live UI's needs are not tool calls — MCP payloads are shaped for a model's context window, not for a renderer to bind to. **Latitude** on all endpoint shapes; this face stays unstable the longest since Rowboat controls all its clients.

### Liveness — **Decided** *(added 2026-08-25)*

A half-open TCP socket (laptop sleep, a network change, a proxy dying without FIN) reports OPEN forever on a read-only connection, and browser-style WebSocket clients expose no ping — so liveness is protocol doctrine, not a deployment detail. The org sends a **ping frame** to every connection (~25s), alongside protocol-level pings that reap dead clients server-side. Clients treat **any received frame as proof of life**, tolerate unknown frame kinds, and on prolonged frame-silence **bounce the socket and resume with offset replay**. A client that skips the watchdog silently loses messages; this is the one obligation the live face places on every client.

### The agent face — **Decided**

The MCP server's tools are direct projections of the core operations — indicative set (annotation model 2026-09-01; `search_space` replaced `search_feed` 2026-09-02): `read_asset` (content + recent history bundled), `propose_change` (requires base version; returns content + history on conflict), `read_stream` / `read_thread` (windowed; truncation stated, never silent), `post_message` (a root or a flat reply — never a container), `list_topics` / `create_topic` / `manage_topic` (the annotation verbs), `search_space` (one search across messages, topic titles, and files — by content or name — returned categorized; message hits name the thread they live in, asset hits the path; query words AND-ed, a member's name also matches their @-mentions). Two properties are load-bearing:

- **Semantics live in the tool design.** Read-before-write bundling and conflict-and-retry are properties of the tools themselves, so *any* well-behaved agent gets them for free — they are not client-side etiquette Rowboat adds.
- **Truncation is stated, never silent** *(added 2026-08-25)*. Topic reads are windowed (newest first; offsets as the cursor); when older messages exist, the tool says so and how to page back — an agent summarizing a discussion is never quietly handed a fragment.
- **Direct messages ride this face unchanged** *(added 2026-09-07)*. `list_spaces {includeDirect}` returns a member's DMs with `kind: "direct"` and their `participants`; every other tool takes the DM's space id like any space. Off by default so a pre-DM skill never mistakes a DM for a space. An agent sees exactly what its member sees — nothing more, nothing less.
- **Any agent can be a member's edge.** The constitutional model says every agent is some member's edge — nothing says the edge must be Rowboat. Claude Code, Codex, or a custom stack joins a space as its person: MCP URL + the OAuth dance. This is deliberate: the org contract (§4) is verbatim the MCP remote-server authorization spec, so from an agent's seat, an org simply *is* a remote MCP server. The collaboration substrate is agent-vendor-neutral by construction.

- **Parity** *(added 2026-09-09)*: the agent face projects **every** member operation the render face has — DMs, space lifecycle, invites, message edit/delete/react, polls, file restore, history, diff, versioned reads. An agent acting for a member can do whatever that member can; attribution records how it happened, never who else. Guidance about *when* an agent should act lives in the agent's skill, not in the tool surface — the earlier "agents don't react or vote" posture is retired. Windows page both ways and can land on one message (`aroundOffset`, 2026-09-14), so a linked or searched message is read in context.

**Rowboat's own agent uses the agent face — no privileged path.** Same tools, same tokens as any foreign agent (a thin local shim for convenience is **Latitude**). This is dogfooding with teeth: if the public agent face serves Rowboat's agent daily, it is actually good enough for everyone else's; a first-party agent on a private path lets the public face rot. Cross-boundary mentions (§10) resolve into these same tools.

### Protocol stance — **Decided**

Stabilization runs at **two speeds**. The agent face is small and stabilizes early — third-party *agents* will arrive long before third-party clients or deployments. The render face and the admin surface remain **explicitly unstable (v0)** while Rowboat is the only operator; their stabilization is a deliberate future act (**Deferred**), not an accident.

---

## 10. Client integration (apps/x)

**Decided** at the surface level; layout and interaction details are **Latitude** (and the subject of the design pass).

- **Sidebar**: a Spaces section, grouped by org with org badges, unread indicators per space. Visually unmistakable from the private vault.
- **Space view**: README + feed on landing; file browser; asset viewing/editing through the existing markdown editor pointed at remote assets (draft→apply replacing direct save); the existing turn view for agent work in topics.
- **Mentions**: the existing mention system extends across the boundary — reference a space asset from a private chat (`@Roadboard/roadmap.md`) and a private asset never leaks the other way (pushes are authored summaries, §8).
- **Automations**: existing local crons and live-note objectives can target shared assets once the space tools exist — no new scheduler.
- **BYOK mode**: everything above works with no Rowboat account. Orgs are the only sign-in.

---

## 11. V1 slice: the team roadmap dogfood

*This section is the original v1 build list and acceptance scenario (August 2026). It shipped and the product is live; the narrative stays as the QA script and the designer's user journey.*

### Scope — the build list

1. Harbor (first deployment on Rowboat-managed infra, one hand-provisioned org): core operations (change-set apply/merge/conflict, history/diff, feed, membership, invite links), OAuth (discovery/DCR/PKCE/refresh), and both faces — REST + live event stream for rendering, the MCP agent face.
2. Client: add-an-org flow, Spaces sidebar section, space view (README + feed + file browser), draft→apply editing, activity strand with All/Talk/Activity.
3. Rowboat's agent wired to the org's MCP face (same tools and tokens as any foreign agent); cross-boundary mentions resolving into those tools.
4. Crons targeting shared assets (free once the tools exist).

### Acceptance scenario — the day in the life

This narrative is the QA script and the designer's user journey. The team: Arjun, Ramnique, Harsh, Gagan, Prakhar. One space: **Roadboard**, in the team's org.

1. **Creation.** Ramnique creates the space, seeds `roadmap.md` (asking their agent to draft it — already a private→shared push), invites the other four via invite links. Each accepts; Roadboard appears in their sidebars, visibly distinct from their vaults.
2. **Standup, 10:00.** All five Rowboats capture the meeting privately, as today. Nothing shared happens.
3. **First push, 10:35.** Gagan, in their private copilot: "push today's action items to Roadboard." Gagan's agent reads the private note, reads the shared doc (bundled), applies one change-set with reasoning; the feed shows the activity row.
4. **Second push, 10:41.** Prakhar, unaware, pushes too. Their agent sees the items already present, applies only the missing delta, notes it. First-pusher-wins, no machinery.
5. **The seam, 14:00.** A customer emails Ramnique about SSO. "Add this to Roadboard." A summary authored for the room lands as a change-set — "Customer X requesting SSO (via Ramnique, from email)" — visible in the feed; no email content crosses.
6. **Direct manipulation, 15:30.** Harsh ships something, opens the doc, ticks the checkbox, applies. Tiny change-set, quiet in the digest, permanent in history. Arjun, doc open, sees it refresh.
7. **Chat grammar, 16:00.** Arjun starts a topic: "should SSO jump the migration work?" All agents stay silent. Ramnique replies, then invokes `@rowboat` in-thread: "move SSO to P1" — their machine runs it; the edit lands attributed, the turn collapses in the thread. Arjun asks *Ramnique* (not Ramnique's agent) for usage numbers; Ramnique instructs their own `@rowboat`.
8. **Housekeeping, 18:00.** Ramnique's local cron (DRI by social agreement) tidies the doc — change-sets with reasoning, attributed "(via Rowboat, scheduled)". Laptop closed? Runs on next wake.
9. **Catch-up, next morning.** Arjun opens Roadboard to an unread badge: two pushes, one discussion, one housekeeping summary. The feed's digest carried the attention load. Flipping to Activity shows the complete log; the doc's history answers any "why."

### Success criteria

Within **two weeks** of the team dogfooding:

- The roadmap conversation has left Slack — priority arguments happen in Roadboard topics.
- `roadmap.md` is never more than a day stale.
- Every member has pushed from private context at least once; at least one member other than the creator has edited directly.

**Named failure mode:** if the feed is silent and pushes feel like a chore, the *explicit-push* assumption is what failed — the next bet is standing subscriptions (§12), not more UI.

---

## 12. Explicitly deferred

Each absence below is a decision:

| Deferred | Why it waits |
|---|---|
| Standing subscriptions (auto-propose from private context) | The magic version of the seam; waits until explicit push proves the loop (§11 failure mode). |
| Headless Rowboat as a member | Availability escape hatch; edges-only model must first prove itself without it. |
| Live co-typing / cursor presence / CRDT engine | Deliberate-commit model serves documents; substrate doesn't foreclose it. |
| Promote thread → named session | Same schema; arrives with drafting/code workloads (launch-post and PR-review scenarios). |
| "Assign to my Rowboat" CTA on others' requests | Sugar over the social loop; manual version costs nothing and proves it. |
| Doc-anchored margin comments | Activity-row-anchored and file-anchored topics get 80% of it. |
| Personal-agent briefings on space changes ("Roadboard changed overnight: …") | The attention layer beyond badges+digest; keeps Rowboat's personal-coworker identity — wants doing well, later. |
| Code-mode / PR-review integration (scenario 1) | Falls out of spaces + sessions-as-objects; don't special-case it before the primitive settles. |
| ~~Binary/non-text assets~~ | **Shipped 2026-08-24**, exactly on the pre-decided shape (§6 amendment) — and the predicted first itch (image paste during dogfood) is precisely what pulled it in. Row kept so the table's history stays honest. |
| Cold-history compression/tiering | Full snapshots per version are cheap at team scale. If that ever changes, the named relief valve (§6) is MediaWiki/git-style packing of *old* versions — head stays materialized, read path untouched. |
| Version retention policy | Default is history-forever until use shows the shape. Precedent (Obsidian Sync) is asymmetric: text versions kept long, blob versions short. A per-org knob, later. |
| Blob GC | Refcount sweep for unreferenced hashes (abandoned uploads, expired retention). The blob store shipped without it — still deferred as a background job until use produces orphans that matter. Space delete (§6, 2026-09-22) applies the sweep's rule inline for the space it drops. |
| Protocol stabilization (v1.0, third-party deployments and clients) | Deliberate act once the shape has survived real use. Two speeds (§9): the MCP agent face stabilizes first; render face and admin surface last. |
| Group DMs | A group conversation is a named space (§5 Direct messages). The participant-pair key extends to N if use produces a real "three of us, no name" need. |
| ~~Self-DM ("notes to self" on the org)~~ | **Shipped 2026-09-08** (§5 Direct messages) — the cross-device, agent-reachable use arrived with the mobile app the same week the deferral was written. Row kept so the table's history stays honest. |
| Agent tool to open a DM by name | "Tell Harsh I'm late" needs name → member id resolution. Handles were retired 2026-09-22; the org-wide roster (§5) is the resolver, so the tool can ship with that work. |
| Resolve-with-outcome on discussions | Archive is the whole v1 lifecycle (§7); the outcome line — ideally agent-drafted — is a stored-extensible enrichment. Deferred 2026-09-01. |
| Quote-references (a `parentMessageId` beside `threadRoot`) | Display provenance without breaking flat threads; waits for a need from use. Deferred 2026-09-01. |
| Guests (single- and multi-space) | Shape settled 2026-09-22 (§4 Invites): a member flag removing browse, self-join, and the org-wide roster; admin-invited. Built after teammates' invites work. |
| Invite approval mode (members request, admins approve) | Slack's paid-plan option; needs a request queue nobody has asked for. Deferred 2026-09-22. |
| Admin edits of another member's profile; IdP avatar seeding at bind | Slack has the first and rarely uses it; the second is a server-side fetch of a claimed URL that wants its own review. Deferred 2026-09-22 (§4 Member profile). |
| Org-level audit log | Org facts (role and policy changes) have no log in v1; their space-level consequences land on space logs. Trigger: a compliance ask. Deferred 2026-09-22. |
| Live frame for profile changes | Roster re-fetch on sync/focus/reconnect covers it. Trigger: a stale name noticed live. Deferred 2026-09-22. |
| Removal from a space by any member (not only admins); un-leavable `general` | Slack's owner-set knob and its mandatory channel; both wait for someone to ask. Deferred 2026-09-22. |
| Erasure of a person's data on request | An operator act outside the protocol; the deletion doctrine (§6) keeps history otherwise. Deferred 2026-09-22. |
| The agent-as-gardener loop (digests, auto-filing on archive) | The strategic direction the annotation model lays rails for — goal at birth, archive events, the MCP verbs. Built once the punctuation has been used by hand. |

---

## 13. Open questions

Held softly — none block v1, all should be answered by use, not by speculation:

1. **Naming, remaining.** Settled: **space**, **org** (tenant), **Harbor** (server) — under the coherence principle in the preamble. Still open: exactly how prominent "org" is in everyday UI (spelled out vs. badge/address only), and per-space naming conventions ("Roadboard"-style).
2. **Conflict UX detail.** How a human's stale draft presents its conflict and re-apply; how an agent's conflict-and-retry is summarized in the turn view.
3. **Presence granularity.** Who's here / who's typing / whose agent is working — how much, where, without making the space feel surveilled.
4. **Notification policy.** What escalates beyond the unread badge (mentions? topic replies? nothing?), and per-space controls.
5. **Digest thresholds.** Where the quiet/prominent line sits for activity rows (§7 Latitude) — tune by feel in use.
6. **Leaving and revocation semantics.** Removing a member stops future access; it cannot un-read what their agent already ingested into local context. Same as every human team ever — but the privacy story must say it out loud rather than imply otherwise.
7. **Moderation surface.** Member removal decided 2026-09-22 (§4 Roles). Still open: change-set revert conventions, and whether reverts are just ordinary change-sets (probably yes).
8. **Multi-org daily UX.** How noisy the sidebar gets at 3+ orgs; whether spaces pin/order across orgs.
9. **Managed pricing shape.** Per-seat vs storage vs flat per-org — the offering sells operations (uptime, backups, domains, support), not compute, so pricing should read as boring and predictable.
10. **License stance and trademark.** AGPL deters closed-fork hosting competitors; permissive welcomes them — a strategy choice to make deliberately before the Harbor repo is public. Either way, hold the trademark so others sell "hosting for the spaces protocol," not "Rowboat Spaces" or "Rowboat Harbor."
11. **Harbor repo timing.** When to extract Harbor from the monorepo into `rowboatlabs/harbor` with a one-command self-host path (likely: when third-party hosting is announced). The name is free: the private spec repo that held it was retired 2026-09-22.
12. **Agent replies: in the stream or in the thread.** Deferred 2026-08-21 — agent replies stay in the stream for now. Revisit before the managed service opens; flipping later splits history into two eras.
13. ~~**Open spaces and org membership.**~~ Answered 2026-09-22 — the six shape questions are Decided in §5, with the deletion doctrine in §6.
