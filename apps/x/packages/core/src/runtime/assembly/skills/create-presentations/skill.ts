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

**Ask with the question card, never with prose.** The FIRST thing you do for a new-deck request is call \`ask-human\` — no preamble sentence, no "before I build this, four quick things", no lettered list typed into chat. \`ask-human\` renders each question as a card with pickable rows, and several calls issued in the SAME message queue into one card sequence ("1 of 2") the user clicks through. That sequence IS the "one intake message".

\`ask-human\`'s own description tells you not to spend a question on a low-stakes decision, and it is right — but this intake is precisely the high-stakes case the tool exists for. Purpose decides the entire arc of the deck, length decides how much you write, and the facts are the difference between a real deck and a fabricated one; \`deck-create\` will not even run without them. Tone and palette are the low-stakes half — never spend a card on those, choose them yourself.

### The questions, and their exact option sets

One question per \`ask-human\` call. Put every choice in \`options\` (hard cap 4) and NOTHING in the question text — the card renders \`options\` as pickable rows, while choices typed into the question string are dead prose the user cannot click. Leave \`multiSelect\` off (purpose and length are pick-one). Never add an "Other" or "Something else" option: the card always appends its own "Other (type your answer)" row, and that free-text row is where an unusual purpose or a specific audience arrives.

**1. Purpose** — single-select, exactly these four:

\`\`\`
ask-human({
  question: "What's this deck for?",
  options: ["Pitch investors", "Sell to a customer", "Update the team", "Teach or present"],
})
\`\`\`

Those four rows are the deck types — (a) pitch investors, (b) sell to a customer, (c) update the team, or (d) teach/present at an event — and they belong in \`options\`, never in the question text and never with a fifth "other" row bolted on.

**2. Length** — single-select, named depths rather than "how many slides?":

\`\`\`
ask-human({
  question: "How long should it be?",
  options: ["Quick — 5-6 slides", "Standard — 8-10 slides", "Detailed — 12+ slides"],
})
\`\`\`

The prose form — "Quick (5-6 slides), standard (8-10), or detailed (12+)?" — is exactly what must NOT go into \`question\`; it is the option set, and it maps straight onto \`lengthChoice\`.

**3. Audience and the facts the deck depends on** — ONE call with \`options\` omitted entirely, so the user types a free-form answer. Send it once the purpose is known (from their answer, or from the request when it already said), ask concretely for that deck type, and ask ONLY for what the request has not already given you. Fold "and who's in the room?" into the same question whenever the audience is still unknown — that one sentence is how \`audience\` gets filled:

- **Pitch** — traction numbers (revenue, growth, users), the team, and the ask (how much, for what).
- **Sales** — the customer's problem in their own words, pricing, and proof points (logos, case studies, quantified results).
- **Update** — the period it covers, the wins, the misses, and next steps.
- **Teaching** — the one idea they must leave with, the audience's starting level, and a real example or exercise you can use.

### How to ask

- **One message, then build.** Every question the request left open goes out as parallel \`ask-human\` calls in a SINGLE message, which the user answers as one card sequence — then you build. Never a second round once you have what you need, never an interrogation loop. A partial answer is enough to start.
- **At most two cards in a message, and at most two rounds — never a third.** When the request already tells you the purpose, ask length and the facts together and there is no second round at all. When it does not, ask purpose and length in the first message, then send the single facts question for the purpose they picked. Never more cards than the fields the user actually left open.
- **Never ask what the request already answered.** "Deck for our Series A" has told you the purpose and the audience — do not send those cards; ask for the traction numbers and the ask.
- **Ask at most once for any given fact.** A fact the user skipped or declined becomes a bracketed placeholder; that is the honest outcome, not a reason to ask again.
- **Skip is an answer, not a retry.** When the card comes back saying the user skipped, use your best judgment and proceed — never re-send that question, never rephrase it into a new one. A skipped purpose or length becomes the closest sensible default, stated out loud as an assumption; skipped facts become square-bracket placeholders with \`needsInput\`.
- **Tone never earns a card.** "Formal, conversational, or punchy?" is exactly the low-stakes decision \`ask-human\` tells you not to ask about — read the register off the purpose and audience, and say which one you chose. Same for the palette.
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
1. Send the intake as \`ask-human\` cards in ONE message — purpose and length as options, the per-purpose facts as an open question (skip any the request already answers, and the whole intake when it answers everything).
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
