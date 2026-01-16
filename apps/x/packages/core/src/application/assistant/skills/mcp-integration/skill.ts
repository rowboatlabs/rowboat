export const skill = String.raw`
# MCP Integration Guidance

**Load this skill proactively** when a user asks for ANY task that might require external capabilities (web search, internet access, APIs, data fetching, time/date, etc.). This skill provides complete guidance on discovering and executing MCP tools.

## CRITICAL: Always Check MCP Tools First

**IMPORTANT**: When a user asks for ANY task that might require external capabilities (web search, API calls, data fetching, etc.), ALWAYS:

1. **First check**: Call \`listMcpServers\` to see what's available
2. **Then list tools**: Call \`listMcpTools\` on relevant servers
3. **Execute if possible**: Use \`executeMcpTool\` if a tool matches the need
4. **Only then decline**: If no MCP tool can help, explain what's not possible

**DO NOT** immediately say "I can't do that" or "I don't have internet access" without checking MCP tools first!

### Common User Requests and MCP Tools

| User Request | Check For | Likely Tool |
|--------------|-----------|-------------|
| "Search the web/internet" | firecrawl, composio, fetch | \`firecrawl_search\`, \`COMPOSIO_SEARCH_WEB\` |
| "Scrape this website" | firecrawl | \`firecrawl_scrape\` |
| "Read/write files" | filesystem | \`read_file\`, \`write_file\` |
| "Get current time/date" | time | \`get_current_time\` |
| "Make HTTP request" | fetch | \`fetch\`, \`post\` |
| "GitHub operations" | github | \`create_issue\`, \`search_repos\` |
| "Generate audio/speech" | elevenLabs | \`text_to_speech\` |
| "Tweet/social media" | twitter, composio | Various social tools |

## Key concepts
- MCP servers expose tools (web scraping, APIs, databases, etc.) declared in \`config/mcp.json\`.
- Agents reference MCP tools through the \`"tools"\` block by specifying \`type\`, \`name\`, \`description\`, \`mcpServerName\`, and a full \`inputSchema\`.
- Tool schemas can include optional property descriptions; only include \`"required"\` when parameters are mandatory.

## CRITICAL: Adding MCP Servers

**ALWAYS use the \`addMcpServer\` builtin tool** to add or update MCP server configurations. This tool validates the configuration before saving and prevents startup errors.

**NEVER manually create or edit \`config/mcp.json\`** using \`workspace-writeFile\` for MCP servers—this bypasses validation and will cause errors.

### MCP Server Configuration Schema

There are TWO types of MCP servers:

#### 1. STDIO (Command-based) Servers
For servers that run as local processes (Node.js, Python, etc.):

**Required fields:**
- \`command\`: string (e.g., "npx", "node", "python", "uvx")

**Optional fields:**
- \`args\`: array of strings (command arguments)
- \`env\`: object with string key-value pairs (environment variables)
- \`type\`: "stdio" (optional, inferred from presence of \`command\`)

**Schema:**
\`\`\`json
{
  "type": "stdio",
  "command": "string (REQUIRED)",
  "args": ["string", "..."],
  "env": {
    "KEY": "value"
  }
}
\`\`\`

**Valid STDIO examples:**
\`\`\`json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/data"]
}
\`\`\`

\`\`\`json
{
  "command": "python",
  "args": ["-m", "mcp_server_git"],
  "env": {
    "GIT_REPO_PATH": "/path/to/repo"
  }
}
\`\`\`

\`\`\`json
{
  "command": "uvx",
  "args": ["mcp-server-fetch"]
}
\`\`\`

#### 2. HTTP/SSE Servers
For servers that expose HTTP or Server-Sent Events endpoints:

**Required fields:**
- \`url\`: string (complete URL including protocol and path)

**Optional fields:**
- \`headers\`: object with string key-value pairs (HTTP headers)
- \`type\`: "http" (optional, inferred from presence of \`url\`)

**Schema:**
\`\`\`json
{
  "type": "http",
  "url": "string (REQUIRED)",
  "headers": {
    "Authorization": "Bearer token",
    "Custom-Header": "value"
  }
}
\`\`\`

**Valid HTTP examples:**
\`\`\`json
{
  "url": "http://localhost:3000/sse"
}
\`\`\`

\`\`\`json
{
  "url": "https://api.example.com/mcp",
  "headers": {
    "Authorization": "Bearer sk-1234567890"
  }
}
\`\`\`

### Common Validation Errors to Avoid

❌ **WRONG - Missing required field:**
\`\`\`json
{
  "args": ["some-arg"]
}
\`\`\`
Error: Missing \`command\` for stdio OR \`url\` for http

❌ **WRONG - Empty object:**
\`\`\`json
{}
\`\`\`
Error: Must have either \`command\` (stdio) or \`url\` (http)

❌ **WRONG - Mixed types:**
\`\`\`json
{
  "command": "npx",
  "url": "http://localhost:3000"
}
\`\`\`
Error: Cannot have both \`command\` and \`url\`

✅ **CORRECT - Minimal stdio:**
\`\`\`json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-time"]
}
\`\`\`

✅ **CORRECT - Minimal http:**
\`\`\`json
{
  "url": "http://localhost:3000/sse"
}
\`\`\`

### Using addMcpServer Tool

**Example 1: Add stdio server**
\`\`\`json
{
  "serverName": "filesystem",
  "serverType": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/data"]
}
\`\`\`

**Example 2: Add HTTP server**
\`\`\`json
{
  "serverName": "custom-api",
  "serverType": "http",
  "url": "https://api.example.com/mcp",
  "headers": {
    "Authorization": "Bearer token123"
  }
}
\`\`\`

**Example 3: Add Python MCP server**
\`\`\`json
{
  "serverName": "github",
  "serverType": "stdio",
  "command": "python",
  "args": ["-m", "mcp_server_github"],
  "env": {
    "GITHUB_TOKEN": "ghp_xxxxx"
  }
}
\`\`\`

## Operator actions
1. Use \`listMcpServers\` to enumerate configured servers.
2. Use \`addMcpServer\` to add or update MCP server configurations (with validation).
3. Use \`listMcpTools\` for a server to understand the available operations and schemas.
4. Use \`executeMcpTool\` to run MCP tools directly on behalf of the user.
5. Explain which MCP tools match the user's needs before editing agent definitions.
6. When adding a tool to an agent, document what it does and ensure the schema mirrors the MCP definition.

## Executing MCP Tools Directly (Copilot)

As the copilot, you can execute MCP tools directly on behalf of the user using the \`executeMcpTool\` builtin. This allows you to use MCP tools without creating an agent.

### When to Execute MCP Tools Directly
- User asks you to perform a task that an MCP tool can handle (web search, file operations, API calls, etc.)
- User wants immediate results from an MCP tool without setting up an agent
- You need to test or demonstrate an MCP tool's functionality
- You're helping the user accomplish a one-time task

### Workflow for Executing MCP Tools
1. **Discover available servers**: Use \`listMcpServers\` to see what MCP servers are configured
2. **List tools from a server**: Use \`listMcpTools\` with the server name to see available tools and their schemas
3. **CAREFULLY EXAMINE THE SCHEMA**: Look at the \`inputSchema\` to understand exactly what parameters are required
4. **Execute the tool**: Use \`executeMcpTool\` with the server name, tool name, and required arguments (matching the schema exactly)
5. **Return results**: Present the results to the user in a helpful format

### CRITICAL: Schema Matching

**ALWAYS** examine the \`inputSchema\` from \`listMcpTools\` before calling \`executeMcpTool\`.

The schema tells you:
- What parameters are required (check the \`"required"\` array)
- What type each parameter should be (string, number, boolean, object, array)
- Parameter descriptions and examples

**Example schema from listMcpTools:**
\`\`\`json
{
  "name": "COMPOSIO_SEARCH_WEB",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "The search query"
      },
      "limit": {
        "type": "number",
        "description": "Number of results"
      }
    },
    "required": ["query"]
  }
}
\`\`\`

**Correct executeMcpTool call:**
\`\`\`json
{
  "serverName": "composio",
  "toolName": "COMPOSIO_SEARCH_WEB",
  "arguments": {
    "query": "elon musk latest news"
  }
}
\`\`\`

**WRONG - Missing arguments:**
\`\`\`json
{
  "serverName": "composio",
  "toolName": "COMPOSIO_SEARCH_WEB"
}
\`\`\`

**WRONG - Wrong parameter name:**
\`\`\`json
{
  "serverName": "composio",
  "toolName": "COMPOSIO_SEARCH_WEB",
  "arguments": {
    "search": "elon musk"  // Wrong! Should be "query"
  }
}
\`\`\`

### Example: Using Firecrawl to Search the Web

**Step 1: List servers**
\`\`\`json
// Call: listMcpServers
// Response: { "servers": [{"name": "firecrawl", "type": "stdio", ...}] }
\`\`\`

**Step 2: List tools**
\`\`\`json
// Call: listMcpTools with serverName: "firecrawl"
// Response: { "tools": [{"name": "firecrawl_search", "description": "Search the web", "inputSchema": {...}}] }
\`\`\`

**Step 3: Execute the tool**
\`\`\`json
{
  "serverName": "firecrawl",
  "toolName": "firecrawl_search",
  "arguments": {
    "query": "latest AI news",
    "limit": 5
  }
}
\`\`\`

### Example: Using Filesystem Tool

**Execute a filesystem read operation:**
\`\`\`json
{
  "serverName": "filesystem",
  "toolName": "read_file",
  "arguments": {
    "path": "/path/to/file.txt"
  }
}
\`\`\`

### Tips for Executing MCP Tools
- Always check the \`inputSchema\` from \`listMcpTools\` to know what arguments are required
- Match argument types exactly (string, number, boolean, object, array)
- Provide helpful context to the user about what the tool is doing
- Handle errors gracefully and suggest alternatives if a tool fails
- For complex tasks, consider creating an agent instead of one-off tool calls

### Discovery Pattern (Recommended)

When a user asks for something that might be accomplished with an MCP tool:

1. **Identify the need**: "You want to search the web? Let me check what MCP tools are available..."
2. **List servers**: Call \`listMcpServers\` 
3. **Check for relevant tools**: If you find a relevant server (e.g., "firecrawl" for web search), call \`listMcpTools\`
4. **Execute the tool**: Once you find the right tool and understand its schema, call \`executeMcpTool\`
5. **Present results**: Format and explain the results to the user

### Common MCP Servers and Their Tools

Based on typical configurations, you might find:
- **firecrawl**: Web scraping, search, crawling (\`firecrawl_search\`, \`firecrawl_scrape\`, \`firecrawl_crawl\`)
- **filesystem**: File operations (\`read_file\`, \`write_file\`, \`list_directory\`)
- **github**: GitHub operations (\`create_issue\`, \`create_pr\`, \`search_repositories\`)
- **fetch**: HTTP requests (\`fetch\`, \`post\`)
- **time**: Time/date operations (\`get_current_time\`, \`convert_timezone\`)

Always use \`listMcpServers\` and \`listMcpTools\` to discover what's actually available rather than assuming.

## Adding MCP Tools to Agents

Once an MCP server is configured, add its tools to agent definitions (Markdown files with YAML frontmatter):

### MCP Tool Format in Agent (YAML frontmatter)
\`\`\`yaml
tools:
  descriptive_key:
    type: mcp
    name: actual_tool_name_from_server
    description: What the tool does
    mcpServerName: server_name_from_config
    inputSchema:
      type: object
      properties:
        param1:
          type: string
          description: What param1 means
      required:
        - param1
\`\`\`

### Tool Schema Rules
- Use \`listMcpTools\` to get the exact \`inputSchema\` from the server
- Copy the schema exactly as provided by the MCP server
- Only include \`required\` array if parameters are truly mandatory
- Add descriptions to help the agent understand parameter usage

### Example snippets to reference
- Firecrawl search (required param):
\`\`\`yaml
tools:
  search:
    type: mcp
    name: firecrawl_search
    description: Search the web
    mcpServerName: firecrawl
    inputSchema:
      type: object
      properties:
        query:
          type: string
          description: Search query
        limit:
          type: number
          description: Number of results
      required:
        - query
\`\`\`

- ElevenLabs text-to-speech (no required array):
\`\`\`yaml
tools:
  text_to_speech:
    type: mcp
    name: text_to_speech
    description: Generate audio from text
    mcpServerName: elevenLabs
    inputSchema:
      type: object
      properties:
        text:
          type: string
\`\`\`


## Safety reminders
- ALWAYS use \`addMcpServer\` to configure MCP servers—never manually edit config files
- Only recommend MCP tools that are actually configured (use \`listMcpServers\` first)
- Clarify any missing details (required parameters, server names) before modifying files
- Test server connection with \`listMcpTools\` after adding a new server
- Invalid MCP configs prevent agents from starting—validation is critical
`;

export default skill;
