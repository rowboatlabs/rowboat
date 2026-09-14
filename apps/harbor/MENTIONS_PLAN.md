# Mentions as links (plan → built)

> **Outcome (2026-09-10).** Built as layer 2 of the unread / Activity /
> notifications arc, in one commit on PR #1002, with these deviations from
> the plan below, each Ramnique's call:
>
> - **`@here` and `@rowboat` are tokens too** (`[@here](#here)`,
>   `[@rowboat](#rowboat)`), not plain text. Slack, Zulip, and Teams tokenize
>   their broadcast addresses; Matrix moved from body-matching to structured
>   mentions. An address is something a composer emitted deliberately.
> - **The org stamps `Message.mentions` at post and edit** from tokens alone
>   (the plan's PR 4 "out of scope" item, pulled into PR 1). Unread counts,
>   push, and the chip all read the stamp; no consumer parses text.
> - **No name-based fallback anywhere — id only.** The stamp reads token
>   hrefs; the legacy `@<id>` spelling is not read either: it was rewritten
>   once (below). A bare `@Name` is prose. The voice path produces no
>   mentions (a transcript has no pills).
> - **The legacy spelling was rewritten, not kept readable**: a one-time
>   backfill (`service.migrateMentions`) turns `@<memberId>` / `@here` /
>   `@rowboat` into tokens through the ordinary edit path, attributed to the
>   author — the log shows an edit by them and the "(edited)" mark appears.
>   Accepted for dogfood; a ledger row makes it run once per org.
> - **No roster on `list_spaces`**: `GET /v1/members` and the `list_members`
>   tool already landed (#1008).
> - **Mention-follows**: a mention follows you into the thread (the org's
>   rule), and the thread pane gained Follow / Unfollow.
> - PR 1 through PR 3 landed together; the composer uses a hand-rolled
>   inline atom (`MentionNode` in `composer-editor.ts`) serialized through
>   tiptap-markdown's per-node storage hook, parse rules at ProseMirror
>   priority above the Link mark.
>
> The plan is kept below as written, for the reasoning.


Decided 2026-09-09. Replaces the display-name → member-id text rewrite with a
markdown-native mention token that carries the id, a TipTap pill in the
composer, and an app-owned search index. Nothing here is built yet.

## The problem

Today a mention is a plain `@` in text, and the id gets in by string
replacement:

1. The composer's autocomplete inserts `@Display Name` as ordinary text.
2. On send, `encodeMentions` (renderer `lib/spaces-presentation.ts`) regex-
   rewrites every `@Display Name` outside code spans to `@<memberId>`
   (longest name first, case-insensitive). The stored body carries the ULID.
3. Every reader reverse-resolves the ULID by regex: the shared scanner in
   `@x/shared` (`mapMentions`, `mentionsMember`), main's mention-watch,
   Harbor's push classifier (`push.ts`), Harbor's search expander
   (`search.ts`), and the renderer's chip, which is a `**bold**` decoration
   that recovers the member id by reverse lookup on display name.

What breaks:

- **Names are not unique** (`Member.displayName` is documented display-only).
  Two members with the same name collide on send (first match wins) and on
  render (the chip's reverse lookup picks one).
- **Agents read raw bodies** through MCP and see `@01HX…`. There is no
  roster tool, so an agent cannot tell who is addressed, and cannot mention a
  human itself (the spaces skill says "when you only have ids, say so and
  ask").
- **Six consumers, one convention, no single definition.** The regexes are
  copied, not shared; the search index silently depends on the ULID
  tokenizing to a bare lexeme.
- **The composer has no token.** Backspace-deletes-a-mention is a hand-rolled
  caret hack (`mentionEndingAtCaret`); a name that is a prefix of another
  name, or that contains punctuation, is a regex edge case rather than a node.

## What Slack, Discord, and others do (research, 2026-09)

Three layers, everywhere:

- **Wire form carries the id, never the name alone.** Slack: `<@U024BE7LH>`
  in mrkdwn and `{type: "user", user_id}` in rich_text blocks. Discord:
  `<@80351110224678912>`. Zulip: `@**Full Name|123**` (name as a readable
  hint, id as the key). Names resolve at render from the client's member
  cache, so renames never touch stored text. Slack's old `<@U|name>` label
  form was deprecated because labels go stale, but the id wins when both are
  present.
- **The composer holds an atomic mention node** (Discord: Slate; Slack: a
  custom contenteditable emitting rich_text). A pill with id + label,
  deleted in one backspace, serialized to the wire form on send, parsed back
  for drafts and edits.
- **Notification decisions are structured, not regex** where the platform is
  modern: Discord returns a resolved `mentions[]` on every message and takes
  `allowed_mentions` on create; Matrix has intentional `m.mentions`. Slack
  still parses text server-side.
- **Files are not text mentions anywhere.** Slack has `<#C123|name>` for
  channels; files are attachments and unfurls. Discord and Zulip have no file
  mention syntax.

GitHub and Mattermost store plain `@login` and resolve server-side; that
only works with unique, stable handles, which Rowboat member ids are not.

## Decisions

### Wire form

```
[@Ramnique Singh](#member:01HXAMPLEULIDRAMNIQUE0000)
```

- The **href is the key**: `#member:<memberId>`. One regex yields type and
  id. The **label is a hint**, re-resolved at render; nothing ever parses
  the name. Stale labels after a rename are visible only in raw text.
- `@` sits **inside** the brackets so the chip is one anchor element, not an
  anchor plus a sibling `@` text node.
- **Fragment href**, not a custom scheme: markdown sanitizers keep `#`
  fragments, and the existing space file-link resolver already ignores them.
- **Colon separator, not slash.** Measured via PGlite: Postgres's `simple`
  parser swallows `member/01HX…` as one `file` token; `member:01HX…` splits
  into `member` + the bare id. (Moot once the index is app-computed, but the
  form should not fight the tokenizer anyway.)
- **The name stays in the label** (Zulip's choice, not Slack's) because
  Rowboat's raw markdown has first-class readers: the user's agent catches up
  on threads via MCP, people see raw text in the edit box and exports, and a
  departed member (no longer in the roster) would otherwise render as a bare
  ULID everywhere.
- **`@rowboat` and `@here` stay plain text.** They are fixed addresses, not
  members; every trigger already handles them.
- **Files stay standard path links.** Assets are path-addressed in the
  contract and blob hashes change on every edit, so there is no stable
  "blob id" to mention. A file link can render as a chip by keying on its
  href; that is a renderer choice, not new syntax.

### Search index: app-computed, no fallback

Message and topic tsvectors are generated columns over the raw body today
(migration 012), and the query side expands a member's name to their id at
query time. Assets already use the other shape: a TypeScript extraction
(`asset_search.extracted`) written in the same transaction, with the tsvector
derived from that column. Messages and topics move to the same shape:

- `searchTextFor(body)`: mention links → the bare id; legacy `@<id>` passes
  through; everything else verbatim. So neither the label words nor the
  `member` keyword are indexed, and a name query finds mentions only via the
  rename-safe id expansion.
- A `search_text` column, **not null, no coalesce fallback** (Ramnique,
  2026-09-09: accepted the drift risk — a write path that forgets fails the
  constraint loudly instead of degrading quietly). The migration fills legacy
  rows with `search_text = body` in SQL (legacy bodies already tokenize
  correctly), then the tsvector derives from `search_text`.
- Guard test: after the day-in-the-life suite, on both stores, every row's
  `search_text` equals the normalizer of its body.
- The index no longer depends on the wire format: a future spelling change is
  a re-normalization, never a table rewrite or a query rewrite. Snippets keep
  working unchanged (the snippet locator scans the raw body, where the id is
  still present in the href).

## The build (four PRs)

### PR 1 — Harbor locks the format and owns the index

- **Protocol gets the mention grammar**: one module in `packages/protocol`
  exporting the link regex, `mentionLink(id, name)`, and
  `parseMentionLinks(body)` (skips code spans). Harbor and the app both
  depend on protocol; this is the single definition. The `post_message` tool
  description states the form and that the id wins over the label.
- **Agents get a roster**: `members: [{id, displayName}]` on each space in
  `list_spaces` (v0-legal field addition). Without it agents can neither
  write nor read a mention.
- **Search text moves to code**: `searchTextFor` in `search.ts`; migration
  017 adds `search_text` to messages and topics, fills from body, sets not
  null, drops and re-adds `body_tsv` / `title_tsv` over it, recreates the
  gin indexes. The Postgres store's message insert, edit, and tombstone
  paths (`pg-store.ts:792`, `:824`, `:837`) and the topic insert write it
  alongside the body. The memory store matches over the same normalized
  text.
- **Push classifier reads links**: `mentionsRecipient` uses the protocol
  walker plus the legacy regex; the excerpt resolves links to `@Name` from
  the id, never the label.
- **Tests**: a name query finds a link-only mention; `member` and the label
  words do not match; the search_text invariant on both stores; push cases
  for link and legacy forms.

### PR 2 — the app reads the new form everywhere

- **Shared scanner** (`packages/shared/src/spaces.ts`): address checks and
  the resolve walker accept the link form (id from href) and keep reading
  legacy `@<id>` and `@Name` so old messages still notify and render.
  Nothing writes legacy forms after this.
- **Chip keyed on the id**: Streamdown strips relative hrefs, so the
  pre-parse step in `space-markdown.tsx` rewrites `#member:<id>` to
  `app://space-member/<id>` (the file-link trick) and the anchor component
  renders the chip from the id. This deletes the bold-based chip's reverse
  name lookup and fixes the same-name collision. Bold decoration survives
  only for legacy bodies.
- **Mention-watch / notifications**: no change beyond the shared scanner.
- **Spaces skill**: state the form, that ids come from the roster, and that
  a human is never mentioned by name alone.

Compatibility: an old client on a new-form message still gets notified (the
name sits after `[`, which the legacy scanner accepts as a boundary) and
renders it as plain `@Name` text. Fleet first, app same day, as with the
annotation model.

### PR 3 — the composer writes it

- **Mention node** in `composer-editor.ts`: inline atom with `id` + `label`,
  rendered as a pill; markdown storage serializes to the link form; a
  tiptap-markdown DOM hook rewrites `<a href="#member:…">` into the node's
  HTML shape before ProseMirror parses, so localStorage drafts and the
  inline edit box round-trip.
- **Autocomplete inserts nodes** (`mention-autocomplete.tsx`) for members;
  `@rowboat` / `@here` stay text. The profile popover's "Mention" seed
  becomes a link string the parser turns into a pill.
- **Send paths drop the rewrite**: `composer.tsx` body builder and the
  `message-row.tsx` edit save stop calling `encodeMentions`. The voice path
  is the one exception (a transcript has no pills): it keeps a renamed
  name-to-link encoder scoped to that path only.
- **Deletions**: `encodeMentions`, `mentionEndingAtCaret` (the atom handles
  single-backspace removal). Editor and presentation tests move to
  round-trip assertions.

### PR 4 — docs and follow-ons

- CONTRACT.md and PUSH_PLAN.md get a dated amendment: the form, the roster
  field, the app-owned index. The contract's deferred `handle` note closes.
- Recorded, out of scope: a structured `mentions: MemberId[]` on
  `post_message` (Discord / Matrix style) so push and mention-watch stop
  scanning bodies, and so an agent can cite someone without pinging them.

## Risks

- Migration 017 rewrites the messages table twice (one per regenerated
  column). Fine at current scale; run on staging before production.
- The tiptap-markdown parse hook is unverified against the installed
  version. PR 3 starts with a spike on the round-trip before touching send
  paths.
