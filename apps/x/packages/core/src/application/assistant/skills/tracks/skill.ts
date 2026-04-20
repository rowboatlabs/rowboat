import { z } from 'zod';
import { stringify as stringifyYaml } from 'yaml';
import { TrackBlockSchema } from '@x/shared/dist/track-block.js';

const schemaYaml = stringifyYaml(z.toJSONSchema(TrackBlockSchema)).trimEnd();

export const skill = String.raw`
# Tracks Skill

You are helping the user create and manage **track blocks** — YAML-fenced, auto-updating content blocks embedded in notes. Load this skill whenever the user wants to track, monitor, watch, or keep an eye on something in a note, asks for recurring/auto-refreshing content ("every morning...", "show current...", "pin live X here"), or presses Cmd+K and requests auto-updating content at the cursor.

## What Is a Track Block

A track block is a scheduled, agent-run block embedded directly inside a markdown note. Each block has:
- A YAML-fenced ` + "`" + `track` + "`" + ` block that defines the instruction, schedule, and metadata.
- A sibling "target region" — an HTML-comment-fenced area where the generated output lives. The runner rewrites the target region on each scheduled run.

**Concrete example** (a track that shows the current time in Chicago every hour):

` + "```" + `track
trackId: chicago-time
instruction: |
  Show the current time in Chicago, IL in 12-hour format.
active: true
schedule:
  type: cron
  expression: "0 * * * *"
` + "```" + `

<!--track-target:chicago-time-->
<!--/track-target:chicago-time-->

Good use cases:
- Weather / air quality for a location
- News digests or headlines
- Stock or crypto prices
- Sports scores
- Service status pages
- Personal dashboards (today's calendar, steps, focus stats)
- Any recurring summary that decays fast

## Anatomy

Each track has two parts that live next to each other in the note:

1. The ` + "`" + `track` + "`" + ` code fence — contains the YAML config. The fence language tag is literally ` + "`" + `track` + "`" + `.
2. The target-comment region — ` + "`" + `<!--track-target:ID-->` + "`" + ` and ` + "`" + `<!--/track-target:ID-->` + "`" + ` with optional content between. The ID must match the ` + "`" + `trackId` + "`" + ` in the YAML.

The target region is **sibling**, not nested. It must **never** live inside the ` + "`" + "```" + `track` + "`" + ` fence.

## Canonical Schema

Below is the authoritative schema for a track block (generated at build time from the TypeScript source — never out of date). Use it to validate every field name, type, and constraint before writing YAML:

` + "```" + `yaml
${schemaYaml}
` + "```" + `

**Runtime-managed fields — never write these yourself:** ` + "`" + `lastRunAt` + "`" + `, ` + "`" + `lastRunId` + "`" + `, ` + "`" + `lastRunSummary` + "`" + `.

## Choosing a trackId

- Kebab-case, short, descriptive: ` + "`" + `chicago-time` + "`" + `, ` + "`" + `sfo-weather` + "`" + `, ` + "`" + `hn-top5` + "`" + `, ` + "`" + `btc-usd` + "`" + `.
- **Must be unique within the note file.** Before inserting, read the file and check:
  - All existing ` + "`" + `trackId:` + "`" + ` lines in ` + "`" + "```" + `track` + "`" + ` blocks
  - All existing ` + "`" + `<!--track-target:...-->` + "`" + ` comments
- If you need disambiguation, add scope: ` + "`" + `btc-price-usd` + "`" + `, ` + "`" + `weather-home` + "`" + `, ` + "`" + `news-ai-2` + "`" + `.
- Don't reuse an old ID even if the previous block was deleted — pick a fresh one.

## Writing a Good Instruction

- **Specific and actionable.** State exactly what to fetch or compute.
- **Single-focus.** One block = one purpose. Split "weather + news + stocks" into three blocks, don't bundle.
- **Imperative voice, 1-3 sentences.**
- **Mention output style** if it matters ("markdown bullet list", "one sentence", "table with 5 rows").

Good:
> Fetch the current temperature, feels-like, and conditions for Chicago, IL in Fahrenheit. Return as a single line: "72°F (feels like 70°F), partly cloudy".

Bad:
> Tell me about Chicago.

## YAML String Style (critical — read before writing any ` + "`" + `instruction` + "`" + ` or ` + "`" + `eventMatchCriteria` + "`" + `)

The two free-form fields — ` + "`" + `instruction` + "`" + ` and ` + "`" + `eventMatchCriteria` + "`" + ` — are where YAML parsing usually breaks. The runner re-emits the full YAML block every time it writes ` + "`" + `lastRunAt` + "`" + `, ` + "`" + `lastRunSummary` + "`" + `, etc., and the YAML library may re-flow long plain (unquoted) strings onto multiple lines. Once that happens, any ` + "`" + `:` + "`" + ` **followed by a space** inside the value silently corrupts the block: YAML interprets the ` + "`" + `:` + "`" + ` as a new key/value separator and the instruction gets truncated.

Real failure seen in the wild — an instruction containing the phrase ` + "`" + `"polished UI style as before: clean, compact..."` + "`" + ` was written as a plain scalar, got re-emitted across multiple lines on the next run, and the ` + "`" + `as before:` + "`" + ` became a phantom key. The block parsed as garbage after that.

### The rule: always use a safe scalar style

**Default to the literal block scalar (` + "`" + `|` + "`" + `) for ` + "`" + `instruction` + "`" + ` and ` + "`" + `eventMatchCriteria` + "`" + `, every time.** It is the only style that is robust across the full range of punctuation these fields typically contain, and it is safe even if the content later grows to multiple lines.

### Preferred: literal block scalar (` + "`" + `|` + "`" + `)

` + "```" + `yaml
instruction: |
  Show a side-by-side world clock for India, Chicago, and Indianapolis.
  Return a compact markdown table with columns for location, current local
  time, and relative offset vs India. Format with the same polished UI
  style as before: clean, compact, visually pleasant, and table-first.
eventMatchCriteria: |
  Emails from the finance team about Q3 budget or OKRs.
` + "```" + `

- ` + "`" + `|` + "`" + ` preserves line breaks verbatim. Colons, ` + "`" + `#` + "`" + `, quotes, leading ` + "`" + `-` + "`" + `, percent signs — all literal. No escaping needed.
- **Indent every content line by 2 spaces** relative to the key (` + "`" + `instruction:` + "`" + `). Use spaces, never tabs.
- Leave a real newline after ` + "`" + `|` + "`" + ` — content starts on the next line, not the same line.
- Default chomping (no modifier) is fine. Do **not** add ` + "`" + `-` + "`" + ` or ` + "`" + `+` + "`" + ` unless you know you need them.
- A ` + "`" + `|` + "`" + ` block is terminated by a line indented less than the content — typically the next sibling key (` + "`" + `active:` + "`" + `, ` + "`" + `schedule:` + "`" + `).

### Acceptable alternative: double-quoted on a single line

Fine for short single-sentence fields with no newline needs:

` + "```" + `yaml
instruction: "Show the current time in Chicago, IL in 12-hour format."
eventMatchCriteria: "Emails about Q3 planning, OKRs, or roadmap decisions."
` + "```" + `

- Escape ` + "`" + `"` + "`" + ` as ` + "`" + `\"` + "`" + ` and backslash as ` + "`" + `\\` + "`" + `.
- Prefer ` + "`" + `|` + "`" + ` the moment the string needs two sentences or a newline.

### Single-quoted on a single line (only if double-quoted would require heavy escaping)

` + "```" + `yaml
instruction: 'He said "hi" at 9:00.'
` + "```" + `

- A literal single quote is escaped by doubling it: ` + "`" + `'it''s fine'` + "`" + `.
- No other escape sequences work.

### Do NOT use plain (unquoted) scalars for these two fields

Even if the current value looks safe, a future edit (by you or the user) may introduce a ` + "`" + `:` + "`" + ` or ` + "`" + `#` + "`" + `, and a future re-emit may fold the line. The ` + "`" + `|` + "`" + ` style is safe under **all** future edits — plain scalars are not.

### Editing an existing track

If you ` + "`" + `workspace-edit` + "`" + ` an existing track's ` + "`" + `instruction` + "`" + ` or ` + "`" + `eventMatchCriteria` + "`" + ` and find it is still a plain scalar, **upgrade it to ` + "`" + `|` + "`" + `** in the same edit. Don't leave a plain scalar behind that the next run will corrupt.

### Never-hand-write fields

` + "`" + `lastRunAt` + "`" + `, ` + "`" + `lastRunId` + "`" + `, ` + "`" + `lastRunSummary` + "`" + ` are owned by the runner. Don't touch them — don't even try to style them. If your ` + "`" + `workspace-edit` + "`" + `'s ` + "`" + `oldString` + "`" + ` happens to include these lines, copy them byte-for-byte into ` + "`" + `newString` + "`" + ` unchanged.

## Schedules

Schedule is an **optional** discriminated union. Three types:

### ` + "`" + `cron` + "`" + ` — recurring at exact times

` + "```" + `yaml
schedule:
  type: cron
  expression: "0 * * * *"
` + "```" + `

Fires at the exact cron time. Use when the user wants precise timing ("at 9am daily", "every hour on the hour").

### ` + "`" + `window` + "`" + ` — recurring within a time-of-day range

` + "```" + `yaml
schedule:
  type: window
  cron: "0 0 * * 1-5"
  startTime: "09:00"
  endTime: "17:00"
` + "```" + `

Fires **at most once per cron occurrence**, but only if the current time is within ` + "`" + `startTime` + "`" + `–` + "`" + `endTime` + "`" + ` (24-hour HH:MM, local). Use when the user wants "sometime in the morning" or "once per weekday during work hours" — flexible timing with bounds.

### ` + "`" + `once` + "`" + ` — one-shot at a future time

` + "```" + `yaml
schedule:
  type: once
  runAt: "2026-04-14T09:00:00"
` + "```" + `

Fires once at ` + "`" + `runAt` + "`" + ` and never again. Local time, no ` + "`" + `Z` + "`" + ` suffix.

### Cron cookbook

- ` + "`" + `"*/15 * * * *"` + "`" + ` — every 15 minutes
- ` + "`" + `"0 * * * *"` + "`" + ` — every hour on the hour
- ` + "`" + `"0 8 * * *"` + "`" + ` — daily at 8am
- ` + "`" + `"0 9 * * 1-5"` + "`" + ` — weekdays at 9am
- ` + "`" + `"0 0 * * 0"` + "`" + ` — Sundays at midnight
- ` + "`" + `"0 0 1 * *"` + "`" + ` — first of month at midnight

**Omit ` + "`" + `schedule` + "`" + ` entirely for a manual-only track** — the user triggers it via the Play button in the UI.

## Event Triggers (third trigger type)

In addition to manual and scheduled, a track can be triggered by **events** — incoming signals from the user's data sources (currently: gmail emails). Set ` + "`" + `eventMatchCriteria` + "`" + ` to a description of what kinds of events should consider this track for an update:

` + "```" + `track
trackId: q3-planning-emails
instruction: |
  Maintain a running summary of decisions and open questions about Q3
  planning, drawn from emails on the topic.
active: true
eventMatchCriteria: |
  Emails about Q3 planning, roadmap decisions, or quarterly OKRs.
` + "```" + `

How it works:
1. When a new event arrives (e.g. an email syncs), a fast LLM classifier checks ` + "`" + `eventMatchCriteria` + "`" + ` against the event content.
2. If it might match, the track-run agent receives both the event payload and the existing track content, and decides whether to actually update.
3. If the event isn't truly relevant on closer inspection, the agent skips the update — no fabricated content.

When to suggest event triggers:
- The user wants to **maintain a living summary** of a topic ("keep notes on everything related to project X").
- The content depends on **incoming signals** rather than periodic refresh ("update this whenever a relevant email arrives").
- Mention to the user: scheduled (cron) is for time-driven updates; event is for signal-driven updates. They can be combined — a track can have both a ` + "`" + `schedule` + "`" + ` and ` + "`" + `eventMatchCriteria` + "`" + ` (it'll run on schedule AND on relevant events).

Writing good ` + "`" + `eventMatchCriteria` + "`" + `:
- Be descriptive but not overly narrow — Pass 1 routing is liberal by design.
- Examples: ` + "`" + `"Emails from John about the migration project"` + "`" + `, ` + "`" + `"Calendar events related to customer interviews"` + "`" + `, ` + "`" + `"Meeting notes that mention pricing changes"` + "`" + `.

Tracks **without** ` + "`" + `eventMatchCriteria` + "`" + ` opt out of events entirely — they'll only run on schedule or manually.

## Insertion Workflow

### Cmd+K with cursor context

When the user invokes Cmd+K, the context includes an attachment mention like:
> User has attached the following files:
> - notes.md (text/markdown) at knowledge/notes.md (line 42)

Workflow:
1. Extract the ` + "`" + `path` + "`" + ` and ` + "`" + `line N` + "`" + ` from the attachment.
2. ` + "`" + `workspace-readFile({ path })` + "`" + ` — always re-read fresh.
3. Check existing ` + "`" + `trackId` + "`" + `s in the file to guarantee uniqueness.
4. Locate the line. Pick a **unique 2-3 line anchor** around line N (a full heading, a distinctive sentence). Avoid blank lines and generic text.
5. Construct the full track block (YAML + target pair).
6. ` + "`" + `workspace-edit({ path, oldString: <anchor>, newString: <anchor with block spliced at line N> })` + "`" + `.

### Sidebar chat with a specific note

1. If a file is mentioned/attached, read it.
2. If ambiguous, ask one question: "Which note should I add the track to?"
3. **Default placement: append** to the end of the file. Find the last non-empty line as the anchor. ` + "`" + `newString` + "`" + ` = that line + ` + "`" + `\n\n` + "`" + ` + track block + target pair.
4. If the user specified a section ("under the Weather heading"), anchor on that heading.

### No note context at all

Ask one question: "Which note should this track live in?" Don't create a new note unless the user asks.

### Suggested Topics exploration flow

Sometimes the user arrives from the Suggested Topics panel and gives you a prompt like:
- "I am exploring a suggested topic card from the Suggested Topics panel."
- a title, category, description, and target folder such as ` + "`" + `knowledge/Topics/` + "`" + ` or ` + "`" + `knowledge/People/` + "`" + `

In that flow:
1. On the first turn, **do not create or modify anything yet**. Briefly explain the tracking note you can set up and ask for confirmation.
2. If the user clearly confirms ("yes", "set it up", "do it"), treat that as explicit permission to proceed.
3. Before creating a new note, search the target folder for an existing matching note and update it if one already exists.
4. If no matching note exists and the prompt gave you a target folder, create the new note there without bouncing back to ask "which note should this live in?".
5. Use the card title as the default note title / filename unless a small normalization is clearly needed.
6. Keep the surrounding note scaffolding minimal but useful. The track block should be the core of the note.
7. If the target folder is one of the structured knowledge folders (` + "`" + `knowledge/People/` + "`" + `, ` + "`" + `knowledge/Organizations/` + "`" + `, ` + "`" + `knowledge/Projects/` + "`" + `, ` + "`" + `knowledge/Topics/` + "`" + `), mirror the local note style by quickly checking a nearby note or config before writing if needed.

## The Exact Text to Insert

Write it verbatim like this (including the blank line between fence and target):

` + "```" + `track
trackId: <id>
instruction: |
  <instruction, indented 2 spaces, may span multiple lines>
active: true
schedule:
  type: cron
  expression: "0 * * * *"
` + "```" + `

<!--track-target:<id>-->
<!--/track-target:<id>-->

**Rules:**
- One blank line between the closing ` + "`" + "```" + `" + " fence and the ` + "`" + `<!--track-target:ID-->` + "`" + `.
- Target pair is **empty on creation**. The runner fills it on the first run.
- **Always use the literal block scalar (` + "`" + `|` + "`" + `)** for ` + "`" + `instruction` + "`" + ` and ` + "`" + `eventMatchCriteria` + "`" + `, indented 2 spaces. Never a plain (unquoted) scalar — see the YAML String Style section above for why.
- **Always quote cron expressions** in YAML — they contain spaces and ` + "`" + `*` + "`" + `.
- Use 2-space YAML indent. No tabs.
- Top-level markdown only — never inside a code fence, blockquote, or table.

## After Insertion

- Confirm in one line: "Added ` + "`" + `chicago-time` + "`" + ` track, refreshing hourly."
- **Then offer to run it once now** (see "Running a Track" below) — especially valuable for newly created blocks where the target region is otherwise empty until the next scheduled or event-triggered run.
- **Do not** write anything into the ` + "`" + `<!--track-target:...-->` + "`" + ` region yourself — use the ` + "`" + `run-track-block` + "`" + ` tool to delegate to the track agent.

## Running a Track (the ` + "`" + `run-track-block` + "`" + ` tool)

The ` + "`" + `run-track-block` + "`" + ` tool manually triggers a track run right now. Equivalent to the user clicking the Play button — but you can pass extra ` + "`" + `context` + "`" + ` to bias what the track agent does on this single run (without modifying the block's ` + "`" + `instruction` + "`" + `).

### When to proactively offer to run

These are upsells — ask first, don't run silently.

- **Just created a new track block.** Before declaring done, offer:
  > "Want me to run it once now to seed the initial content?"

  This is **especially valuable for event-triggered tracks** (with ` + "`" + `eventMatchCriteria` + "`" + `) — otherwise the target region stays empty until the next matching event arrives.

  For tracks that pull from existing local data (synced emails, calendar, meeting notes), suggest a **backfill** with explicit context (see below).

- **Just edited an existing track.** Offer:
  > "Want me to run it now to see the updated output?"

- **Explicit user request.** "run the X track", "test it", "refresh that block" → call the tool directly.

### Using the ` + "`" + `context` + "`" + ` parameter (the powerful case)

The ` + "`" + `context` + "`" + ` parameter is extra guidance for the track agent on this run only. It's the difference between a stock refresh and a smart backfill.

**Examples:**

- New track: "Track emails about Q3 planning" → after creating it, run with:
  > context: "Initial backfill — scan ` + "`" + `gmail_sync/` + "`" + ` for emails from the last 90 days that match this track's topic (Q3 planning, OKRs, roadmap), and synthesize the initial summary."

- New track: "Summarize this week's customer calls" → run with:
  > context: "Backfill from this week's meeting notes in ` + "`" + `granola_sync/` + "`" + ` and ` + "`" + `fireflies_sync/` + "`" + `."

- Manual refresh after the user mentions a recent change:
  > context: "Focus on changes from the last 7 days only."

- Plain refresh (user says "run it now"): **omit ` + "`" + `context` + "`" + ` entirely**. Don't invent context — it can mislead the agent.

### What to do with the result

The tool returns ` + "`" + `{ success, runId, action, summary, contentAfter, error }` + "`" + `:

- **` + "`" + `action: 'replace'` + "`" + `** → the track was updated. Confirm with one line, optionally citing the first line of ` + "`" + `contentAfter` + "`" + `:
  > "Done — track now shows: 72°F, partly cloudy in Chicago."

- **` + "`" + `action: 'no_update'` + "`" + `** → the agent decided nothing needed to change. Tell the user briefly; ` + "`" + `summary` + "`" + ` may explain why.

- **` + "`" + `error` + "`" + ` set** → surface it concisely. If the error is ` + "`" + `'Already running'` + "`" + ` (concurrency guard), let the user know the track is mid-run and to retry shortly.

### Don'ts

- **Don't auto-run** after every edit — ask first.
- **Don't pass ` + "`" + `context` + "`" + `** for a plain refresh — only when there's specific extra guidance to give.
- **Don't use ` + "`" + `run-track-block` + "`" + ` to manually write content** — that's ` + "`" + `update-track-content` + "`" + `'s job (and even that should be rare; the track agent handles content via this tool).
- **Don't ` + "`" + `run-track-block` + "`" + ` repeatedly** in a single turn — one run per user-facing action.

## Proactive Suggestions

When the user signals interest in recurring or time-decaying info, **offer a track block** instead of a one-off answer. Signals:
- "I want to track / monitor / watch / keep an eye on / follow X"
- "Can you check on X every morning / hourly / weekly?"
- The user just asked a one-off question whose answer decays (weather, score, price, status, news).
- The user is building a time-sensitive page (weekly dashboard, morning briefing).

Suggestion style — one line, concrete:
> "I can turn this into a track block that refreshes hourly — want that?"

Don't upsell aggressively. If the user clearly wants a one-off answer, give them one.

## Don'ts

- **Don't reuse** an existing ` + "`" + `trackId` + "`" + ` in the same file.
- **Don't add ` + "`" + `schedule` + "`" + `** if the user explicitly wants a manual-only track.
- **Don't write** ` + "`" + `lastRunAt` + "`" + `, ` + "`" + `lastRunId` + "`" + `, or ` + "`" + `lastRunSummary` + "`" + ` — runtime-managed.
- **Don't nest** the ` + "`" + `<!--track-target:ID-->` + "`" + ` region inside the ` + "`" + "```" + `track` + "`" + ` fence.
- **Don't touch** content between ` + "`" + `<!--track-target:ID-->` + "`" + ` and ` + "`" + `<!--/track-target:ID-->` + "`" + ` — that's generated content.
- **Don't schedule** with ` + "`" + `"* * * * *"` + "`" + ` (every minute) unless the user explicitly asks.
- **Don't add a ` + "`" + `Z` + "`" + ` suffix** on ` + "`" + `runAt` + "`" + ` — local time only.
- **Don't use ` + "`" + `workspace-writeFile` + "`" + `** to rewrite the whole file — always ` + "`" + `workspace-edit` + "`" + ` with a unique anchor.

## Editing or Removing an Existing Track

**Change schedule or instruction:** read the file, ` + "`" + `workspace-edit` + "`" + ` the YAML body. Anchor on the unique ` + "`" + `trackId: <id>` + "`" + ` line plus a few surrounding lines.

**Pause without deleting:** flip ` + "`" + `active: false` + "`" + `.

**Remove entirely:** ` + "`" + `workspace-edit` + "`" + ` with ` + "`" + `oldString` + "`" + ` = the full ` + "`" + "```" + `track` + "`" + ` block **plus** the target pair (so generated content also disappears), ` + "`" + `newString` + "`" + ` = empty.

## Quick Reference

Minimal template:

` + "```" + `track
trackId: <kebab-id>
instruction: |
  <what to produce — always use ` + "`" + `|` + "`" + `, indented 2 spaces>
active: true
schedule:
  type: cron
  expression: "0 * * * *"
` + "```" + `

<!--track-target:<kebab-id>-->
<!--/track-target:<kebab-id>-->

Top cron expressions: ` + "`" + `"0 * * * *"` + "`" + ` (hourly), ` + "`" + `"0 8 * * *"` + "`" + ` (daily 8am), ` + "`" + `"0 9 * * 1-5"` + "`" + ` (weekdays 9am), ` + "`" + `"*/15 * * * *"` + "`" + ` (every 15m).

YAML style reminder: ` + "`" + `instruction` + "`" + ` and ` + "`" + `eventMatchCriteria` + "`" + ` are **always** ` + "`" + `|` + "`" + ` block scalars. Never plain. Never leave a plain scalar in place when editing.
`;

export default skill;
