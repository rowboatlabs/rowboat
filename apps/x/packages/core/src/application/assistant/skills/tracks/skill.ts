import { z } from 'zod';
import { stringify as stringifyYaml } from 'yaml';
import { TrackBlockSchema } from '@x/shared/dist/track-block.js';

const schemaYaml = stringifyYaml(z.toJSONSchema(TrackBlockSchema)).trimEnd();

const richBlockMenu = `**5. Rich block render — when the data has a natural visual form.**

The track agent can emit *rich blocks* — special fenced blocks the editor renders as styled UI (charts, calendars, embedded iframes, etc.). When the data fits one of these shapes, instruct the agent explicitly so it doesn't fall back to plain markdown:

- \`table\` — multi-row data, scoreboards, leaderboards. *"Render as a \`table\` block with columns Rank, Title, Points, Comments."*
- \`chart\` — time series, breakdowns, share-of-total. *"Render as a \`chart\` block (line, bar, or pie) with x=date, y=rate."*
- \`mermaid\` — flowcharts, sequence/relationship diagrams, gantt charts. *"Render as a \`mermaid\` diagram."*
- \`calendar\` — upcoming events / agenda. *"Render as a \`calendar\` block."*
- \`email\` — single email thread digest (subject, from, summary, latest body, optional draft). *"Render the most important unanswered thread as an \`email\` block."*
- \`image\` — single image with caption. *"Render as an \`image\` block."*
- \`embed\` — YouTube or Figma. *"Render as an \`embed\` block."*
- \`iframe\` — live dashboards, status pages, anything that benefits from being live not snapshotted. *"Render as an \`iframe\` block pointing to <url>."*
- \`transcript\` — long meeting transcripts (collapsible). *"Render as a \`transcript\` block."*
- \`prompt\` — a "next step" Copilot card the user can click to start a chat. *"End with a \`prompt\` block labeled '<short label>' that runs '<longer prompt to send to Copilot>'."*

You **do not** need to write the block body yourself — describe the desired output in the instruction and the track agent will format it (it knows each block's exact schema). Avoid \`track\` and \`task\` block types — those are user-authored input, not agent output.

- Good: "Show today's calendar events. Render as a \`calendar\` block with \`showJoinButton: true\`."
- Good: "Plot USD/INR over the last 7 days as a \`chart\` block — line chart, x=date, y=rate."
- Bad: "Show today's calendar." (vague — agent may produce a markdown bullet list when the user wants the rich block)`;

