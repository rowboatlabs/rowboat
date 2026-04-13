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
instruction: Show the current time in Chicago, IL in 12-hour format.
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

## The Exact Text to Insert

Write it verbatim like this (including the blank line between fence and target):

` + "```" + `track
trackId: <id>
instruction: <instruction>
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
- **Always quote cron expressions** in YAML — they contain spaces and ` + "`" + `*` + "`" + `.
- Use 2-space YAML indent. No tabs.
- Top-level markdown only — never inside a code fence, blockquote, or table.

## After Insertion

- Confirm in one line: "Added ` + "`" + `chicago-time` + "`" + ` track, refreshing hourly."
- Mention the user can click **Play** on the block to run it immediately.
- **Do not** write anything into the ` + "`" + `<!--track-target:...-->` + "`" + ` region — the runner populates it.

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
instruction: <what to produce>
active: true
schedule:
  type: cron
  expression: "0 * * * *"
` + "```" + `

<!--track-target:<kebab-id>-->
<!--/track-target:<kebab-id>-->

Top cron expressions: ` + "`" + `"0 * * * *"` + "`" + ` (hourly), ` + "`" + `"0 8 * * *"` + "`" + ` (daily 8am), ` + "`" + `"0 9 * * 1-5"` + "`" + ` (weekdays 9am), ` + "`" + `"*/15 * * * *"` + "`" + ` (every 15m).
`;

export default skill;
