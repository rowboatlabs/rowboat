export const skill = String.raw`
# Notify User

Load this skill when you need to send a desktop notification to the user — e.g. after a long-running task completes, when a track block detects something noteworthy, or when an agent wants to ping the user with a clickable result.

## When to use
- **Use it for**: completion alerts, threshold breaches, status changes, new items the user asked you to watch for, anything time-sensitive.
- **Don't use it for**: routine progress updates, anything the user can already see in the chat, or repeated pings inside a loop (there is no built-in rate limit — restraint is on you).

## The tool: \`notify-user\`

Triggers a native macOS notification. The call returns immediately; it does not block waiting for the user to click.

### Parameters
- **\`title\`** (optional, defaults to \`"Rowboat"\`) — bold headline at the top.
- **\`message\`** (required) — body text. Keep it short — macOS truncates after a couple of lines.
- **\`link\`** (optional) — URL to open when the user clicks the notification. Two kinds accepted:
  - **\`https://...\` / \`http://...\`** — opens in the default browser
  - **\`rowboat://...\`** — opens a view inside Rowboat (see deep links below)
  - If omitted, clicking the notification focuses the Rowboat app.

### Examples

Plain alert (no link — clicking focuses the app):
\`\`\`json
{
  "title": "Backup complete",
  "message": "All 142 files synced to iCloud."
}
\`\`\`

External link:
\`\`\`json
{
  "title": "New email from Monica",
  "message": "Re: Q4 planning — needs your input by Friday",
  "link": "https://mail.google.com/mail/u/0/#inbox/abc123"
}
\`\`\`

Deep link into a Rowboat note:
\`\`\`json
{
  "message": "Daily brief is ready",
  "link": "rowboat://open?type=file&path=knowledge/Daily/2026-04-25.md"
}
\`\`\`

## Deep links: \`rowboat://\`

Use these as the \`link\` parameter to land the user on a specific view in Rowboat instead of an external site. URL-encode paths/names that contain spaces or special characters.

| Target | Format | Example |
|---|---|---|
| Open a file | \`rowboat://open?type=file&path=<workspace-relative path>\` | \`rowboat://open?type=file&path=knowledge/People/Acme.md\` |
| Open chat | \`rowboat://open?type=chat\` (optional \`&runId=<id>\`) | \`rowboat://open?type=chat&runId=abc123\` |
| Knowledge graph | \`rowboat://open?type=graph\` | — |
| Background task view | \`rowboat://open?type=task&name=<task-name>\` | \`rowboat://open?type=task&name=daily-brief\` |
| Suggested topics | \`rowboat://open?type=suggested-topics\` | — |

The \`type=file\` path is workspace-relative (the same path you'd pass to \`workspace-readFile\`).

## Anti-patterns
- **Don't notify per step** of a multi-step task. Notify on completion, not on progress.
- **Don't repeat what's already on screen.** If the result is already in the chat or in a track block the user is viewing, skip the notification.
- **Don't dump the result into \`message\`.** Surface the headline; put the detail behind a deep link or external link.
- **Don't notify silently-failing things either.** If something failed, say so in the message — don't swallow the failure into a generic "done".
`;

export default skill;
