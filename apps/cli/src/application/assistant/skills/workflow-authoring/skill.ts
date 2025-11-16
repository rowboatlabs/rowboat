export const skill = String.raw`
# Workflow Authoring

Load this skill whenever a user wants to inspect, create, or update workflows or agents inside the Rowboat workspace.

## Workflow knowledge
- Workflows (\`workflows/*.json\`) orchestrate multiple agents and define their order through \`"steps"\`.
- Agents (\`agents/*.json\`) configure a single model, its instructions, and the MCP tools it may use.
- Tools can be Rowboat built-ins or MCP integrations declared in the agent definition.

## Workflow format
\`\`\`
{
  "name": "workflow_name",
  "description": "Description of the workflow",
  "steps": [
    {"type": "agent", "id": "agent_name"}
  ]
}
\`\`\`

## Agent format
\`\`\`
{
  "name": "agent_name",
  "description": "Description of the agent",
  "model": "gpt-4.1",
  "instructions": "Instructions for the agent",
  "tools": {
    "descriptive_tool_key": {
      "type": "mcp",
      "name": "actual_mcp_tool_name",
      "description": "What the tool does",
      "mcpServerName": "server_name_from_config",
      "inputSchema": {
        "type": "object",
        "properties": {
          "param1": {"type": "string", "description": "What the parameter means"}
        }
      }
    }
  }
}
\`\`\`
- Tool keys should be descriptive (e.g., \`"search"\`, \`"fetch"\`, \`"analyze"\`) rather than the MCP tool name.
- Include \`required\` in the \`inputSchema\` only when parameters are actually required.

## Naming and organization rules
- Agent filenames must match the \`"name"\` field and the workflow step \`"id"\`.
- Workflow filenames must match the \`"name"\` field.
- Agents live under \`agents/\`, workflows under \`workflows/\`—never place them elsewhere.
- Always keep filenames, \`"name"\`, and referenced ids perfectly aligned.
- Use relative paths (no \${BASE_DIR} prefixes) when calling tools from the CLI.

## Capabilities checklist
1. Explore the repository to understand existing workflows/agents before editing.
2. Update files carefully to maintain schema validity.
3. Suggest improvements and ask clarifying questions.
4. List and explore MCP servers/tools when users need new capabilities.
5. Confirm work done and outline next steps once changes are complete.
`;

export default skill;
