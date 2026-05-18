import { z } from 'zod';
import { stringify as stringifyYaml } from 'yaml';
import { LiveNoteSchema } from '@x/shared/dist/live-note.js';

const schemaYaml = stringifyYaml(z.toJSONSchema(LiveNoteSchema)).trimEnd();

const richBlockMenu = `**5. Rich block render — when the data has a natural visual form.**

The live-note agent can emit *rich blocks* — special fenced blocks the editor renders as styled UI (charts, calendars, embedded iframes, etc.). When the data fits one of these shapes, mention it in the objective so the agent doesn't fall back to plain markdown:

- \`table\` — multi-row data, scoreboards, leaderboards. *"Render the leaderboard as a \`table\` block with columns Rank, Title, Points, Comments."*
- \`chart\` — time series, breakdowns, share-of-total. *"Plot the rate as a \`chart\` block (line, bar, or pie) with x=date, y=rate."*
- \`mermaid\` — flowcharts, sequence/relationship diagrams, gantt charts. *"Render the dependency map as a \`mermaid\` diagram."*
- \`calendar\` — upcoming events / agenda. *"Show the agenda as a \`calendar\` block."*
- \`email\` — single email thread digest (subject, from, summary, latest body, optional draft). *"Render the most important unanswered thread as an \`email\` block."*
- \`image\` — single image with caption. *"Render the cover photo as an \`image\` block."*
- \`embed\` — YouTube or Figma. *"Render the demo as an \`embed\` block."*
- \`iframe\` — live dashboards, status pages, anything that benefits from being live not snapshotted. *"Embed the status page as an \`iframe\` block pointing to <url>."*
- \`transcript\` — long meeting transcripts (collapsible). *"Render the transcript as a \`transcript\` block."*
- \`prompt\` — a "next step" Copilot card the user can click to start a chat. *"End with a \`prompt\` block labeled '<short label>' that runs '<longer prompt to send to Copilot>'."*

You **do not** need to write the block body yourself — describe the desired output inside the objective and the live-note agent will format it (it knows each block's exact schema). Avoid \`task\` block types — those are user-authored input, not agent output.

- Good: "Show today's calendar events. Render as a \`calendar\` block with \`showJoinButton: true\`."
- Good: "Plot USD/INR over the last 7 days as a \`chart\` block — line chart, x=date, y=rate."
- Bad: "Show today's calendar." (vague — agent may produce a markdown bullet list when the user wants the rich block)`;

