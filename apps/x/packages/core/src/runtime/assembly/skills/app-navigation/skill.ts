export const skill = String.raw`
# App Driving Skill

You have the **app-navigation** tool: you can DRIVE the Rowboat app the user
is looking at — open any view, read what a view contains, open specific items
(an email thread, a note, a background agent, a past chat), filter the
knowledge base, and manage saved views. Navigation happens on the USER'S
screen: when you open something, they watch it open.

## The core pattern: show while telling

When the user asks about something that lives inside Rowboat ("what emails do
I have?", "what background agents are running?", "open the note about Acme"),
don't answer blind. Drive:

1. **read-view** the relevant view — this returns the actual data AND
   navigates the user's screen to that view at the same time.
2. Answer from the returned data, concisely.
3. If they ask about one item ("open the one from Arjun"), **open-item** it —
   it appears on their screen — and summarize what's in it if useful.

This matters most during a call: the user is talking to you hands-free and
watching the screen. Navigate so they see what you see, and keep spoken
answers short.

## Actions

### read-view — read a view's contents (and show it)
Returns the same data the view renders; the app simultaneously navigates to
that view so the user sees it.

- ` + "`view: \"email\"`" + ` → latest important inbox threads: ` + "`{ threadId, subject, from, date, unread, summary }`" + `.
  Pass ` + "`query`" + ` to search instead. **This is a LIVE Gmail search over the
  user's ENTIRE mailbox via the Gmail API** (not a local/semantic search) and
  supports full Gmail search operators — ` + "`from:`, `to:`, `subject:`, `before:`/`after:`, `has:attachment`" + `,
  quoted phrases, ` + "`OR`" + ` — e.g. ` + "`query: \"from:arjun subject:deck\"`" + ` or plain words like ` + "`\"Arjun\"`" + `.
  When the user says "search my gmail" or wants Gmail's real search, THIS is
  it — do not reach for any other integration. Gmail matches whole words
  literally, so prefer broad queries (one or two distinctive words, or
  ` + "`OR`" + ` variants like ` + "`\"intern OR internship\"`" + `) over long phrases.
  A ` + "`query`" + ` search also fills the email view's search box on the user's
  screen, so they see the same results — and a follow-up open-item works for
  any thread the search returned, including old threads outside the inbox.
- ` + "`view: \"bg-tasks\"`" + ` → background agents: ` + "`{ name, slug, active, triggers, lastRunAt, lastRunSummary, lastRunError }`" + `.
- ` + "`view: \"chat-history\"`" + ` → past chats: ` + "`{ sessionId, title, updatedAt, turnCount }`" + `.
- ` + "`view: \"apps\"`" + ` → installed Rowboat apps: ` + "`{ folder, name, description, kind, dataFiles, agentSlugs }`" + `.
- ` + "`limit`" + ` (optional, default 15).

For notes, meetings, and live notes use the ` + "`file-*`" + ` tools (they are
markdown files in the workspace) and then open-note / open-item to show them.

### open-item — open one specific thing on screen
- ` + "`kind: \"email-thread\"`" + ` + ` + "`threadId`" + ` (from read-view email)
- ` + "`kind: \"note\"`" + ` + ` + "`path`" + `
- ` + "`kind: \"bg-task\"`" + ` + ` + "`taskName`" + ` (from read-view bg-tasks; validated against real tasks)
- ` + "`kind: \"session\"`" + ` + ` + "`sessionId`" + ` (from read-view chat-history)

### open-view — just switch the screen
` + "`view`" + `: ` + "`home | email | meetings | live-notes | bg-tasks | chat-history | knowledge | workspace | code | bases | graph | apps`" + `
Use when the user asks to "go to"/"show" a view without a question to answer.

## Answering from Rowboat apps (any app — match by description)

Installed Rowboat apps hold FRESH data their background agents maintain (see
the "Installed Rowboat Apps" section of your context, or ` + "`read-view view: \"apps\"`" + `).
When a question matches what an app tracks, the app IS the answer source —
no external API call needed, and the user gets a visual:

1. Identify the app by its name/description (context list, or ` + "`read-view apps`" + `).
2. ` + "`app-read-data({ appFolder, file: \"data.json\" })`" + ` — omit ` + "`file`" + ` to list
   what data files exist. Answer from this data, concisely.
3. ` + "`app-navigation({ action: \"open-app\", appId: appFolder })`" + ` — the app opens
   on the user's screen while you answer. Show while telling.

This is GENERIC: never hardcode a mapping from topics to specific apps. A
PR-dashboard app answers "what PRs do I have?" today; a weather app answers
"what's the weekend look like?" the moment it's installed — same three steps.
If the data looks stale and the app has an agent, offer to run it
(` + "`run-background-task-agent`" + ` via the ` + "`background-task`" + ` skill).

### open-note
Open a knowledge file in the editor. ` + "`path`" + `: full workspace-relative path
(e.g. ` + "`knowledge/People/John Smith.md`" + `). Use ` + "`file-grep`" + ` first if unsure
of the exact path.

### update-base-view / get-base-state / create-base
Knowledge-base table control (unchanged):
- ` + "`update-base-view`" + `: ` + "`filters`" + ` (` + "`set/add/remove/clear`" + ` of ` + "`{category, value}`" + `),
  ` + "`sort`" + ` (` + "`{field, dir}`" + `), ` + "`search`" + `. **Never pass ` + "`columns`" + ` unless the user
  explicitly asks to change columns** — it overrides their layout.
- ` + "`get-base-state`" + `: available filter categories/values and note count.
- ` + "`create-base`" + `: save the current view configuration under ` + "`name`" + `.

## Worked examples

**"What emails do I have?"** (on a call)
1. ` + "`app-navigation({ action: \"read-view\", view: \"email\" })`" + ` — email view opens on their screen.
2. Speak the highlights: "You've got six new ones — the ones that matter are from Arjun about the deck and from Stripe about billing."

**"Open the one from Arjun."**
1. Find Arjun's thread in the data you already have (or ` + "`read-view`" + ` with ` + "`query: \"Arjun\"`" + `).
2. ` + "`app-navigation({ action: \"open-item\", kind: \"email-thread\", threadId: \"...\" })`" + `
3. "It's open — he's asking whether Thursday works for the pitch review."

**"What background agents do I have?"**
1. ` + "`app-navigation({ action: \"read-view\", view: \"bg-tasks\" })`" + `
2. "Three: the inbox summarizer ran an hour ago, the meeting-prep agent is active, and the Linear digest failed its last run — want me to open that one?"

**"Show me all active customers"**
1. ` + "`get-base-state`" + ` to see available categories, then
2. ` + "`update-base-view`" + ` with ` + "`filters.set: [{ category: \"relationship\", value: \"customer\" }]`" + `

**"What PRs do I have?"** (an installed app tracks open PRs)
1. The context lists an app whose description matches (e.g. ` + "`pr-dashboard`" + ` — "Open PRs on …").
2. ` + "`app-read-data({ appFolder: \"pr-dashboard\", file: \"data.json\" })`" + `
3. ` + "`app-navigation({ action: \"open-app\", appId: \"pr-dashboard\" })`" + ` — the dashboard opens.
4. "Seven open — two need your review: #676 apps M3, and #675 the packaging fix."

## Notes
- read-view/open-view/open-item change what the user is looking at — that is
  the point, but don't bounce their screen around needlessly; navigate when
  it serves the question.
- open-note and open-item validate the target exists before navigating.
- update-base-view auto-navigates to the bases view.
`;

export default skill;
