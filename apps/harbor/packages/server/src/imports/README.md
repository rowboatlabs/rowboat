# Slack ZIP preview

`previewSlackExport(Buffer, limits?)` validates a standard Slack JSON export and returns normalized channels, historical identities, message records, counts and structured warnings. It makes no database, network, membership or notification calls. `textFormat: 'slack'` means source text is Slack mrkdwn, not sanitized/render-ready Markdown.

Run from `apps/harbor/packages/server`:

```sh
pnpm preview:slack /path/to/slack-export.zip
pnpm exec vitest run test/slack-import.test.ts
```

The command prints channel summaries and warnings, without printing message bodies or full user profiles. Output still contains channel metadata and source identifiers; treat it as workspace data.

## Input and coverage

Recognizes root-level `channels.json`, `groups.json`, `users.json` or `org_users.json`, and folders named by channel name or conversation ID containing daily `YYYY-MM-DD.json` arrays. JSON must be valid UTF-8. Enterprise-style user indexes are supported; arbitrary nested/multi-workspace and TXT layouts are rejected or reported as unsupported, not guessed.

Public/private channels, topic/purpose, archived state and historical member IDs are retained. Messages retain exact timestamp strings, source author and thread IDs, text, safe HTTP(S) file permalinks, and reaction names/counts/listed reactors. Timestamps are compared as integer microseconds. Reaction totals need not equal the available reactor list. Source metadata does not confer Harbor permissions. Names are display labels, never identity keys.

Latest available revisions resolve to one message; deletion records win even with missing/older event timestamps and retain no deleted text. Standalone tombstones can recover only author/thread metadata from previous_message. An unusable edit rejects the preview rather than displaying a stale original. A missing thread root retains its source reference and produces `missing_parent`; creating a placeholder belongs to the later writer. Parent chains/cycles are rejected because Slack threads must reference a root. Ambiguous name/ID folders are rejected rather than merged. Unsupported system subtypes are skipped explicitly. Rich blocks and attachments use the text fallback and generate a warning. Custom emoji names are retained without downloading images. Unknown authors remain explicit identities, bots retain available display names and stay historical, and unused user profiles are excluded.

DM files and ancillary data produce `unsupported_file` warnings and are not parsed as channel history. Unselected channels are not a concept at this layer: the caller selects channels from the preview before any future persistence. Membership and profile association remain separate future operations.

`records.read = accepted + skipped + superseded` counts message-array records in supported channel folders. `accepted` means normalized for preview, not persisted. Unsupported files are reported by path; their message counts are unknown. Unsupported/oversized messages are reported, never silently truncated. No cross-upload workspace identity or deduplication is inferred from names.

## Resource and archive rules

Defaults: 25 MiB compressed, 100 MiB expanded, 10 MiB per entry, 10,000 entries, 100,000 parsed array records (including metadata), and 10,000 warnings. These are conservative local-preview limits, not Slack subscription limits or production upload entitlements. Programmatic callers can supply positive integer overrides; an eventual endpoint must keep limits server-controlled.

Entries are read sequentially, with both declared and actual expansion checks and CRC verification. Absolute/traversal/backslash paths, duplicate paths, symbolic links, encrypted entries, malformed JSON, ambiguous channel IDs/names, and corrupt ZIPs fail the entire preview. No paths are extracted and no embedded URL is fetched. Normalized results are held in memory within these limits; a production upload route/background worker is a separate implementation.

## Verification fixtures

`test/fixtures/slack/public.json` and `enterprise.json` are synthetic file maps zipped by the tests. They exercise timestamp precision, threads, incomplete reaction identity lists, files, private/archived channels, bot/deleted users and excluded DMs. Additional generated cases cover revisions/deletions, unknown users, malformed inputs and resource caps. These fixtures do not establish compatibility with every Enterprise export variant; real customer samples should be checked before rollout.

The regression cases additionally permute nested edit/deletion ordering, cover conversation-ID folders and alias collisions, validate unknown-to-bot identity promotion, reject invalid parent chains, and check record accounting. The shape reference is [Slack’s export guide](https://slack.com/help/articles/220556107-How-to-read-Slack-data-exports), checked 2026-11-13. These remain synthetic tests; no sanitized customer export was available during this review.
