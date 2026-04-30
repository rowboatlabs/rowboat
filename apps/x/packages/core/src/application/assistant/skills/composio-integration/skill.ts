export const skill = String.raw`
# Composio Integration

**Load this skill** when the user asks to interact with ANY third-party service — email, GitHub, Slack, LinkedIn, Notion, Jira, Google Sheets, calendar, etc. This skill provides the complete workflow for discovering, connecting, and executing Composio tools.

## Available Tools

| Tool | Purpose |
|------|---------|
| **composio-list-toolkits** | List all available integrations and their connection status |
| **composio-search-tools** | Search for tools by use case; returns slugs and input schemas |
| **composio-execute-tool** | Execute a tool by slug with parameters |
| **composio-connect-toolkit** | Connect a service via OAuth (opens browser) |

## Toolkit Slugs (exact values for toolkitSlug parameter)

| Service | Slug |
|---------|------|
| Gmail | \`gmail\` |
| Google Calendar | \`googlecalendar\` |
| Google Sheets | \`googlesheets\` |
| Google Docs | \`googledocs\` |
| Google Drive | \`googledrive\` |
| Slack | \`slack\` |
| GitHub | \`github\` |
| Notion | \`notion\` |
| Linear | \`linear\` |
| Jira | \`jira\` |
| Asana | \`asana\` |
| Trello | \`trello\` |
| HubSpot | \`hubspot\` |
| Salesforce | \`salesforce\` |
| LinkedIn | \`linkedin\` |
| X (Twitter) | \`twitter\` |
| Reddit | \`reddit\` |
| Dropbox | \`dropbox\` |
| OneDrive | \`onedrive\` |
| Microsoft Outlook | \`microsoft_outlook\` |
| Microsoft Teams | \`microsoft_teams\` |
| Calendly | \`calendly\` |
| Cal.com | \`cal\` |
| Intercom | \`intercom\` |
| Zendesk | \`zendesk\` |
| Airtable | \`airtable\` |

**IMPORTANT:** Always use these exact slugs. Do NOT guess — e.g., Google Sheets is \`googlesheets\` (no underscore), not \`google_sheets\`.

## Critical: Check First, Connect Second

**BEFORE calling composio-connect-toolkit, ALWAYS check if the service is already connected.** The system prompt includes a "Currently connected" list. If the service is there, skip connecting and go straight to search + execute.

**Flow:**
1. Check if the service is in the "Currently connected" list (in the system prompt above)
2. If **connected** → go directly to step 4
3. If **NOT connected** → call \`composio-connect-toolkit\` once, wait for user to authenticate, then continue
4. Call \`composio-search-tools\` with SHORT keyword queries
5. Read the \`inputSchema\` from results — note \`required\` fields
6. Call \`composio-execute-tool\` with slug, toolkit, and all required arguments

**NEVER call composio-connect-toolkit for a service that's already connected.** This creates duplicate connect cards in the UI.

## Search Query Tips

Use **short keyword queries**, not full sentences:

| ✅ Good | ❌ Bad |
|---------|--------|
| "list issues" | "get all open issues for a GitHub repository" |
| "send email" | "send an email to someone using Gmail" |
| "get profile" | "fetch the authenticated user's profile details" |
| "create spreadsheet" | "create a new Google Sheets spreadsheet with data" |

If the first search returns 0 results, try a different short query (e.g., "issues" instead of "list issues").

## Passing Arguments

**ALWAYS include the \`arguments\` field** when calling \`composio-execute-tool\`, even if the tool has no required parameters.

- Read the \`inputSchema\` from search results carefully
- Extract user-provided values into the correct fields (e.g., "rowboatlabs/rowboat" → \`owner: "rowboatlabs", repo: "rowboat"\`)
- For tools with empty \`properties: {}\`, pass \`arguments: {}\`
- For tools with required fields, pass all of them

### Example: GitHub Issues

User says: "Get me the open issues on rowboatlabs/rowboat"

1. \`composio-search-tools({ query: "list issues", toolkitSlug: "github" })\`
   → finds \`GITHUB_ISSUES_LIST_FOR_REPO\` with required: ["owner", "repo"]
2. \`composio-execute-tool({ toolSlug: "GITHUB_ISSUES_LIST_FOR_REPO", toolkitSlug: "github", arguments: { owner: "rowboatlabs", repo: "rowboat", state: "open", per_page: 100 } })\`

### Example: Gmail Fetch

User says: "What's my latest email?"

1. \`composio-search-tools({ query: "fetch emails", toolkitSlug: "gmail" })\`
   → finds \`GMAIL_FETCH_EMAILS\`
2. \`composio-execute-tool({ toolSlug: "GMAIL_FETCH_EMAILS", toolkitSlug: "gmail", arguments: { user_id: "me", max_results: 5 } })\`

### Example: LinkedIn Profile (no-arg tool)

User says: "Get my LinkedIn profile"

1. \`composio-search-tools({ query: "get profile", toolkitSlug: "linkedin" })\`
   → finds \`LINKEDIN_GET_MY_INFO\` with properties: {}
2. \`composio-execute-tool({ toolSlug: "LINKEDIN_GET_MY_INFO", toolkitSlug: "linkedin", arguments: {} })\`

## Error Recovery

- **If a tool call fails** (missing fields, 500 error): Fix the arguments and retry IMMEDIATELY. Do NOT stop and narrate the error to the user.
- **If search returns 0 results**: Try a different short query. If still 0, the tool may not exist for that service.
- **If a tool requires connection**: Call \`composio-connect-toolkit\` once, then retry after connection.

## Multi-Part Requests

When the user says "connect X and then do Y" — complete BOTH parts in one turn:
1. If X is already connected (check the connected list), skip to Y immediately
2. If X needs connecting, connect it, then proceed to Y after authentication

## Confirmation Rules

- **Read-only actions** (fetch, list, get, search): Execute without asking
- **Mutating actions** (send email, create issue, post, delete): Show the user what you're about to do and confirm before executing
- **Connecting a toolkit**: Always safe — just do it when needed
`;

export default skill;
