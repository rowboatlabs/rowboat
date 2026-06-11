export const skill = String.raw`
# Read Emails Skill

You are helping the user read, check, search, or summarize their Gmail inbox using the NATIVE Gmail tools. These run against a local sync of the user's inbox — fast, private, and already enriched with per-thread LLM summaries.

Do NOT use the \`composio-integration\` skill or any \`composio-*\` tool for Gmail unless a native tool response says \`composioFallback: true\`.

## Tools

| Tool | What it does |
|------|--------------|
| \`gmail-checkConnection\` | Is native Gmail connected, and as which account? |
| \`gmail-listThreads\` | Page through the synced inbox (\`section: 'important'\` or \`'other'\`). Each thread carries a cached 1-2 sentence \`summary\` and \`importance\` classification. |
| \`gmail-readThread\` | Full plain-text messages of ONE thread by \`threadId\`. |
| \`gmail-searchEmails\` | Live Gmail search with a query string — for anything the cached inbox can't answer. |

## Summarizing the Inbox (the common case)

For "summarize my emails", "what's in my inbox", "anything important today":

1. Call \`gmail-listThreads\` (defaults to \`section: 'important'\`). Include \`section: 'other'\` only if the user asks about newsletters/notifications or "everything".
2. Compose your answer directly from the returned \`summary\` + \`importance\` fields (plus \`from\`/\`subject\`/\`date\`).
3. **Do NOT** call \`gmail-readThread\` once per thread, and do NOT re-summarize message bodies — the cached summaries already exist and are fresh from sync. Read a full thread ONLY when the user drills into a specific one.

Threads without a \`summary\` include a \`latestSnippet\` to work from.

## Freshness

- The cache syncs continuously in the background (typically minutes fresh).
- When the user says "check my email NOW" / "any NEW emails?", pass \`sync: true\` on \`gmail-listThreads\` — it triggers a background re-sync (non-blocking). If results look stale, mention fresh data lands shortly and retry once.

## Searching ("emails from Stripe last month")

Use \`gmail-searchEmails\` with a Gmail query string. Common operators:
- \`from:stripe.com\`, \`to:someone@example.com\`
- \`subject:invoice\`
- \`newer_than:7d\`, \`older_than:30d\`, \`after:2026/05/01\`
- \`is:unread\`, \`has:attachment\`, \`label:work\`
- Free text matches message content.

Results may come from the cache (with summaries) or live metadata only. Follow up with \`gmail-readThread({ threadId })\` when the user wants the content.

## Reading One Thread

\`gmail-readThread({ threadId })\` returns the most recent messages (default 10, \`omittedOlderMessages\` counts the rest), with quoted replies stripped and long bodies truncated. It also includes the cached \`summary\`, \`importance\`, and any \`draft_response\` the classifier prepared. Attachments are listed with a \`savedPath\` (workspace-relative) — use file tools / \`parseFile\` on it if the user asks about an attachment.

## Pagination

Default page size is 20. Follow \`nextCursor\` only when the user asks for more ("show me the rest", "older emails").

## Not Connected

If a tool returns \`connected: false\`:
- Tell the user to connect their Google account in **Settings** (the \`action\` field says exactly what to suggest).
- Only if the response also says \`composioFallback: true\` may you fall back to the \`composio-integration\` skill for Gmail.

## Drafting

This skill is for READING email. When the user wants to draft or compose a reply, load the \`draft-emails\` skill.
`;

export default skill;
