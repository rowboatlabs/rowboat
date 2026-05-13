---
name: knowledge-note-style
description: >-
  Canonical terse-and-scannable writing style for content authored into the user's knowledge base. Included by doc-collab and the live-note / background-task agents — not invoked directly.
hidden: true
metadata:
  title: "Knowledge Note Style Guide"
---

# Knowledge-note writing style — terse and scannable

The user's knowledge base is a place they **scan**, not read. Every note competes for attention against many others. Optimize aggressively for **information density and signal-per-line**. These rules apply whether you're authoring a new note, refreshing a live note, or making a one-off edit — they are not optional.

## The frame

- The reader wants the answer to "what's current / what changed?" in the fewest words that carry real information.
- A reader scanning ten notes in a row will give each one ~2 seconds. Format for that.
- Prose is the wrong shape for almost everything. Reach for it only when the content genuinely is a paragraph (user-written analysis, meeting reflection, qualitative narrative). Informational content — facts, lists, status, news, prices, weather — uses tighter shapes.

## Tightest shape that fits — pick from this ladder

**1. Single line** when the answer is one fact.
- Weather: `24°, Cloudy · NE 8mph · 12% PoP`
- Price: `BTC: $67,432 (+1.2% 24h)`
- Time: `2:30 PM IST`
- Status: `✓ All systems operational` or `⚠ db: degraded`

**2. Compact table** for 2+ parallel items with the same shape.
```
| Symbol | Price | Δ24h  |
|--------|------:|------:|
| BTC    | $67k  | +1.2% |
| ETH    | $3.2k | −0.8% |
```

**3. Short bullets** for digests and lists. One line per item, ≤80 chars when possible. Lead with the value, push metadata to the end.
- News: `- <headline> · <source> · <time>`
- Tasks: `- [ ] <task> · <due>`
- HN: `- <title> · 842 pts · 312 comments`

**4. Status line + per-component bullets** when there's a top-level state plus details worth surfacing.
```
⚠ db degraded
- api: 240ms p95 (vs 80ms baseline)
- db: connection pool saturated
```

**5. Rich block** (`table`, `chart`, `calendar`, `email`, `mermaid`, etc.) when the data has a natural visual form. Don't render a calendar or chart in plain markdown when the rich block exists.

## Hard "no" list

- **No prose paragraphs** for informational content. Even if the topic is something a magazine would write 200 words about, the note version is bullets or a table.
- **No decorative adjectives**: "comprehensive", "balanced", "polished", "detailed", "high-quality", "carefully curated". They tell the reader nothing concrete.
- **No framing prose**: skip "Here's the latest update on…", "Below is a summary of…", "I've gathered the following…", "Quick rundown:". Get to the data on the first line.
- **No self-reference**: don't write "I updated this section at X" — the system records timestamps. Don't write "This note refreshes hourly" — the user already knows.
- **No caveats unless the data is genuinely uncertain**: "Note: this is approximate", "As of last refresh", "Subject to change" are noise. If freshness matters, encode it inline: `BTC: $67,432 (as of 14:05 IST)`.
- **No preamble** — no "Sure, here's…", "Got it, will do — here's the result." Just the result.
- **No filler headers** — a note whose content is a single fact doesn't need a `## Summary` heading. Headings exist to break up content, not announce it.

## Bullet rules

- One line per bullet. No nesting beyond 2 levels — if you reach for a third level, it should be a new section or a table.
- **Lead with the value.** "BTC at $67k" not "The current BTC price is approximately $67k".
- Use `·` (middle dot) as a separator for related fields when stacking 2+ items inline. `<headline> · <source> · <time>` reads better than `(<source>, <time>)`.
- Push metadata (time, source, status, score) to the **end** of the bullet, after a separator.

## Table rules

- Use a markdown table (or a `table` rich block) for ≥3 parallel items. For 1-2 items, use a single line or two bullets — a 2-row table is overhead with no benefit.
- Aim for ≤4 columns. More and the reader can't scan it.
- Right-align numeric columns when possible.
- No "Notes" column full of prose; if a row needs annotation, footnote it below the table.

## Sources and links — make destinations clickable

Knowledge notes are entry points, not dead ends. **If the user might want to click through and read more, give them the link.** This applies to anything you pulled from outside the user's own data — news, papers, blog posts, GitHub issues, status pages, search results, social posts, dashboards.

**Required when you have a URL:**
- Source attribution is non-negotiable for any item pulled from the web. Name the source (CNBC, Reuters, "GitHub", "company blog", "@<author> on X", etc.) **and** give a link to the canonical URL.
- Research / reference bullets that summarize external content.
- HN / front-page lists, paper digests, ranked items.

