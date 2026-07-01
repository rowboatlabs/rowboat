import { z } from 'zod';
import { stringify as stringifyYaml } from 'yaml';
import { MiniAppManifest } from '@x/shared/dist/mini-app.js';

const manifestSchema = stringifyYaml(z.toJSONSchema(MiniAppManifest)).trimEnd();

export const skill = String.raw`
# Build a Mini App

A *Mini App* is a small app the user opens inside Rowboat — its own UI, powered by
their integrations and (optionally) a background agent. Apps live on disk at
\`~/.rowboat/apps/<id>/\` and are served at \`app://miniapp/<id>/\`:

\`\`\`
~/.rowboat/apps/<id>/
  manifest.json     # see schema below
  dist/index.html   # the app UI (self-contained), served via app://miniapp/<id>/
  data.json         # data the UI reads (produced by the app's agent; optional)
\`\`\`

You do NOT hand-write these files with file tools. Use **\`mini-app-install\`** to
write the folder, and **\`create-background-task\`** for the optional agent.

## 0. Should this even be an app? (intent gate)

- **Strong — build it:** "make/build/create an app · mini app · dashboard for …",
  "turn this into an app".
- **Medium — CONFIRM FIRST:** the request could be a one-off answer OR a recurring
  app (e.g. "show me my open PRs", "track competitor launches"). Ask once:
  *"Want this as a Mini App you can reopen, or just a one-time answer?"* Build only
  if they say app. (Building installs a folder, maybe a background agent, and may
  prompt an OAuth connection — too heavy for a casual question.)
- **Anti — don't build:** a clear one-off lookup/question → just answer it.

## 1. Scope the app

Decide: \`id\` (kebab slug), \`title\`, \`description\`, \`source\` (e.g. "GitHub"),
the Composio \`scope\` (toolkits it may use), and whether it is:
- **live** — calls Composio when the user interacts (no agent), or
- **agent-backed** — a background agent refreshes \`data.json\` on a schedule and the
  UI just reads it (keeps tokens low; best for feeds/digests/dashboards).

## 2. Verify the wiring BEFORE building (required — do not speculate)

Load the \`composio-integration\` skill. Then for each toolkit in scope:
1. Ensure it is connected (\`composio-connect-toolkit\` → user authorizes if needed).
2. Actually call the tools you intend to use (\`composio-search-tools\` →
   \`composio-execute-tool\`) and **inspect the real returned JSON**.
3. Derive the app's **data shape from those real responses** — never guess field
   names. This shape is the contract between the agent (or live calls) and the UI.

If a toolkit doesn't support managed OAuth2 (e.g. X/Twitter), tell the user it
can't be connected this way and pick a different integration or a browser-based
agent.

## 3. Write the UI (dist/index.html)

The app is a self-contained HTML document. It talks to Rowboat ONLY through the
bridge: include the shim and code against \`window.rowboat\`:

\`\`\`html
<script src="/__bridge__.js"></script>
\`\`\`

\`window.rowboat\` API:
- \`getData()\` / \`onData(cb)\` / \`refreshData()\` — the app's data. \`data.json\` is a
  **served sibling of index.html**, so the app is self-contained: \`onData\`
  fetches \`data.json\` via a relative URL (you can also just \`fetch('data.json')\`
  yourself). \`refreshData()\` re-fetches. Rowboat does NOT inject data.
- \`getState()\` / \`setState(patch)\` — per-app persistent UI state.
- \`isConnected(scope)\` / \`connect(scope)\` — connection status / start OAuth.
- \`searchTools(scope, query)\` → [{slug,name,description}], and
  \`callAction(scope, toolSlug, args)\` → tool result (rejects on error). Scope is
  enforced against the manifest, so only declared toolkits work.
- \`fetch(url, opts?)\` → { ok, status, text, json } — a CORS-safe HTTP proxy
  through the main process. **Use this for any third-party API, never the
  browser's \`fetch\`** (public APIs rarely send CORS headers, so direct fetch
  from the app origin fails with "Failed to fetch").
- \`ready()\` — call once after registering callbacks to receive initial data/state.

Keep it dependency-free (no remote CDNs unless truly needed; the app:// origin
allows them but offline-safe is better). Render loading / empty / error states.

**Support light AND dark.** The bridge applies the host theme to \`<html>\` — it
sets the class \`dark\` or \`light\` (and \`color-scheme\`) and updates live when the
user switches. Write CSS for BOTH: style defaults for light, then override under
\`html.dark { … }\` (or use CSS variables keyed on the theme). Never hard-code a
dark-only palette. \`rowboat.getTheme()\`/\`onTheme(cb)\` are also available if you
need JS. Do not build dark-only.

**Who writes this HTML:**
- If a **coding agent is active** (user toggled the Code chip), delegate authoring
  via the \`code-with-agents\` skill — run it with \`cwd\` = the app's
  \`~/.rowboat/apps/<id>/\` folder so it can iterate and test, then install.
- Otherwise, author the HTML yourself and install it with \`mini-app-install\`.

## 4. Data pipeline (agent-backed apps only)

Create a background task with \`create-background-task\` whose instructions:
- fetch the data — via **Composio** if a toolkit exists, otherwise via the
  builtin **\`fetch-url\`** tool (server-side HTTP, no CORS). **The bg-task agent
  has NO shell** (\`executeCommand\` is disabled headlessly) and \`rowboat.fetch\`
  is frontend-only — never tell it to run a \`refresh.sh\`/script; it fetches via
  \`fetch-url\` or Composio, and
- call **\`mini-app-set-data\`** with \`{ appId: "<id>", data: <object> }\` —
  pass the **object directly, never \`JSON.stringify\`** it. If a fetch fails,
  **keep the last good data** (don't overwrite good series with empty ones).

Set the manifest's **\`dataContract\`** (\`requiredKeys\` + \`nonEmptyArrayKeys\`)
to the shape the UI needs — \`mini-app-set-data\` enforces it, so a stale or
buggy run can't corrupt the app with the wrong shape or wipe series with empties.

The agent only RETURNS the data; \`mini-app-set-data\` writes \`data.json\`
atomically (deterministic path + write — the agent never touches files). Set the
manifest's \`agent\` field to the task's slug, and give the task a **capable model**
(e.g. a Claude Sonnet / GPT-class model) via its model override — the default
light model fabricates output and hallucinates tool names on side-effect tasks.
Give it a sensible trigger (cron/window) from the background-task skill.

## 5. Finalize

Call \`mini-app-install\` with the manifest + html (+ optional seed data). For
agent-backed apps, trigger the agent once (\`run-background-task-agent\`) so
\`data.json\` exists immediately instead of waiting for the first scheduled run.

Then **open it for the user**: call \`app-navigation\` with
\`{ action: "open-app", appId: "<id>" }\`. This opens the app in the middle pane
(under Mini Apps / its title) and shows an "Opened <app>" card in the chat. Only
do this once the app is installed AND its data is populated, so it renders ready.

## Common gotchas (read before building)

- **CORS:** third-party APIs usually block browser fetches. From the app UI use
  \`rowboat.fetch(url)\`, not \`fetch(url)\`. If you don't, it fails with
  "Failed to fetch" even though curl works.
- **No Composio toolkit for the data?** That's fine — use \`rowboat.fetch\` from a
  live app, or a bg-task that fetches with **\`fetch-url\`** and calls
  \`mini-app-set-data\`. Don't force a toolkit that doesn't exist (e.g. there's no
  FX/currency toolkit), and don't reach for a shell or MCP server for plain HTTP.
- **data.json shape:** pass a plain **object** to \`mini-app-set-data\`; never
  \`JSON.stringify\` it first (double-encoding breaks the UI silently).
- **bg-task has no shell:** don't generate \`refresh.sh\` / \`executeCommand\`
  steps for the data agent — it can't run them headlessly.
- **model:** set a capable model on any data/side-effect bg-task; the default is
  too weak and will fabricate results.

## Manifest schema (manifest.json)

\`\`\`yaml
` + manifestSchema + `
\`\`\`
`;

export default skill;