export const skill = String.raw`
# Tracks Skill

You are helping the user create and manage **track blocks** — YAML-fenced, auto-updating content blocks embedded in notes. Load this skill whenever the user wants to track, monitor, watch, or keep an eye on something in a note, asks for recurring/auto-refreshing content ("every morning...", "show current...", "pin live X here"), or presses Cmd+K and requests auto-updating content at the cursor.

## First: Just Do It — Do Not Ask About Edit Mode

Track creation and editing are **action-first**. When the user asks to track, monitor, watch, or pin auto-updating content, you proceed directly — read the file, construct the block, ` + "`" + `workspace-edit` + "`" + ` it in. Do not ask "Should I make edits directly, or show you changes first for approval?" — that prompt belongs to generic document editing, not to tracks.

- If another skill or an earlier turn already asked about edit mode and is waiting, treat the user's track request as implicit "direct mode" and proceed.
- You may still ask **one** short clarifying question when genuinely ambiguous (e.g. which note to add it to). Not about permission to edit.
- The Suggested Topics flow below is the one first-turn-confirmation exception — leave it intact.

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

## Do Not Set ` + "`" + `model` + "`" + ` or ` + "`" + `provider` + "`" + ` (almost always)

The schema includes optional ` + "`" + `model` + "`" + ` and ` + "`" + `provider` + "`" + ` fields. **Omit them.** A user-configurable global default already picks the right model and provider for tracks; setting per-track values bypasses that and is almost always wrong.

The only time these belong on a track:

- The user **explicitly** named a model or provider for *this specific track* in their request ("use Claude Opus for this one", "force this track onto OpenAI"). Quote the user's wording back when confirming.

Things that are **not** reasons to set these:

- "Tracks should be fast" / "I want a small model" — that's a global preference, not a per-track one. Leave it; the global default exists.
- "This track is complex" — write a clearer instruction; don't reach for a different model.
- "Just to be safe" / "in case it matters" — this is the antipattern. Leave them out.
- The user changed their main chat model — that has nothing to do with tracks. Leave them out.

When in doubt: omit both fields. Never volunteer them. Never include them in a starter template you suggest. If you find yourself adding them as a sensible default, stop — you're wrong.

## Choosing a trackId

- Kebab-case, short, descriptive: ` + "`" + `chicago-time` + "`" + `, ` + "`" + `sfo-weather` + "`" + `, ` + "`" + `hn-top5` + "`" + `, ` + "`" + `btc-usd` + "`" + `.
- **Must be unique within the note file.** Before inserting, read the file and check:
  - All existing ` + "`" + `trackId:` + "`" + ` lines in ` + "`" + "```" + `track` + "`" + ` blocks
  - All existing ` + "`" + `<!--track-target:...-->` + "`" + ` comments
- If you need disambiguation, add scope: ` + "`" + `btc-price-usd` + "`" + `, ` + "`" + `weather-home` + "`" + `, ` + "`" + `news-ai-2` + "`" + `.
- Don't reuse an old ID even if the previous block was deleted — pick a fresh one.

## Writing a Good Instruction

### The Frame: This Is a Personal Knowledge Tracker

Track output lives in a personal knowledge base the user scans frequently. Aim for data-forward, scannable output — the answer to "what's current / what changed?" in the fewest words that carry real information. Not prose. Not decoration.

### Core Rules

- **Specific and actionable.** State exactly what to fetch or compute.
- **Single-focus.** One block = one purpose. Split "weather + news + stocks" into three blocks, don't bundle.
- **Imperative voice, 1-3 sentences.**
- **Specify output shape.** Describe it concretely: "one line: ` + "`" + `<temp>°F, <conditions>` + "`" + `", "3-column markdown table", "bulleted digest of 5 items".

### Self-Sufficiency (critical)

The instruction runs later, in a background scheduler, with **no chat context and no memory of this conversation**. It must stand alone.

**Never use phrases that depend on prior conversation or prior runs:**
- "as before", "same style as before", "like last time"
- "keep the format we discussed", "matching the previous output"
- "continue from where you left off" (without stating the state)

If you want consistent style across runs, **describe the style inline** (e.g. "a 3-column markdown table with headers ` + "`" + `Location` + "`" + `, ` + "`" + `Local Time` + "`" + `, ` + "`" + `Offset` + "`" + `"; "a one-line status: HH:MM, conditions, temp"). The track agent only sees your instruction — not this chat, not what you produced last time.

### Output Patterns — Match the Data

Pick a shape that fits what the user is tracking. Five common patterns — the first four are plain markdown; the fifth is a rich rendered block:

**1. Single metric / status line.**
- Good: "Fetch USD/INR. Return one line: ` + "`" + `USD/INR: <rate> (as of <HH:MM IST>)` + "`" + `."
- Bad: "Give me a nice update about the dollar rate."

**2. Compact table.**
- Good: "Show current local time for India, Chicago, Indianapolis as a 3-column markdown table: ` + "`" + `Location | Local Time | Offset vs India` + "`" + `. One row per location, no prose."
- Bad: "Show a polished, table-first world clock with a pleasant layout."

**3. Rolling digest.**
- Good: "Summarize the top 5 HN front-page stories as bullets: ` + "`" + `- <title> (<points> pts, <comments> comments)` + "`" + `. No commentary."
- Bad: "Give me the top HN stories with thoughtful takeaways."

**4. Status / threshold watch.**
- Good: "Check https://status.example.com. Return one line: ` + "`" + `✓ All systems operational` + "`" + ` or ` + "`" + `⚠ <component>: <status>` + "`" + `. If degraded, add one bullet per affected component."
- Bad: "Keep an eye on the status page and tell me how it looks."

${richBlockMenu}

### Anti-Patterns

- **Decorative adjectives** describing the output: "polished", "clean", "beautiful", "pleasant", "nicely formatted" — they tell the agent nothing concrete.
- **References to past state** without a mechanism to access it ("as before", "same as last time").
- **Bundling multiple purposes** into one instruction — split into separate track blocks.
- **Open-ended prose requests** ("tell me about X", "give me thoughts on X").
- **Output-shape words without a concrete shape** ("dashboard-like", "report-style").

## YAML String Style (critical — read before writing any ` + "`" + `instruction` + "`" + ` or ` + "`" + `eventMatchCriteria` + "`" + `)

The two free-form fields — ` + "`" + `instruction` + "`" + ` and ` + "`" + `eventMatchCriteria` + "`" + ` — are where YAML parsing usually breaks. The runner re-emits the full YAML block every time it writes ` + "`" + `lastRunAt` + "`" + `, ` + "`" + `lastRunSummary` + "`" + `, etc., and the YAML library may re-flow long plain (unquoted) strings onto multiple lines. Once that happens, any ` + "`" + `:` + "`" + ` **followed by a space** inside the value silently corrupts the block: YAML interprets the ` + "`" + `:` + "`" + ` as a new key/value separator and the instruction gets truncated.

Real failure seen in the wild — an instruction containing the phrase ` + "`" + `"polished UI style as before: clean, compact..."` + "`" + ` was written as a plain scalar, got re-emitted across multiple lines on the next run, and the ` + "`" + `as before:` + "`" + ` became a phantom key. The block parsed as garbage after that.

### The rule: always use a safe scalar style

**Default to the literal block scalar (` + "`" + `|` + "`" + `) for ` + "`" + `instruction` + "`" + ` and ` + "`" + `eventMatchCriteria` + "`" + `, every time.** It is the only style that is robust across the full range of punctuation these fields typically contain, and it is safe even if the content later grows to multiple lines.

### Preferred: literal block scalar (` + "`" + `|` + "`" + `)

` + "```" + `yaml
instruction: |
  Show current local time for India, Chicago, and Indianapolis as a
  3-column markdown table: Location | Local Time | Offset vs India.
  One row per location, 24-hour time (HH:MM), no extra prose.
  Note: when a location is in DST, reflect that in the offset column.
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

**Reminder:** once you have enough to act, act. Do not pause to ask about edit mode.

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

### Background agent setup flow

Sometimes the user arrives from the Background agents panel and wants help creating a new background agent without naming a note yet.

In this flow, treat "background agent" and "track block" as the same feature. The user-facing term can stay "background agent", but the implementation is a track block inside a note. Do **not** claim these are different systems, and do **not** redirect the user toward standalone agent files or ` + "`" + `agent-schedule.json` + "`" + ` unless they explicitly ask for that architecture.

In that flow:
1. On the first turn, **do not create or modify anything yet**. Briefly explain what you can set up, say you will put it in ` + "`" + `knowledge/Tasks/` + "`" + ` by default, and ask what it should monitor plus how often it should run.
2. **Do not** ask the user where the results should live unless they explicitly said they want a different folder or there is a real ambiguity you cannot resolve.
3. If the user clearly confirms later, treat ` + "`" + `knowledge/Tasks/` + "`" + ` as the default target folder.
4. Before creating a new note there, search ` + "`" + `knowledge/Tasks/` + "`" + ` for an existing matching note and update it if one already exists.
5. If ` + "`" + `knowledge/Tasks/` + "`" + ` does not exist, create it as part of setup instead of bouncing back to ask.
6. Keep the surrounding note scaffolding minimal but useful. The track block should be the core of the note.

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
