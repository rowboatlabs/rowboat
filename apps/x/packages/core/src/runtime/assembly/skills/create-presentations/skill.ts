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
2. **Never invent facts.** See "Gather the real facts first" below — this is the most common way a generated deck embarrasses the user.
3. **One tool call per change.** \`deck-create\` writes the whole deck; the others each edit one thing in place.

## The tools

| Tool | Use it for |
|---|---|
| \`deck-create\` | A new deck from an outline you author. Writes the .pptx and opens it in the editor. |
| \`deck-review\` | Read an existing deck back — every slide's heading, text and visual pattern — plus model feedback (story, density, variety, facts still to fill). **Call this before editing a deck you did not just create.** |
| \`deck-add-slide\` | Insert ONE slide at a position. Inherits the deck's theme. |
| \`deck-edit-slide\` | Replace the content of ONE slide (1-based \`slideNumber\`). |
| \`deck-restyle\` | Swap the whole deck to a different colour palette. |

## Gather the real facts first

A deck is a document the user will put in front of other people. Inventing a number for it is a serious failure, not a rounding error.

**Before calling \`deck-create\`, ask in chat** — one short message, grouped questions:
- **Audience** — who is this for? (investors, the team, a customer, a conference)
- **Length** — roughly how many slides, or how long is the slot?
- **The facts the deck depends on** — metrics, dates, names, customer quotes, pricing. Ask for exactly what the deck's argument needs: "What growth numbers can you share?", "Do you have a customer quote I can use?"

Skip the questions ONLY when the request already answers all three, or when the user says "just draft something" / "you decide" — then draft with placeholders and say what you assumed.

**When a fact is still missing at build time:** write a visible square-bracket placeholder in the slide text — \`[X]% month-over-month growth\`, \`[Customer name]\`, \`"[Quote]" — [Source]\` — and list the gaps as short labels in that slide's \`needsInput\` (e.g. \`["MoM growth %", "customer quote"]\`). Never a plausible-looking fake. After building, tell the user which slides need their numbers.

Pull real material from the knowledge base when it is there (\`file-grep\` / \`file-readText\` over notes) rather than asking for what the user already wrote down.

## Slide patterns — design a varied deck

Every slide picks a \`pattern\`. A deck that is nine \`bullets\` slides in a row looks generated; mix them the way a designer would.

- **\`title\`** — the opener. Deck title as \`heading\`, one-line subtitle in \`body\`. Always slide 1.
- **\`bullets\`** — heading + 3-5 short bullets. The workhorse, but do not overuse it.
- **\`two-column\`** — compare/contrast, before/after, problem/solution. Exactly 2 \`columns\`, each a heading + up to 4 lines.
- **\`big-number\`** — ONE headline metric (\`stat.value\` + \`stat.caption\`). Only when the user supplied the number.
- **\`quote\`** — a testimonial or pull quote from the user's material.
- **\`section\`** — a full-bleed divider announcing a topic shift. Use these to give a longer deck structure.
- **\`closing\`** — the ask, next steps, or takeaway. Last slide.

Guidance: punchy headings that make a **claim** ("Retention doubled after onboarding v2"), not topic labels ("Retention"). At most 3-5 short lines per slide — detail belongs in \`speakerNotes\` (note: notes are not written into the .pptx file yet, so anything essential must be on the slide). Never repeat a heading. Set \`layout\` to \`"title"\` only for the \`title\` pattern; everything else uses \`"title-body"\`.

## Palettes

\`navy\` (default professional), \`warm\`, \`mono\`, \`ocean\`, \`forest\`, \`sunset\`, \`berry\`, \`slate\`, \`midnight\` (dark).

Pick one that fits the topic and audience rather than asking — mention which you chose so the user can ask for a different one (that is a \`deck-restyle\` call, not a rebuild).

## Where to write the file

Default to the workspace: \`presentations/<Descriptive Name>.pptx\`. Use the user's folder if they named one. \`deck-create\` refuses to clobber an existing file unless you pass \`overwrite: true\` — on a name collision, pick a clearer name rather than overwriting someone's work.

## Workflow

**New deck**
1. Ask the audience / length / facts questions (unless already answered).
2. Author the outline: title slide, a varied middle, a closing slide.
3. ONE \`deck-create\` call.
4. Tell the user it is open in the editor, name the palette, and list any \`needsInput\` gaps.

**Changing an existing deck**
1. \`deck-review\` to see what is actually in it (and get feedback worth relaying).
2. \`deck-add-slide\` / \`deck-edit-slide\` / \`deck-restyle\` for the change the user asked for.
3. Keep everything the user did not ask you to change — \`deck-edit-slide\` replaces a slide's whole content, so return the untouched fields verbatim.

Do not rebuild a deck from scratch to make a small change; the user may have their own edits in it.

## Reporting back

Say what you built in one or two sentences: slide count, palette, and anything the user must fill in. Do not paste the whole outline back into chat — the deck is on screen. Do not end with an opt-in question.
`;

export default skill;
