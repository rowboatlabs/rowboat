const skill = String.raw`
# Slack Integration Skill (agent-slack CLI)

You interact with Slack by running **agent-slack** commands through \`executeCommand\`.

---

## 1. Check Connection & Selected Channels

Before any Slack operation, read \`config/slack.json\` from the workspace root. If \`enabled\` is \`false\` or the \`workspaces\` array is empty, simply tell the user: "Slack is not enabled. You can enable it in the Connectors settings." Do not attempt any agent-slack commands.

If enabled, use the workspace URLs from the config for all commands.

**Which channels the user follows:** The user selects specific channels to sync in \`config/knowledge_sources.json\`. Read that file and find the source with \`"provider": "slack"\`; its \`scopes\` array (entries with \`"type": "channel"\`) lists the selected channels (each has a \`name\` like \`#general\` and an optional \`workspaceUrl\`). For broad "what's on my Slack / catch me up / anything new" requests where the user did NOT name a channel, query these selected channels directly — do not guess or run workspace-wide search.

---

## 1b. Catching Up ("what's new", "today", "yesterday")

For catch-up questions, list recent messages from each selected channel and filter by time with \`--oldest\` / \`--latest\` (Unix-epoch seconds):

\`\`\`
# Everything in #general since the start of today (compute the epoch for 00:00 local)
agent-slack message list "#general" --workspace https://team.slack.com --oldest 1718668800 --limit 100 --resolve-users
\`\`\`

**Do NOT use \`agent-slack unreads\` or \`agent-slack search messages\` to answer catch-up questions.** With desktop-imported auth those endpoints frequently return empty even when channels clearly have messages. Direct \`message list\` against the selected channels is the authoritative source. Run one \`message list\` per selected channel (batch them in a single \`executeCommand\` with \`;\` separators), then summarize across channels. Always pass \`--resolve-users\` so author names are readable.

---

## 2. Core Commands

### Messages

| Action | Command |
|--------|---------|
| List recent messages | \`agent-slack message list "#channel-name" --limit 25\` |
| List thread replies | \`agent-slack message list "#channel" --thread-ts 1234567890.123456\` |
| Get a single message | \`agent-slack message get "https://team.slack.com/archives/C.../p..."\` |
| Send a message | \`agent-slack message send "#channel-name" "Hello team!"\` |
| Reply in thread | \`agent-slack message send "#channel-name" "Reply text" --thread-ts 1234567890.123456\` |
| Edit a message | \`agent-slack message edit "#channel-name" --ts 1234567890.123456 "Updated text"\` |
| Delete a message | \`agent-slack message delete "#channel-name" --ts 1234567890.123456\` |

**Targets** can be:
- A full Slack URL: \`https://team.slack.com/archives/C01234567/p1234567890123456\`
- A channel name: \`"#general"\` or \`"general"\`
- A channel ID: \`C01234567\`

### Reactions

\`\`\`
agent-slack message react add "<target>" <emoji> --ts <ts>
agent-slack message react remove "<target>" <emoji> --ts <ts>
\`\`\`

### Search

Note: search is best for finding a *specific* message by keyword. It can return empty under desktop-imported auth, so never conclude "there's nothing on Slack" from an empty search — fall back to \`message list\` on the selected channels (see section 1b).

\`\`\`
agent-slack search messages "query text" --limit 20
agent-slack search messages "query" --channel "#channel-name" --user "@username"
agent-slack search messages "query" --after 2025-01-01 --before 2025-02-01
agent-slack search files "query" --limit 10
\`\`\`

### Channels

\`\`\`
agent-slack channel new --name "project-x" --workspace https://team.slack.com
agent-slack channel new --name "secret-project" --private
agent-slack channel invite --channel "#project-x" --users "@alice,@bob"
\`\`\`

### Users

\`\`\`
agent-slack user list --limit 200
agent-slack user get "@username"
agent-slack user get U01234567
\`\`\`

### Canvases

\`\`\`
agent-slack canvas get "https://team.slack.com/docs/F01234567"
agent-slack canvas get F01234567 --workspace https://team.slack.com
\`\`\`

---

## 3. Multi-Workspace

**Important:** The user has chosen which workspaces to use. Before your first Slack operation, read \`config/slack.json\` from the workspace root to see the selected workspaces. Only interact with workspaces listed in that config — ignore any other authenticated workspaces.

If the selected workspace list contains multiple entries, use \`--workspace <url>\` to disambiguate:

\`\`\`
agent-slack message list "#general" --workspace https://team.slack.com
\`\`\`

If only one workspace is selected, always use \`--workspace\` with its URL to avoid ambiguity with other authenticated workspaces.

---

## 4. Token Budget Control

Use \`--limit\` to control how many messages/results are returned. Use \`--max-body-chars\` or \`--max-content-chars\` to truncate long message bodies:

\`\`\`
agent-slack message list "#channel" --limit 10
agent-slack search messages "query" --limit 5 --max-content-chars 2000
\`\`\`

---

## 5. Discovering More Commands

For any command you're unsure about:

\`\`\`
agent-slack --help
agent-slack message --help
agent-slack search --help
agent-slack channel --help
\`\`\`

---

## Best Practices

- **Always show drafts before sending** — Never send Slack messages without user confirmation
- **Summarize, don't dump** — When showing channel history, summarize the key points rather than pasting everything
- **Prefer Slack URLs** — When referring to messages, use Slack URLs over raw channel names when available
- **Use --limit** — Always set reasonable limits to keep output concise and token-efficient
- **Resolve user IDs** — Messages contain raw user IDs like \`U078AHJP341\`. Resolve them to real names before presenting to the user. Batch all lookups into a single \`executeCommand\` call using \`;\` separators, e.g. \`agent-slack user get U078AHJP341 --workspace ... ; agent-slack user get U090UEZCEQ0 --workspace ...\`
- **Cross-reference with knowledge base** — Check if mentioned people have notes in the knowledge base
`;

export default skill;