export const skill = String.raw`
# Live Notes Skill

A *live note* is a regular markdown note whose body is kept current by a background agent. The user expresses intent via a single \`live:\` block in the note's YAML frontmatter — one persistent **objective** plus an optional \`triggers\` object that says when the agent should fire (cron, time-of-day windows, and/or matching events). A note with no \`live:\` key is just static; adding one makes it live. Users manage live notes in the **Live Note panel** (Radio icon at the top-right of the editor).

When this skill is loaded, your job is: make a passive note live (or extend the objective on an already-live note), run the agent once so the user immediately sees content, and tell them where to manage it.

## Mode: act-first (non-negotiable on strong signals)

Live-note creation and editing are **action-first**. Strong-signal asks (see below) get *executed*, not discussed. Read the file, write the \`live:\` block via \`workspace-edit\`, run the agent once, and confirm in one line at the end. Past tense, not future tense.

What you must NOT do on a strong-signal ask:
- Don't ask "Should I make edits directly, or show changes first for approval?" — that prompt belongs to generic doc editing, not live notes.
- Don't ask "where should this live?" — pick a default folder (see below) and proceed.
- Don't say "I'll create knowledge/Notes/X.md" without the action attached. Either say "Done — created…" or just do it.
- Don't open with an explanation of what a live note is. The user already asked for one.
- **Don't ask "should I do this?" — when the request is unambiguous, just do it.** A clarifying question is reserved for *genuine* ambiguity (see "When to ask one short question" below), not as a politeness gate.

If a previous skill or earlier turn was waiting on edit-mode permission, treat the live-note request as implicit "direct mode" and proceed.

The two **panel-driven** flows in "Exceptions" at the bottom of this skill are the only places where a first-turn explanation is wanted. Don't bleed that posture into normal asks.

## Reading the user's intent

You're loaded any time the user might be asking for something dynamic. Three postures, depending on signal strength:

### Strong signals — act, then confirm (default behaviour)

The user used unambiguous language asking for something to be tracked. **Just do it** — pick a default folder, look for an existing matching note, then either extend its objective or create a new live note. Run it once. Confirm in one line. No "should I?" gate.

- **Cadence words**: "every morning…", "daily…", "each Monday…", "hourly weather here"
- **Living-document verbs**: "keep a running summary of…", "maintain a digest of…", "build up notes on…", "roll up X here"
- **Watch/monitor verbs**: "watch X", "monitor Y", "keep an eye on Z", "follow the Acme deal", "stay on top of…"
- **Pin-live framings**: "pin live updates of…", "always show the latest X here", "keep this fresh"
- **Direct**: "set up a [feed / tracker / dashboard / live note] for X", "track X" / "make this live"
- **Event-conditional**: "whenever a relevant email comes in, update…", "if anyone mentions X, capture it here"

### Default folder picker (when no note is named)

When a strong signal lands without a specific note attached, pick the folder by topic shape. Don't ask the user — pick.

| Topic shape | Default folder |
|---|---|
| News, headlines, market prices, weather, status pages, reference dashboards | \`knowledge/Notes/\` |
| Tasks, monitors, daily briefings, recurring digests of the user's own data, "background agent"-style work | \`knowledge/Tasks/\` |
| A specific person (e.g. "track everything about Sarah Chen") | \`knowledge/People/\` |
| A specific company / org | \`knowledge/Organizations/\` |
| A specific project or workstream | \`knowledge/Projects/\` |
| A topic / theme | \`knowledge/Topics/\` |

**Filename**: derive from the topic in title-case (\`News Feed.md\`, \`Coinbase News.md\`, \`SFO Weather.md\`).

**Before creating**: \`workspace-grep\` and \`workspace-glob\` the chosen folder for an existing note that already covers the topic. If one exists with a \`live:\` block, **extend its objective** (see "Already-live notes — extend, don't fork"). If one exists without a \`live:\` block, **make that note live** (don't create a duplicate). Only create a new file when no match is found.

### Default cadence picker (when the user didn't specify timing)

When the user names a topic but doesn't say *how often*, **pick a cadence** — don't ask. Use judgment based on the topic shape. The user can tweak it later in the panel.

| Topic shape | Default cadence |
|---|---|
| News / market summary / topic-following / weather / status | One morning **window** \`06:00\`–\`12:00\`. Add an \`eventMatchCriteria\` when the topic could also surface in synced Gmail/Calendar. |
| Stock / crypto prices when the user says "real-time" or "throughout the day" | \`cronExpr\` hourly or every 15 min, depending on phrasing. |
| Daily briefings / dashboards | Two or three **windows** spanning the workday (morning, midday, post-lunch). |
| Email / calendar-driven topics (Q3 emails, customer reschedules) | \`eventMatchCriteria\` only — schedule is "when a relevant signal arrives". Add a single morning window if a fallback baseline refresh feels right. |

**When in doubt, default to a single morning window \`06:00\`–\`12:00\`.** It's forgiving (fires whenever the user opens the app in the morning) and matches the casual "I'll check this in the morning" expectation.

Reach for a precise \`cronExpr\` only when the user explicitly demands a clock time ("at 9am sharp", "every 15 minutes"). Casual asks ("every morning", "daily") get windows.

### When to ask one short question

Only when the request is **genuinely** ambiguous — not as a politeness gate. Examples:

- The user named a specific note that doesn't exist AND your search for similar names returned multiple plausible candidates → ask "Did you mean A or B?"
- The new ask in an already-live note conflicts with the existing objective (replace, not extend) → ask "Replace the existing objective, or add this on top?"
- The topic is too vague to derive a sensible filename or folder ("track stuff for me") → ask one focusing question.

Pick a single question, get to the action on the next turn. Never stack questions.

### Medium signals — answer the one-off, then offer

Answer the user's actual question first. Then add a single-line offer to keep it updated. **The offer is not optional on a medium signal — if you don't add it, you're failing the skill.** If the user says yes, make the note live. If they don't engage, leave it — don't push twice.

- **Time-decaying one-offs**: "what's USD/INR right now?", "top HN stories?", "weather?", "status of service X?"
- **News / updates on a topic**: "what's the latest news on Coinbase?", "what's happening with the Q3 launch?", "any updates on Project Apollo?", "what's new with [person/company]?"
- **Note-anchored snapshots**: "show me my schedule today", "put my open tasks here", "drop the latest commits here" — especially when in a note context
- **Recurring artifacts**: "I'm starting a weekly review note", "my morning briefing", "a dashboard for the Acme deal"
- **Topic-following / catch-up**: "catch me up on the migration project", "I want to follow Project Apollo"

**Catch-all heuristic:** if you reached for \`web-search\` or a news tool to answer a question about a person, company, project, or topic, the answer is exactly the kind of thing a live note would refresh on a schedule — **always offer** at the end. Same goes for any time-decaying lookup (prices, weather, status).

Offer line shape (one line, concrete):
> "Want me to keep this in a live note that refreshes every morning?"

Or, when there's a sensible default file already implied (e.g. a topic name):
> "I can drop this in \`knowledge/Notes/Coinbase News.md\` and refresh it every morning — want that?"

The offer goes at the **very end** of your response, on its own line, after the answer is fully delivered.

### Anti-signals — do NOT make a note live

- Definitional questions ("what is X?")
- One-off lookups ("look up X for me")
- Manual document work ("help me write…", "edit this paragraph…")
- General how-to ("how do I do Y?")

## Already-live notes — extend, don't fork

**This is the most important rule of the skill.** When the user asks you to track something *new* in a note that **already has a \`live:\` block**, edit the existing \`objective\` in natural language to absorb the new ask. Do **not** create a second \`live:\` block. Do **not** introduce some other key. There is exactly one objective per note.

- The user says "also keep an eye on Hacker News stories about this" → read the current \`objective\`, append/integrate the new ask in natural-language prose, write it back.
- The objective ends up longer over time. That's fine. The agent treats it as one coherent intent.
- If the new ask conflicts with the old (e.g. user wants to *replace* what the note tracks), ask one short question to confirm before overwriting.

## What to say to the user

The user knows the feature as **live notes** and finds them in the **Live notes view**. Speak in those terms; don't expose internals like "frontmatter", "trigger", or "objective" in user-facing prose unless the user uses them first.

**Use past tense.** All of these messages are sent *after* the action — no future-tense "I'll do this" or "I'm going to set this up". The action already happened.

After making a passive note live (or creating a new live note from scratch):
> Done — created \`knowledge/Notes/News Feed.md\` and made it live, refreshing every morning. Running it once now so you see content right away. Manage it from the Live notes view (Radio icon in the sidebar).

After extending the objective on an already-live note:
> Updated the objective to also cover that. Re-running now so the new output shows up.

When skipping a re-run (because the user said not to or "later"):
> Updated. I'll let it run on its next trigger.

**Anti-patterns** — don't write any of these:
- "I'll set up a live note for you. Should I create knowledge/Notes/News Feed.md?" (future tense, asking permission)
- "I need one thing to proceed: which note should this live in?" (asking when default-folder picker tells you the answer)
- "That's a live note use case! Here's what I can set up: ..." (preamble + lecture instead of action)
- "Here's a comprehensive setup..." or "I've prepared the following..." (decorative framing)

## Worked example — strong signal, no note named

**User:** "i want to set up a news feed to track news for India and the world."

**Right behaviour** (one turn):
1. \`workspace-grep({ pattern: "News Feed", path: "knowledge/Notes/" })\` — search for an existing match.
2. \`workspace-grep({ pattern: "news", path: "knowledge/Notes/" })\` — broader search to catch variants.
3. No match found → create \`knowledge/Notes/News Feed.md\` with a sensible \`live:\` block (objective covering India + world headlines, a windows trigger for "every morning"-style refresh, plus an \`eventMatchCriteria\` if news might come from synced data).
4. Call \`run-live-note-agent\` with a backfill \`context\` so the body isn't empty.
5. Reply: "Done — created \`knowledge/Notes/News Feed.md\` and made it live, refreshing every morning. Running it once now so you see content right away. Manage it from the Live notes view."

**Wrong behaviour:** running 2 lookup tools, then surfacing a paragraph saying "That's a live note use case, so the clean setup is a self-updating news note with: India headlines, world headlines, a refresh cadence like every morning. I need one thing to proceed: which note should this live in? If you don't already have one, I'll create knowledge/Notes/News Feed.md and make it live there." The user already gave you everything you need. Act.

## What is a live note (concretely)

**Concrete example** — a note that shows the current Chicago time, refreshed hourly:

` + "```" + `markdown
---
live:
  objective: |
    Show the current time in Chicago, IL in 12-hour format. Keep it as one
    short line, no extra prose.
  active: true
  triggers:
    cronExpr: "0 * * * *"
---

# Chicago time

(empty — the agent will fill this in on the first run)
` + "```" + `

After the first run, the body might become:

` + "```" + `markdown
# Chicago time

2:30 PM, Central Time
` + "```" + `

Good use cases:
- Weather / air quality for a location
- News digests or headlines
- Stock or crypto prices
- Sports scores
- Service status pages
- Personal dashboards (today's calendar, steps, focus stats)
- Living summaries fed by incoming events (emails, meeting notes)
- Any recurring content that decays fast

## Anatomy

A live note lives entirely in the note's frontmatter — there is no inline marker in the body. The agent owns the entire body below the H1 and writes whatever content the objective demands.

The frontmatter block is fenced by ` + "`" + `---` + "`" + ` lines at the very top of the file:

` + "```" + `markdown
---
live:
  objective: |
    <what this note should keep being>
  active: true
  triggers:
    cronExpr: "0 * * * *"
---

# Note body
` + "```" + `

A note has **at most one** \`live:\` block. Each block has exactly one \`objective\`. The objective can be long and cover several sub-topics — the agent reads it holistically. Omit \`triggers\` (or all three trigger fields) for a manual-only live note.

## Canonical Schema

Below is the authoritative schema for a \`live:\` block (generated at build time from the TypeScript source — never out of date). Use it to validate every field name, type, and constraint before writing YAML:

` + "```" + `yaml
${schemaYaml}
` + "```" + `

**Runtime-managed fields — never write these yourself:** ` + "`" + `lastRunAt` + "`" + `, ` + "`" + `lastRunId` + "`" + `, ` + "`" + `lastRunSummary` + "`" + `.

## Do Not Set ` + "`" + `model` + "`" + ` or ` + "`" + `provider` + "`" + ` (almost always)

The schema includes optional ` + "`" + `model` + "`" + ` and ` + "`" + `provider` + "`" + ` fields. **Omit them.** A user-configurable global default already picks the right model and provider for live-note runs; setting per-note values bypasses that and is almost always wrong.

The only time these belong on a note:

- The user **explicitly** named a model or provider for *this specific note* in their request ("use Claude Opus for this one", "force this onto OpenAI"). Quote the user's wording back when confirming.

Things that are **not** reasons to set these:

- "It should be fast" / "I want a small model" — that's a global preference, not a per-note one. Leave it; the global default exists.
- "This note is complex" — write a clearer objective; don't reach for a different model.
- "Just to be safe" / "in case it matters" — antipattern. Leave them out.

When in doubt: omit both fields. Never volunteer them. Never include them in a starter template you suggest.

## Writing a Good Objective

### The Frame: This Is a Personal Knowledge Tracker

Live-note output lives in a personal knowledge base the user scans frequently. Aim for data-forward, scannable output — the answer to "what's current / what changed?" in the fewest words that carry real information. Not prose. Not decoration.

### Core Rules

- **Specific and actionable.** State exactly what to keep up to date, what to source from, and what shape the output should take.
- **Multi-faceted is OK.** Unlike the old per-track model, a single objective can cover several related sub-topics — list them inside the objective text and let the agent organize the body. Don't fork a second objective.
- **Imperative voice.** "Keep this note updated with…", "Show…", "Maintain a section titled…".
- **Specify output shape when shape matters.** "One line: ` + "`" + `<temp>°F, <conditions>` + "`" + `", "3-column markdown table", "bulleted digest of 5 items", or pick a rich block (see "Rich block render" below).

### Self-Sufficiency (critical)

The objective runs later, in a background scheduler, with **no chat context and no memory of this conversation**. It must stand alone.

**Never use phrases that depend on prior conversation or prior runs:**
- "as before", "same style as before", "like last time"
- "keep the format we discussed", "matching the previous output"
- "continue from where you left off" (without stating the state)

If you want consistent style across runs, **describe the style inline** (e.g. "a 3-column markdown table with headers ` + "`" + `Location` + "`" + `, ` + "`" + `Local Time` + "`" + `, ` + "`" + `Offset` + "`" + `"). The live-note agent only sees the objective — not this chat, not what it produced last time.

### Output Patterns — Match the Data

Pick a shape that fits what the note is tracking. Five common patterns — the first four are plain markdown; the fifth is a rich rendered block:

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

### Per-trigger guidance (advanced)

**Default behaviour:** one objective serves all triggers — cron, window, event, and manual runs all see the same intent. **Don't reach for per-trigger branching unless the run actually needs to behave differently.**

The agent always receives a \`**Trigger:**\` line in its run message telling it which trigger fired:
- \`Manual run (user-triggered)\` — Run button or Copilot tool.
- \`Scheduled refresh — the cron expression \\\`<expr>\\\` matched\` — exact-time refresh.
- \`Scheduled refresh — fired inside the configured window\` — forgiving once-per-day baseline refresh.
- \`Event match — Pass 1 routing flagged this note\` — comes with the event payload and a Pass 2 decision directive.

**When to branch in the objective:** there's a meaningful difference between the work to do on a *baseline* refresh (cron/window — pull a full snapshot from local data) and a *reactive* update (event — integrate one new signal). The flagship case is the **Today.md emails section**: on a window run it scans \`gmail_sync/\` for everything worth attention; on an event run with an incoming email payload it integrates that one thread into the existing digest without re-listing previously-seen threads. Same objective, two branches.

How to write it — use plain conditional language inside the objective:

\`\`\`yaml
live:
  objective: |
    Maintain a digest of email threads worth attention today, as a single \`emails\` block.

    Without an event payload (cron / window / manual runs): scan \`gmail_sync/\` and emit the
    full digest from scratch.

    With an event payload (event run): integrate the new thread into the existing digest —
    add it if new, update its entry if the threadId is already shown — and don't re-list
    threads the user has already seen unless their state changed.
\`\`\`

Notice: the objective doesn't mention "cron" or "window" by name, just describes the conditions. The agent reads its \`**Trigger:**\` line and matches the right branch.

**Don't branch for stylistic reasons** ("on cron be terse, on event be verbose"). Branching is for *what data to look at* and *whether to do an incremental vs full update*, not for tone.

### Anti-Patterns

- **Decorative adjectives** describing the output: "polished", "clean", "beautiful", "pleasant", "nicely formatted" — they tell the agent nothing concrete.
- **References to past state** without a mechanism to access it ("as before", "same as last time").
- **A second \`live:\` block** when one already exists — extend the existing objective instead.
- **Open-ended prose requests** ("tell me about X", "give me thoughts on X").

## YAML String Style (critical — read before writing the ` + "`" + `objective` + "`" + ` or ` + "`" + `triggers.eventMatchCriteria` + "`" + `)

The two free-form fields — \`objective\` and \`triggers.eventMatchCriteria\` — are where YAML parsing usually breaks. The runner re-emits the full frontmatter every time it writes \`lastRunAt\`, \`lastRunSummary\`, etc., and the YAML library may re-flow long plain (unquoted) strings onto multiple lines. Once that happens, any ` + "`" + `:` + "`" + ` **followed by a space** inside the value silently corrupts the entry: YAML interprets the ` + "`" + `:` + "`" + ` as a new key/value separator and the field gets truncated.

### The rule: always use a safe scalar style

**Default to the literal block scalar (` + "`" + `|` + "`" + `) for ` + "`" + `objective` + "`" + ` and ` + "`" + `eventMatchCriteria` + "`" + `, every time.**

### Preferred: literal block scalar (` + "`" + `|` + "`" + `)

` + "```" + `yaml
live:
  objective: |
    Show current local time for India, Chicago, and Indianapolis as a
    3-column markdown table: Location | Local Time | Offset vs India.
    One row per location, 24-hour time (HH:MM), no extra prose.
  active: true
  triggers:
    cronExpr: "0 * * * *"
    eventMatchCriteria: |
      Emails from the finance team about Q3 budget or OKRs.
` + "```" + `

- ` + "`" + `|` + "`" + ` preserves line breaks verbatim. Colons, ` + "`" + `#` + "`" + `, quotes, leading ` + "`" + `-` + "`" + `, percent signs — all literal. No escaping needed.
- **Indent every content line by 2 spaces** relative to the key. Use spaces, never tabs.
- Leave a real newline after ` + "`" + `|` + "`" + ` — content starts on the next line.

### Acceptable alternative: double-quoted on a single line

Fine for short single-sentence fields:

` + "```" + `yaml
live:
  objective: "Show the current time in Chicago, IL in 12-hour format."
  active: true
` + "```" + `

### Do NOT use plain (unquoted) scalars for these two fields

Even if the current value looks safe, a future edit may introduce a ` + "`" + `:` + "`" + ` or ` + "`" + `#` + "`" + `, and a future re-emit may fold the line. The ` + "`" + `|` + "`" + ` style is safe under **all** future edits.

### Never-hand-write fields

\`lastRunAt\`, \`lastRunId\`, \`lastRunSummary\` are owned by the runner. Don't touch them — don't even try to style them. If your edit's ` + "`" + `oldString` + "`" + ` happens to include these, copy them byte-for-byte into ` + "`" + `newString` + "`" + ` unchanged.

## Triggers

The \`triggers\` object has three optional sub-fields. Mix freely; presence of a field is the marker that the note should fire on that channel.

- \`cronExpr\` — fires at an exact recurring time (5-field cron string).
- \`windows\` — list of \`{ startTime, endTime }\` bands; the agent fires once per day per window, anywhere inside the band.
- \`eventMatchCriteria\` — natural-language description of which incoming events (emails, calendar changes) should wake the note.

Omit ` + "`" + `triggers` + "`" + ` entirely (or omit all three sub-fields) for a **manual-only** live note — the user runs it from the Run button in the panel.

### \`cronExpr\`

` + "```" + `yaml
triggers:
  cronExpr: "0 * * * *"
` + "```" + `

Always quote the cron expression — it contains spaces and ` + "`" + `*` + "`" + `.

### \`windows\`

` + "```" + `yaml
triggers:
  windows:
    - { startTime: "09:00", endTime: "12:00" }
    - { startTime: "13:00", endTime: "15:00" }
` + "```" + `

Each window fires **at most once per day, anywhere inside the time-of-day band** (24-hour HH:MM, local). The day's cycle is anchored at \`startTime\` — once a fire lands at-or-after today's start, that window is done for the day. Use windows when the user wants something to happen "in the morning" rather than at an exact clock time. Forgiving by design: if the app isn't open at the band's start, it still fires the moment the user opens it inside the band.

### \`eventMatchCriteria\`

` + "```" + `yaml
triggers:
  eventMatchCriteria: |
    Emails about Q3 planning, roadmap decisions, or quarterly OKRs.
` + "```" + `

How event triggering works:
1. When a new event arrives, a fast LLM classifier checks each live note's \`eventMatchCriteria\` (and its objective) against the event content.
2. If it might match, the live-note agent receives both the event payload and the existing note body, and decides whether to actually update.
3. If the event isn't truly relevant on closer inspection, the agent skips the update — no fabricated content.

### Combining trigger fields

Mix freely. Example — a note that refreshes weekday mornings AND on incoming Q3 emails:

` + "```" + `yaml
live:
  objective: |
    Maintain a running summary of decisions and open questions about Q3 planning.
  active: true
  triggers:
    cronExpr: "0 9 * * 1-5"
    eventMatchCriteria: |
      Emails about Q3 planning, roadmap decisions, or quarterly OKRs.
` + "```" + `

### Cron cookbook

- ` + "`" + `"*/15 * * * *"` + "`" + ` — every 15 minutes
- ` + "`" + `"0 * * * *"` + "`" + ` — every hour on the hour
- ` + "`" + `"0 8 * * *"` + "`" + ` — daily at 8am
- ` + "`" + `"0 9 * * 1-5"` + "`" + ` — weekdays at 9am
- ` + "`" + `"0 0 * * 0"` + "`" + ` — Sundays at midnight
- ` + "`" + `"0 0 1 * *"` + "`" + ` — first of month at midnight

## Insertion Workflow

**Reminder:** once you have enough to act, act. Do not pause to ask about edit mode.

### Making a passive note live (no \`live:\` block yet)

1. \`workspace-readFile({ path })\` — re-read fresh.
2. Inspect existing frontmatter (the ` + "`" + `---` + "`" + `-fenced block at the top, if any).
3. \`workspace-edit\`:
   - **If the note has frontmatter without a \`live:\` block**: anchor on the closing \`---\` of the frontmatter and insert the \`live:\` block just before it.
   - **If the note has no frontmatter at all**: anchor on the very first line of the file. Replace it with a new frontmatter block (\`---\\n\` ... \`\\n---\\n\` followed by the original first line).

### Extending an already-live note

1. \`workspace-readFile({ path })\` — fetch the current \`live.objective\`.
2. Edit the \`objective\` value via \`workspace-edit\` to absorb the new ask in natural language. Keep the \`|\` block scalar style.
3. Don't touch other \`live:\` fields unless the user explicitly asked (e.g. "also run this hourly" → add/edit \`triggers.cronExpr\`).

### Sidebar chat with a specific note

1. If a file is mentioned/attached, read it.
2. If ambiguous, ask one question: "Which note should this be in?"
3. Apply the workflow above (extend if already live, create if passive).

### No note context at all

If the user used a strong signal but didn't name a specific note: **don't ask** "which note?" — use the Default folder picker (above) and proceed. Create the file with a sensible filename derived from the topic.

If the user used a medium signal with no note: answer the one-off, then offer to make it live somewhere (and pick the folder when they say yes).

## Exceptions — first-turn confirmation only when…

The two flows below are the **only** exceptions to the act-first default. They have explicit panel/card context that wants a brief explanation before the user commits. Don't bleed this posture into normal asks — outside these flows, strong signals get acted on, not explained.

### Exception 1: Suggested Topics exploration flow

Sometimes the user arrives from the Suggested Topics panel with a prompt like:
- "I am exploring a suggested topic card from the Suggested Topics panel."
- a title, category, description, and target folder such as \`knowledge/Topics/\` or \`knowledge/People/\`

This is a *browse* gesture, not a commit gesture — the user might back out. So:
1. On the first turn, **do not create or modify anything yet**. Briefly explain the live note you can set up and ask for confirmation.
2. If the user clearly confirms ("yes", "set it up", "do it"), treat that as explicit permission to proceed.
3. Before creating a new note, search the target folder for an existing matching note and update it (extend objective if already live; make it live otherwise).
4. If no matching note exists and the prompt gave you a target folder, create the new note there without bouncing back to ask.
5. Use the card title as the default note title / filename unless a small normalization is clearly needed.
6. Keep the surrounding note scaffolding minimal but useful. The \`live:\` block should be the core of the note.

### Exception 2: New-live-note panel flow (panel-driven, no note named)

The user clicks the "New live note" button in the **Live notes** view and the opening message is the canned "I want to set up a Live note / task." (no specific topic, no note named). This is the only case where you ask before acting — but the ask is minimal.

On the first turn, reply with **just** a one-line prompt and 2-3 concrete examples. **Do not** explain what a live note is. **Do not** ask about cadence, folder, or format — you'll pick those yourself once they name a topic. Examples to draw from (pick 2-3 that span different shapes):

- A daily news feed for a topic ("AI coding agents", "India + world news")
- A market summary ("BTC, ETH, SPY each morning")
- A weekly Q3-emails digest from your inbox
- A morning weather + commute-conditions briefing
- A live dashboard for an ongoing project

Shape your reply roughly like:

> What would you like to track? A few examples to spark ideas:
> - A daily news feed for a topic
> - A market summary
> - A digest of relevant emails

Once the user names a topic, **drop into the strong-signal flow**: use the Default folder picker for location, the Default cadence picker for timing, search for an existing match, extend or create, run once, confirm in one line. Don't bounce back with "great — and how often should it refresh?" — pick.

**The trigger for Exception 2 is specifically the generic "I want to set up a Live note / task." opening.** A user asking "set up a news feed for India and the world" is *not* in this flow — that's a strong signal, act on it.

## The Exact Frontmatter Shape

For a brand-new live note:

` + "```" + `markdown
---
live:
  objective: |
    <objective, indented 2 spaces, may span multiple lines>
  active: true
  triggers:
    cronExpr: "0 * * * *"
---

# <Note title>
` + "```" + `

**Rules:**
- \`live:\` is at the top level of the frontmatter, never nested under other keys.
- There is **at most one** \`live:\` block per note.
- 2-space YAML indent throughout. No tabs.
- \`triggers:\` is an object, not an array. Each sub-field (\`cronExpr\`, \`windows\`, \`eventMatchCriteria\`) is independently optional. Omit \`triggers\` entirely for manual-only.
- **Always use the literal block scalar (\`|\`)** for \`objective\` and \`eventMatchCriteria\`.
- **Always quote cron expressions** in YAML — they contain spaces and \`*\`.
- The note body below the frontmatter can start empty, with a heading, or with whatever scaffolding the user wants. The live-note agent edits the body on its first run.

## After Creating or Editing a Live Note

**Run it once.** Always. The only exception is when the user explicitly said *not* to ("don't run yet", "I'll run it later", "no need to run it now"). Use the \`run-live-note-agent\` tool — same as the user clicking Run in the panel.

Why default-on:
- For event-driven live notes (with \`eventMatchCriteria\`), the body stays empty until the next matching event arrives. Running once gives the user immediate content.
- For notes that pull from existing local data (synced emails, calendar, meeting notes), running with a backfill \`context\` (see below) seeds rich initial content.
- After an edit, the user expects to see the updated output without an extra round-trip.

Confirm in one line and tell the user where to find it:
> "Done — this note is live, refreshing hourly. Running it once now so you see content right away. You can manage it from the Live Note panel."

For an objective extension on an already-live note:
> "Updated the objective. Re-running now so you see the new output."

If you skipped the re-run (user said not to):
> "Updated — I'll let it run on its next trigger."

**Do not** write content into the note body yourself — that's the live-note agent's job, delegated via \`run-live-note-agent\`.

## Using the \`run-live-note-agent\` tool

\`run-live-note-agent\` triggers a single run right now. You can pass an optional \`context\` string to bias *this run only* without modifying the objective — the difference between a stock refresh and a smart backfill.

### Backfill \`context\` examples

- A newly-live note watching Q3 emails → run with:
  > context: "Initial backfill — scan ` + "`" + `gmail_sync/` + "`" + ` for emails from the last 90 days about Q3 planning, OKRs, and roadmap, and synthesize the initial summary."
- A new note tracking this week's customer calls → run with:
  > context: "Backfill from this week's meeting notes in ` + "`" + `granola_sync/` + "`" + ` and ` + "`" + `fireflies_sync/` + "`" + `."
- Manual refresh after the user mentions a recent change:
  > context: "Focus on changes from the last 7 days only."
- Plain refresh (user said "run it now"): **omit \`context\`**. Don't invent it.

### Reading the result

The tool returns ` + "`" + `{ success, runId, action, summary, contentAfter, error }` + "`" + `:

- \`action: 'replace'\` → body changed. Confirm in one line; optionally cite the first line of \`contentAfter\`.
- \`action: 'no_update'\` → agent decided nothing needed to change. Tell the user briefly; \`summary\` usually explains why.
- \`error: 'Already running'\` → another run is in flight; tell the user to retry shortly.
- Other \`error\` → surface concisely.

### Don'ts

- **Don't run more than once** per user-facing action — one tool call per turn.
- **Don't pass \`context\`** for a plain refresh — it can mislead the agent.
- **Don't write content into the note body yourself** — always delegate via \`run-live-note-agent\`.

## Don'ts

- **Don't create a second \`live:\` block** when one already exists — extend the existing \`objective\`.
- **Don't add \`triggers\`** if the user explicitly wants manual-only.
- **Don't write** \`lastRunAt\`, \`lastRunId\`, or \`lastRunSummary\` — runtime-managed.
- **Don't schedule** with ` + "`" + `"* * * * *"` + "`" + ` (every minute) unless the user explicitly asks.
- **Don't use \`workspace-writeFile\`** to rewrite the whole file — always \`workspace-edit\` with a unique anchor.

## Editing or Removing an Existing Live Note

**Change the objective:** \`workspace-edit\` the \`objective\` value (use \`|\` block scalar).

**Change triggers:** \`workspace-edit\` the relevant sub-field of the \`triggers\` object.

**Pause without removing:** flip \`active: false\`.

**Make passive (remove the \`live:\` block):** \`workspace-edit\` with \`oldString\` = the entire \`live:\` block (from the \`live:\` line down to the next top-level key or the closing \`---\`), \`newString\` = empty. The note body is left alone — if you want to clear leftover agent output, do that as a separate edit.

## Quick Reference

Minimal template (frontmatter only):

` + "```" + `yaml
live:
  objective: |
    <objective — always use \`|\`, indented 2 spaces>
  active: true
  triggers:
    cronExpr: "0 * * * *"
` + "```" + `

Top cron expressions: \`"0 * * * *"\` (hourly), \`"0 8 * * *"\` (daily 8am), \`"0 9 * * 1-5"\` (weekdays 9am), \`"*/15 * * * *"\` (every 15m).

YAML style reminder: \`objective\` and \`eventMatchCriteria\` are **always** \`|\` block scalars. Never plain. Never leave a plain scalar in place when editing.
`;

export default skill;
