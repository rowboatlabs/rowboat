export const skill = String.raw`
# MCP Integration Guidance

Load this skill whenever a user asks about external tools, MCP servers, or how to extend an agent's capabilities.

## Key concepts
- MCP servers expose tools (web scraping, APIs, databases, etc.) declared in \`config/mcp.json\`.
- Agents reference MCP tools through the \`"tools"\` block by specifying \`type\`, \`name\`, \`description\`, \`mcpServerName\`, and a full \`inputSchema\`.
- Tool schemas can include optional property descriptions; only include \`"required"\` when parameters are mandatory.

## CRITICAL: Adding MCP Servers

**ALWAYS use the \`addMcpServer\` builtin tool** to add or update MCP server configurations. This tool validates the configuration before saving and prevents startup errors.

**NEVER manually create or edit \`config/mcp.json\`** using \`createFile\` or \`updateFile\` for MCP servers—this bypasses validation and will cause errors.

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
4. Explain which MCP tools match the user's needs before editing agent definitions.
5. When adding a tool to an agent, document what it does and ensure the schema mirrors the MCP definition.

## Adding MCP Tools to Agents

Once an MCP server is configured, add its tools to agent definitions:

### MCP Tool Format in Agent
\`\`\`json
"tools": {
  "descriptive_key": {
    "type": "mcp",
    "name": "actual_tool_name_from_server",
    "description": "What the tool does",
    "mcpServerName": "server_name_from_config",
    "inputSchema": {
      "type": "object",
      "properties": {
        "param1": {"type": "string", "description": "What param1 means"}
      },
      "required": ["param1"]
    }
  }
}
\`\`\`

### Tool Schema Rules
- Use \`listMcpTools\` to get the exact \`inputSchema\` from the server
- Copy the schema exactly as provided by the MCP server
- Only include \`"required"\` array if parameters are truly mandatory
- Add descriptions to help the agent understand parameter usage

### Example snippets to reference
- Firecrawl search (required param):
\`\`\`json
"tools": {
  "search": {
    "type": "mcp",
    "name": "firecrawl_search",
    "description": "Search the web",
    "mcpServerName": "firecrawl",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {"type": "string", "description": "Search query"},
        "limit": {"type": "number", "description": "Number of results"}
      },
      "required": ["query"]
    }
  }
}
\`\`\`

- ElevenLabs text-to-speech (no required array):
\`\`\`json
"tools": {
  "text_to_speech": {
    "type": "mcp",
    "name": "text_to_speech",
    "description": "Generate audio from text",
    "mcpServerName": "elevenLabs",
    "inputSchema": {
      "type": "object",
      "properties": {
        "text": {"type": "string"}
      }
    }
  }
}
\`\`\`

- Filesystem operations:
\`\`\`json
"tools": {
  "read_file": {
    "type": "mcp",
    "name": "read_file",
    "description": "Read file contents",
    "mcpServerName": "filesystem",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {"type": "string", "description": "File path to read"}
      },
      "required": ["path"]
    }
  }
}
\`\`\`

## Safety reminders
- ALWAYS use \`addMcpServer\` to configure MCP servers—never manually edit config files
- Only recommend MCP tools that are actually configured (use \`listMcpServers\` first)
- Clarify any missing details (required parameters, server names) before modifying files
- Test server connection with \`listMcpTools\` after adding a new server
- Invalid MCP configs prevent agents from starting—validation is critical
`;

export default skill;
