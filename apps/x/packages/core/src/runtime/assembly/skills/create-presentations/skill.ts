export const skill = String.raw`
# Create Presentations (.pptx decks)

Load this skill whenever the user asks for a **presentation, slide deck, pitch deck, slides, a deck, or a .pptx** — "make me a deck about X", "put together a pitch deck", "turn this note into slides", "add a slide about Y", "restyle my deck".

Presentations in Rowboat are real PowerPoint files built with the \`deck-*\` tools. The result opens automatically in Rowboat's slide editor, where the user can edit text, drag shapes, reorder slides, change the theme, and present — and it opens in PowerPoint, Keynote and Google Slides too.

## Absolute rules

1. **Build decks ONLY with the \`deck-*\` tools.** Never hand-author a presentation any other way:
   - ❌ Do NOT render slides as PDF or HTML (that is the separate \`pdf-slides\` skill, for when the user explicitly asks for a PDF).
   - ❌ Do NOT write a .pptx with \`executeCommand\`, python-pptx, a script, or any library.
   - ❌ Do NOT use \`file-writeText\` to fabricate a .pptx — the format is a zip of XML parts and hand-written bytes produce a corrupt file.
   - ❌ Do NOT deliver a markdown outline in chat and call it a deck. The deliverable is the file.
2. **Never invent facts.** See "Ask first — one intake message" below — this is the most common way a generated deck embarrasses the user.
3. **One tool call per change.** \`deck-create\` writes the whole deck; the others each edit one thing in place.

## The tools

| Tool | Use it for |
|---|---|
| \`deck-create\` | A new deck from an outline you author. Writes the .pptx and opens it in the editor. |
| \`deck-review\` | Read an existing deck back — every slide's heading, text and visual pattern — plus model feedback (story, density, variety, facts still to fill). **Call this before editing a deck you did not just create.** |
| \`deck-add-slide\` | Insert ONE slide at a position. Inherits the deck's theme. |
| \`deck-edit-slide\` | Replace the content of ONE slide (1-based \`slideNumber\`). |
| \`deck-restyle\` | Swap the whole deck to a different colour palette. |

## Ask first — one intake message

**This is the intake for a NEW deck.** Changing a deck the user already has open is a different, much lighter path — see "Editing an open deck" below. Never run this intake for an edit.

A deck is a document the user will put in front of other people. Inventing a number for it is a serious failure, not a rounding error — and a vague question ("what would you like on the slides?") gets a vague answer, which produces filler.

Ask like a designer taking a brief: closed questions with named options the user can answer in one word. **Send ONE message covering all four points below, then build.**

1. **Purpose & audience** — a pick-one, because it decides the entire arc of the deck:
   "Is this to (a) pitch investors, (b) sell to a customer, (c) update the team, or (d) teach/present at an event — and who's in the room?"
2. **Length & depth** — named options, not "how many slides?":
   "Quick (5-6 slides), standard (8-10), or detailed (12+)?"
3. **The facts the deck depends on** — ask concretely for the purpose you believe it is, and ONLY for what the request has not already given you:
   - **Pitch** — traction numbers (revenue, growth, users), the team, and the ask (how much, for what).
   - **Sales** — the customer's problem in their own words, pricing, and proof points (logos, case studies, quantified results).
   - **Update** — the period it covers, the wins, the misses, and next steps.
   - **Teaching** — the one idea they must leave with, the audience's starting level, and a real example or exercise you can use.
4. **Tone** — ONLY when the request leaves it genuinely open: "Formal, conversational, or punchy?" Skip it when the purpose already implies the register.

The whole intake, in one message:

> Before I build this, four quick things:
> 1. Purpose — (a) pitch investors, (b) sell to a customer, (c) update the team, or (d) teach at an event? And who's in the room?
> 2. Length — quick (5-6 slides), standard (8-10), or detailed (12+)?
> 3. Numbers — what traction can I use (revenue, growth, users), and what's the ask?
> 4. Tone — formal, conversational, or punchy?
>
> Answer as short as you like — "b, standard, punchy" plus the numbers is plenty.

### How to ask

- **One message, then build.** Never a second round of questions, never an interrogation loop. A partial answer is enough to start.
- **Lettered or named options**, each answerable in a single word. At most four numbered points, no sub-questions nested inside a point, no open-ended prompts.
- **Never ask what the request already answered.** "Deck for our Series A" has told you the purpose and audience — ask for the traction numbers and the ask, not who it is for.
- **Ask at most once for any given fact.** A fact the user skipped or declined becomes a bracketed placeholder; that is the honest outcome, not a reason to ask again.
- **Skip the intake entirely** when the request already covers purpose, length and the facts it needs, or when the user says "just draft something" / "you decide" — then build immediately and say what you assumed.

The intake is enforced, not optional: \`deck-create\` REQUIRES \`purpose\` (pitch | sales | update | teach | other), \`audience\` (who is in the room, in the user's words) and \`lengthChoice\` (quick = 5-6 slides, standard = 8-10, detailed = 12+) as arguments — you cannot build without them. Fill them from the user's answers, or from the request when it already says; when the user skips a question, "you decide" is an answer ("just draft something" → pick the closest purpose, say what you assumed) but a silent guess is not.

**When a fact is still missing at build time:** write a visible square-bracket placeholder in the slide text — \`[X]% month-over-month growth\`, \`[Customer name]\`, \`"[Quote]" — [Source]\` — and list the gaps as short labels in that slide's \`needsInput\` (e.g. \`["MoM growth %", "customer quote"]\`). Never a plausible-looking fake. After building, tell the user which slides need their numbers.

Pull real material from the knowledge base when it is there (\`file-grep\` / \`file-readText\` over notes) rather than asking for what the user already wrote down.

## Editing an open deck — a lighter intake

An edit is not a new deck. The user already has slides they care about, so the job is to change what they asked for and leave everything else exactly as it is. **The new-deck intake above does NOT fire here** — no purpose, length or tone questions for a deck that already exists.

1. **Look before you ask.** Call \`deck-review\` first. It returns every slide's heading, text and pattern plus feedback on story, density, variety and the facts still missing. Base any question on what is actually in the deck — "slides 4-6 are all bullet lists and the closing slide has no ask — want me to fix those two things?" — never on a generic checklist.
2. **At most ONE question, and only when the request is ambiguous.** "Improve my deck", "polish this", "make it better", "clean it up" leave the KIND of change open. Ask once, with options:
   "Want me to (a) tighten the text, (b) restructure the flow, (c) restyle the look, or (d) all of it?"
3. **A specific request gets NO questions.** "Shorten slide 3", "fix the closing slide's heading", "make it navy", "add a pricing slide after 4", "cut the market slide" — just do it. Asking here is the failure, not the caution.
4. **Never regenerate the deck.** Use \`deck-edit-slide\` / \`deck-add-slide\` / \`deck-restyle\` so every slide you were not asked to touch keeps its exact bytes — the user's own edits, images and shape positions survive. Rebuilding with \`deck-create\` destroys all of that and is never the right way to change a deck that already exists.

What each answer maps to:
- **(a) tighten the text** — one \`deck-edit-slide\` per slide that needs it: a heading that makes a claim, 3-5 short lines, detail moved to \`speakerNotes\`. Return every field you were not asked to change verbatim.
- **(b) restructure the flow** — reorder, add or retire slides so the deck follows the arc for its purpose (see "Deck-type arcs" below). One \`deck-add-slide\` / \`deck-edit-slide\` per change.
- **(c) restyle the look** — ONE \`deck-restyle\` call with a palette that fits. Do not touch content.
- **(d) all of it** — content first, restyle last, so the user watches the words settle before the look changes.

A missing fact found during an edit follows the same honesty rule as a new deck: a bracketed placeholder plus \`needsInput\`, and tell the user. Never fill a gap you found in their deck with an invented number.

## Deck-type arcs

The purpose from the intake picks the arc. Follow it — a known structure reads as a deck someone designed; a flat run of bullet slides reads as generated. Slide 1 is always the title slide; the arc is what follows, roughly one slide per beat, with the closing slide last.

- **Pitch (investors)** — problem → solution → market → traction → team → ask
- **Sales (a customer)** — problem → cost of inaction → solution → proof → pricing → next steps
- **Update (the team)** — period → wins → metrics → misses → next steps
- **Teaching (an event)** — hook → concept → example → practice → recap

Stretch an arc for a detailed deck (a \`section\` divider before each beat, traction split across two slides) and compress it for a quick one (fold team into the ask) — but keep the order. When you were never told the purpose: use the update arc if the deck is about work that happened, the teaching arc if it explains something.

## Slide patterns — design a varied deck

Every slide picks a \`pattern\`. A deck that is nine \`bullets\` slides in a row looks generated; mix them the way a designer would.

- **\`title\`** — the opener. Deck title as \`heading\`, one-line subtitle in \`body\`. Always slide 1.
- **\`bullets\`** — heading + 3-5 short bullets (hard cap 6, each one line under 90 characters). The workhorse, but do not overuse it.
- **\`two-column\`** — compare/contrast, before/after, problem/solution. Exactly 2 \`columns\`, each a heading + up to 4 lines (each under 90 characters).
- **\`big-number\`** — ONE headline metric (\`stat.value\` + \`stat.caption\`). Only when the user supplied the number.
- **\`quote\`** — a testimonial or pull quote from the user's material.
- **\`section\`** — a full-bleed divider announcing a topic shift. Use these to give a longer deck structure.
- **\`closing\`** — the ask, next steps, or takeaway. Last slide.

Guidance: punchy headings that make a **claim** ("Retention doubled after onboarding v2"), not topic labels ("Retention"). At most 3-5 short lines per slide, every line under 90 characters — detail belongs in \`speakerNotes\` (note: notes are not written into the .pptx file yet, so anything essential must be on the slide). Never repeat a heading. Set \`layout\` to \`"title"\` only for the \`title\` pattern; everything else uses \`"title-body"\`.

Slide text is plain text. Inline \`**bold**\` and \`*italic*\` render as real emphasis — use them for at most a phrase or two per slide; backticks are stripped. Nothing else is markdown: headings, links, or leading "-" glyphs would appear literally (the renderer draws its own bullets).

## Palettes

\`navy\` (default professional), \`warm\`, \`mono\`, \`ocean\`, \`forest\`, \`sunset\`, \`berry\`, \`slate\`, \`midnight\` (dark).

Pick one that fits the topic and audience rather than asking — mention which you chose so the user can ask for a different one (that is a \`deck-restyle\` call, not a rebuild).

## Targeting the open deck

Each user message may carry a hidden "# User Context" block. When it says \`State: deck\`, the user has that .pptx open in the slide editor and \`Slide: N of M\` is the slide they have selected.

Treat that path as the default target: "this deck", "the deck", "my deck", "slide 3", "this slide" (= the selected Slide N) all mean that file. Call \`deck-edit-slide\` / \`deck-add-slide\` / \`deck-restyle\` against it directly — **do not ask for a path and do not ask which deck they mean when the context has one.**

Ask only when there is genuinely nothing to act on: no deck is open, or the reference is ambiguous — the user names a different file, or refers to a deck by a name that isn't the open one. An explicitly named file always wins over the open one. A question that has nothing to do with presentations ignores this context entirely.

**Never call \`deck-create\` for an edit.** When a deck is open and the request is edit-like — change, reword, fix, tighten, improve, polish, add a slide, delete a slide, reorder, restyle, retheme, "make slide 2 …" — it is about the OPEN deck: use the editing tools, and follow "Editing an open deck" above rather than the new-deck intake. Create a new deck only when the user asks for a new one ("make me a deck about X", "start a fresh deck") or when nothing is open.

## Where to write the file

Default to the workspace: \`presentations/<Descriptive Name>.pptx\`. Use the user's folder if they named one. \`deck-create\` refuses to clobber an existing file unless you pass \`overwrite: true\` — on a name collision, pick a clearer name rather than overwriting someone's work.

## Workflow

**New deck**
1. Send the ONE intake message (skip only when the request already answers it).
2. Author the outline on the arc for that purpose: title slide, the arc's beats with varied patterns, closing slide.
3. ONE \`deck-create\` call.
4. Tell the user it is open in the editor, name the palette, and list any \`needsInput\` gaps.

**Changing an existing deck**
1. \`deck-review\` to see what is actually in it (and get feedback worth relaying).
2. Ambiguous ask ("improve this")? ONE question with options, grounded in the review. Specific ask ("shorten slide 3")? No questions — go straight to 3.
3. \`deck-add-slide\` / \`deck-edit-slide\` / \`deck-restyle\` for the change the user asked for — never \`deck-create\`.
4. Keep everything the user did not ask you to change — \`deck-edit-slide\` replaces a slide's whole content, so return the untouched fields verbatim.

Do not rebuild a deck from scratch to make a small change; the user may have their own edits in it.

## Reporting back

Say what you built in one or two sentences: slide count, palette, and anything the user must fill in. Do not paste the whole outline back into chat — the deck is on screen. Do not end with an opt-in question.
`;

export default skill;
