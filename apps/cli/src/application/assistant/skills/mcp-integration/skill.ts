export const skill = String.raw`
# MCP Integration Guidance

Load this skill whenever a user asks about external tools, MCP servers, or how to extend an agent’s capabilities.

## Key concepts
- MCP servers expose tools (web scraping, APIs, databases, etc.) declared in \`config/mcp.json\`.
- Agents reference MCP tools through the \`"tools"\` block by specifying \`type\`, \`name\`, \`description\`, \`mcpServerName\`, and a full \`inputSchema\`.
- Tool schemas can include optional property descriptions; only include \`"required"\` when parameters are mandatory.

## Operator actions
1. Use \`listMcpServers\` to enumerate configured servers.
2. Use \`listMcpTools\` for a server to understand the available operations and schemas.
3. Explain which MCP tools match the user’s needs before editing agent definitions.
4. When adding a tool to an agent, document what it does and ensure the schema mirrors the MCP definition.

## Example snippets to reference
- Firecrawl search (required param):
\`\`\`
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
\`\`\`
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

## Safety reminders
- Only recommend MCP tools that are actually configured.
- Clarify any missing details (required parameters, server names) before modifying files.
`;

export default skill;