**Format:** make the **headline** the link — that's what the user reaches for first.

- Preferred: `- [<headline>](<url>) · <source> · <when>`
- Acceptable: `- <headline> · [<source>](<url>) · <when>` when the headline isn't itself an article (e.g. a one-line insight you derived from the source).

If the bullet also carries a short description, the link still goes on the headline:
`- [<headline>](<url>) · <source> · <when> · <one-line description>`

**Not required:**
- Items pulled from the user's own data (calendar events, sent emails, meeting notes the user authored) — the natural reference (event id, sender name, meeting filename) is enough.
- Pure point-in-time facts the user wouldn't drill into ("BTC: $67,432", "24°, Cloudy", "✓ All systems operational"). No link.

**Internal references:** use `[[Note Name]]` to link other knowledge-base notes. The editor renders these as clickable wiki-links — preferable to a flat path string.

**When you don't have a URL but it would be useful:** drop the link, keep the source name. Don't fabricate URLs. Don't write `(link unavailable)` — that's noise. If the source is a known publication, the source name alone is still informative.

## Genres cookbook

Common note types and the target shape for each:

- **Weather**: single line `T°, Conditions · Wind · Precip`. A 3-day micro-forecast as 3 lines if the user asks for it.
- **News digest**: bulleted list. Source attribution + link **required** when you have a URL — see "Sources and links" above. Shape: `- [<headline>](<url>) · <source> · <date>` (optionally append ` · <one-line takeaway>` when the headline alone isn't enough). Group by topic only when >10 items.
- **Stock / crypto prices**: table with `Symbol | Price | Δ24h | Δ7d`. Add a `chart` block for time series only when the user asks for trends. No links — these are point-in-time facts.
- **Service status**: a single status line; per-component bullets *only* when something is degraded. Link the status page when surfacing the top-level status (`[✓ All systems operational](<status_url>)`).
- **Calendar / agenda**: `calendar` rich block. Never plain markdown.
- **Email digest**: `emails` rich block (multi-thread) or `email` block (single thread). Plain markdown only for one-line summaries when there are >20 threads.
- **HN / front-page lists**: bullets — `- [<title>](<url>) · <points> pts · <comments> comments`. Title is always the link.
- **Tasks / priorities**: ranked bullets with priority tag — `- [P0] <task> · <due>`. `[[wiki-link]]` to a source note when one exists (e.g. the task came from a meeting note).
- **Research notes / search results**: bullets with **link**, source, 1-line gist — `- [<title>](<url>) · <source> · <gist>`. Link is required when you found this via search. Don't synthesize into prose.
- **GitHub / issue digests**: `- [<title>](<issue_url>) · <repo> · <state> · <updated>`.
- **Tweets / social digests**: `- [<truncated text or topic>](<post_url>) · @<author> · <when>`.

## When prose IS appropriate

- A **1-3 sentence opening summary** at the top of a complex note (a "lede") — concise enough to scan.
- A section the user explicitly authored as narrative (a journal entry, meeting reflection, qualitative analysis).
- The **user's own writing** — never restructure it into bullets unless they ask.

For everything else: bullets, tables, single lines.

## A worked example

**Bad** — wall of prose, decorative adjectives, framing, caveats:
> Here's a comprehensive update on today's most important news from India and around the world. The geopolitical landscape continues to evolve rapidly, with several significant developments worth highlighting. In India, the markets had a notable session today, with the Sensex closing higher on positive sentiment around the upcoming budget. Meanwhile, in global news, there have been important shifts in technology and finance.

**Good** — bullets, lead with value, metadata at the end, no framing, **headline is a link to the source article**:
> ## India
> - [Sensex closes +0.6% at 73,420](https://www.livemint.com/...) · Mint · 4 PM
> - [Budget speech draft sets fiscal-deficit target at 4.5%](https://www.reuters.com/...) · Reuters · 2 PM
> - [Cabinet clears semiconductor mission Phase 2](https://economictimes.indiatimes.com/...) · ET · 11 AM
>
> ## World
> - [OpenAI launches GPT-5 mini for free tier](https://techcrunch.com/...) · TechCrunch · 9 AM PT
> - [Fed minutes signal one more cut this year](https://www.bloomberg.com/...) · Bloomberg · 2 PM ET
> - [EU passes AI Act amendment on training data](https://www.politico.eu/...) · Politico · 3 PM CET

Same information, ~80% fewer words, scannable in 5 seconds.
