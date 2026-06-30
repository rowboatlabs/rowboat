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
- \`getData()\` / \`onData(cb)\` — the app's data (host serves \`data.json\`). Register
  \`onData\` then call \`ready()\`.
- \`getState()\` / \`setState(patch)\` — per-app persistent UI state.
- \`isConnected(scope)\` / \`connect(scope)\` — connection status / start OAuth.
- \`searchTools(scope, query)\` → [{slug,name,description}], and
  \`callAction(scope, toolSlug, args)\` → tool result (rejects on error). Scope is
  enforced against the manifest, so only declared toolkits work.
- \`ready()\` — call once after registering callbacks to receive initial data/state.

Keep it dependency-free (no remote CDNs unless truly needed; the app:// origin
allows them but offline-safe is better). Render loading / empty / error states.

**Who writes this HTML:**
- If a **coding agent is active** (user toggled the Code chip), delegate authoring
  via the \`code-with-agents\` skill — run it with \`cwd\` = the app's
  \`~/.rowboat/apps/<id>/\` folder so it can iterate and test, then install.
- Otherwise, author the HTML yourself and install it with \`mini-app-install\`.

## 4. Data pipeline (agent-backed apps only)

Create a background task with \`create-background-task\` whose instructions:
- fetch the data via Composio (or browse via the embedded browser for social
  feeds), and
- call **\`mini-app-set-data\`** with \`{ appId: "<id>", data: <payload> }\`.

The agent only RETURNS the data; \`mini-app-set-data\` writes \`data.json\`
atomically (deterministic path + write — the agent never touches files). Set the
manifest's \`agent\` field to the task's slug. Give the task a sensible trigger
(cron/window) from the background-task skill.

## 5. Finalize

Call \`mini-app-install\` with the manifest + html (+ optional seed data). Then
confirm to the user, and ideally open it so they see it populate. For agent-backed
apps, trigger the agent once (\`run-background-task-agent\`) so \`data.json\` exists
immediately instead of waiting for the first scheduled run.

## Manifest schema (manifest.json)

\`\`\`yaml
` + manifestSchema + `
\`\`\`
`;

export default skill;
