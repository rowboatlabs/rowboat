import { slackToolCatalogMarkdown } from "./tool-catalog.js";

const skill = String.raw`
# Slack Integration Skill

You can interact with Slack to help users communicate with their team. This includes sending messages, viewing channel history, finding users, and searching conversations.

## Prerequisites

Before using Slack tools, ALWAYS check if Slack is connected:
\`\`\`
slack-checkConnection({})
\`\`\`

If not connected, inform the user they need to connect Slack from the settings/onboarding.

## Available Tools

### Check Connection
\`\`\`
slack-checkConnection({})
\`\`\`
Returns whether Slack is connected and ready to use.

### List Users
\`\`\`
slack-listUsers({ limit: 100 })
\`\`\`
Lists users in the workspace. Use this to resolve a name to a user ID.

### List DM Conversations
\`\`\`
slack-getDirectMessages({ limit: 50 })
\`\`\`
Lists DM channels (type "im"). Each entry includes the DM channel ID and the user ID.

### List Channels
\`\`\`
slack-listChannels({ types: "public_channel,private_channel", limit: 100 })
\`\`\`
Lists channels the user has access to.

### Get Conversation History
\`\`\`
slack-getChannelHistory({ channel: "C01234567", limit: 20 })
\`\`\`
Fetches recent messages for a channel or DM.

### Search Messages
\`\`\`
slack-searchMessages({ query: "in:@username", count: 20 })
\`\`\`
Searches Slack messages using Slack search syntax.

### Send a Message
\`\`\`
slack-sendMessage({ channel: "C01234567", text: "Hello team!" })
\`\`\`
Sends a message to a channel or DM. Always show the draft first.

### Execute a Slack Action
\`\`\`
slack-executeAction({
  toolSlug: "EXACT_TOOL_SLUG_FROM_DISCOVERY",
  input: { /* tool-specific parameters */ }
})
\`\`\`
Executes any Slack tool using its exact slug discovered from \`slack-listAvailableTools\`.

### Discover Available Tools (Fallback)
\`\`\`
slack-listAvailableTools({ search: "conversation" })
\`\`\`
Lists available Slack tools from Composio. Use this only if a builtin Slack tool fails and you need a specific slug.

## Composio Slack Tool Catalog (Pinned)
Use the exact tool slugs below with \`slack-executeAction\` when needed. Prefer these over \`slack-listAvailableTools\` to avoid redundant discovery.

${slackToolCatalogMarkdown}

## Workflow

### Step 1: Check Connection
\`\`\`
slack-checkConnection({})
\`\`\`

### Step 2: Choose the Builtin Tool
Use the builtin Slack tools above for common tasks. Only fall back to \`slack-listAvailableTools\` + \`slack-executeAction\` if something is missing.

## Common Tasks

### Find the Most Recent DM with Someone
1. Search messages first: \`slack-searchMessages({ query: "in:@Name", count: 1 })\`
2. If you need exact DM history:
   - \`slack-listUsers({})\` to find the user ID
   - \`slack-getDirectMessages({})\` to find the DM channel for that user
   - \`slack-getChannelHistory({ channel: "D...", limit: 20 })\`

### Send a Message
1. Draft the message and show it to the user
2. ONLY after user approval, send using \`slack-sendMessage\`

### Search Messages
1. Use \`slack-searchMessages({ query: "...", count: 20 })\`

## Best Practices

- **Always show drafts before sending** - Never send Slack messages without user confirmation
- **Summarize, don't dump** - When showing channel history, summarize the key points
- **Cross-reference with knowledge base** - Check if mentioned people have notes in the knowledge base

## Error Handling

If a Slack operation fails:
1. Try \`slack-listAvailableTools\` to verify the tool slug is correct
2. Check if Slack is still connected with \`slack-checkConnection\`
3. Inform the user of the specific error
`;

export default skill;
