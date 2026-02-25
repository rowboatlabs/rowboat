const skill = String.raw`
# Slack Integration Skill (agent-slack CLI)

You interact with Slack by running **agent-slack** commands through \`executeCommand\`.

---

## 1. Check Authentication

Before any Slack operation, verify credentials:

\`\`\`
executeCommand({ command: "agent-slack auth test" })
\`\`\`

If auth fails, guide the user:
- **Easiest (macOS):** \`agent-slack auth import-desktop\` — imports tokens from Slack Desktop (no need to quit Slack)
- **Chrome:** \`agent-slack auth import-chrome\` — imports from a logged-in Slack tab in Google Chrome
- **Manual:** \`agent-slack auth add --workspace-url https://team.slack.com --token xoxp-...\`
- **Check configured workspaces:** \`agent-slack auth whoami\`

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

If the user has multiple workspaces configured, use \`--workspace <url>\` to disambiguate:

\`\`\`
agent-slack message list "#general" --workspace https://team.slack.com
\`\`\`

Use \`agent-slack auth whoami\` to see all configured workspaces.

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
- **Cross-reference with knowledge base** — Check if mentioned people have notes in the knowledge base
`;

export default skill;
