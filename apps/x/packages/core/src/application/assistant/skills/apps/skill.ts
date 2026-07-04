export const skill = String.raw`
# Rowboat Apps

A *Rowboat app* is a static web application the user opens inside Rowboat — its
own UI on its own origin, powered by their integrations and (optionally) a
background agent. Apps live at \`~/.rowboat/apps/<folder-slug>/\` and are served
at \`http://<folder-slug>.apps.localhost:3210/\`.

## 0. Should this even be an app? (intent gate)

- **Strong — build it:** "make/build/create an app · dashboard for …", "turn
  this into an app".
- **Ambiguous — CONFIRM FIRST:** the request could be a one-off answer OR a
  reopenable app (e.g. "show me my open PRs", "track competitor launches").
  Ask once: *"Want this as an app you can reopen, or just a one-time answer?"*
  Build only on yes — building creates folders, possibly agents and OAuth
  prompts; too heavy for a casual question.
- **Clear one-off lookups:** just answer. Don't build.

## 1. The contract (files on disk)

\`\`\`
~/.rowboat/apps/<folder-slug>/
├── rowboat-app.json   # manifest (required)
├── dist/              # browser-ready files; served at / (index.html = entry)
├── agents/            # optional bundled agent definitions (*.yaml)
└── data/              # runtime data; read/written via the data API
\`\`\`

Folder slug: lowercase \`a-z0-9\` with single hyphens (e.g. \`pr-dashboard\`).
Minimal manifest (write it pretty-printed):

\`\`\`json
{
  "schemaVersion": 1,
  "name": "pr-dashboard",
  "version": "0.1.0",
  "description": "Open PRs across my repos",
  "capabilities": ["github"],
  "dataContracts": [
    { "file": "data.json", "requiredKeys": ["updatedAt", "items"], "nonEmptyArrayKeys": [] }
  ]
}
\`\`\`

- \`capabilities\`: every Composio toolkit slug the app calls via the tools API,
  plus \`"llm"\` and/or \`"copilot"\` if it uses those endpoints. **Undeclared
  capabilities are rejected at runtime** (403 \`capability_not_declared\`).
- \`dataContracts\`: shape guards for \`data/\` files an agent maintains — a
  wrong-shaped write is rejected and last-good data survives.

## 2. No-build rule

Write plain, browser-ready HTML/JS/CSS **directly into \`dist/\`** with your file
tools. CDN \`<script>\` tags are fine; use relative asset URLs. Never require a
bundler or build step. \`dist/index.html\` is the app root.

## 3. Host API (same-origin, under \`/_rowboat/\`)

Errors are \`{ "error": { "code", "message" } }\`. **Every non-GET request MUST
include the header \`X-Rowboat-App: 1\`** — requests without it are rejected
(anti-CSRF).

**App info + theme**
\`\`\`js
const info = await (await fetch('/_rowboat/app')).json();
// { name, version, folder, description, theme: 'light'|'dark' }
\`\`\`

**Data** (backing store: the app's \`data/\` folder)
\`\`\`js
// read
const data = await (await fetch('/_rowboat/data/data.json')).json();
// write (atomic; contract-checked when dataContracts matches the file)
await fetch('/_rowboat/data/data.json', {
  method: 'PUT',
  headers: { 'X-Rowboat-App': '1', 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
// list
const { entries } = await (await fetch('/_rowboat/data?list=.')).json();
\`\`\`

**Composio tools** (capability = the toolkit slug)
\`\`\`js
const { items } = await (await fetch('/_rowboat/tools/search', {
  method: 'POST', headers: { 'X-Rowboat-App': '1', 'Content-Type': 'application/json' },
  body: JSON.stringify({ toolkit: 'github', query: 'list pull requests' }),
})).json();
const result = await (await fetch('/_rowboat/tools/execute', {
  method: 'POST', headers: { 'X-Rowboat-App': '1', 'Content-Type': 'application/json' },
  body: JSON.stringify({ toolkit: 'github', slug: items[0].slug, arguments: { owner, repo, state: 'open' } }),
})).json();
\`\`\`

**Third-party HTTP** — see CORS below: always the proxy, never browser fetch.
\`\`\`js
const r = await (await fetch('/_rowboat/fetch', {
  method: 'POST', headers: { 'X-Rowboat-App': '1', 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'https://api.example.com/rates.json' }),
})).json(); // { ok, status, text, truncated } — parse r.text yourself
\`\`\`

**LLM generation** (capability \`llm\` — spends the user's tokens; use sparingly)
\`\`\`js
const { text } = await (await fetch('/_rowboat/llm/generate', {
  method: 'POST', headers: { 'X-Rowboat-App': '1', 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'Summarize: …', maxOutputTokens: 512 }),
})).json();
\`\`\`

**Copilot run** (capability \`copilot\`) — a FULL headless agent run: far
costlier than \`llm/generate\`, takes seconds-to-minutes (show a pending state).
Use only when tools or the user's knowledge are actually needed.
\`\`\`js
const { text, turnId } = await (await fetch('/_rowboat/copilot/run', {
  method: 'POST', headers: { 'X-Rowboat-App': '1', 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: '…' }),
})).json();
\`\`\`

## 4. Data conventions

- Durable state goes in \`data/\` via the data API — **never localStorage**
  (invisible to agents; doesn't survive reinstalls).
- Set a \`dataContracts\` entry for any file a bundled agent maintains.
- Live updates: the page auto-reloads when \`dist/\` changes. When something
  under \`data/\` changes, a **cancelable DOM event** fires first — subscribe and
  re-fetch in place so agent refreshes don't yank the page mid-scroll:
\`\`\`js
window.addEventListener('rowboat:data-change', (e) => {
  e.preventDefault();          // suppress the full reload
  refreshFromData();           // re-fetch /_rowboat/data/... and re-render
});
\`\`\`

## 5. Background agents (self-updating data)

When the user wants data refreshed on a schedule, create a background task
(\`create-background-task\`) whose instructions fetch the data (Composio tools,
or the \`fetch-url\` builtin for plain HTTP — **the bg-task agent has NO
shell**; never generate a refresh script) and store it via the
**\`app-set-data\`** builtin: \`{ appFolder, file: "data.json", data: <object> }\`
— pass the object directly, never \`JSON.stringify\` it. The write is atomic and
contract-checked; on a failed fetch keep the last good data (never overwrite
good series with empties). If the app should ship the agent, mirror the
definition into \`agents/<slug>.yaml\` with ONLY \`name\`, \`instructions\`,
\`triggers\`, and list the filename in \`manifest.agents\`.

## 6. Prohibitions

- Never write credentials or personal data anywhere in the app folder except
  \`data/\`.
- Never edit \`.rowboat-install.json\` or \`.rowboat-publish.json\`.
- Never put files under a \`/_rowboat/\` path inside \`dist/\`.

## 7. Verify wiring BEFORE building (required — do not speculate)

Ensure the needed toolkits are connected (prompt OAuth if not), then actually
call the intended tools yourself (\`composio-search-tools\` →
\`composio-execute-tool\`) and derive the data shape **from the real
responses** — never guess field names. That derived shape becomes the
\`dataContracts\` entry and the UI's contract.

## 8. CORS

From app code, call third-party APIs via \`/_rowboat/fetch\` — never the
browser's \`fetch\`. Most public APIs send no CORS headers, so a direct fetch
fails with "Failed to fetch" even though the endpoint works from curl.

## 9. Both themes (required)

Read \`theme\` from \`/_rowboat/app\` and subscribe to theme changes; style light
AND dark — never a hard-coded dark-only palette (\`prefers-color-scheme\` tracks
the OS, not Rowboat):
\`\`\`js
const events = new EventSource('/_rowboat/events');
events.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'theme') applyTheme(msg.theme);   // 'light' | 'dark'
});
\`\`\`

## 10. Agent model

Data/side-effect bg-tasks need a capable model — the default is too weak and
fabricates output or hallucinates tool names. Call \`list-models\` and set the
task's \`model\` to a strong ID from that list (its \`defaultModel\` is a safe
choice); never guess model IDs.

## 11. Verification loop

After writing files: tell the user the app URL
(\`http://<folder>.apps.localhost:3210/\`), note that edits hot-reload, and for
agent-backed apps trigger the agent once (\`run-background-task-agent\`) so data
exists before they open it. Then open it for them: \`app-navigation\` with
\`{ action: "open-app", appId: "<folder>" }\`.
`;

export default skill;
