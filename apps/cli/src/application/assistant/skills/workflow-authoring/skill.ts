export const skill = String.raw`
# Agent and Workflow Authoring

Load this skill whenever a user wants to inspect, create, or update agents inside the Rowboat workspace.

## Core Concepts

**IMPORTANT**: In the CLI, there are NO separate "workflow" files. Everything is an agent.

- **All definitions live in \`agents/*.json\`** - there is no separate workflows folder
- Agents configure a model, instructions, and the tools they can use
- Tools can be: builtin (like \`executeCommand\`), MCP integrations, or **other agents**
- **"Workflows" are just agents that orchestrate other agents** by having them as tools

## How multi-agent workflows work

1. **Create an orchestrator agent** that has other agents in its \`tools\`
2. **Run the orchestrator**: \`rowboatx --agent orchestrator_name\`
3. The orchestrator calls other agents as tools when needed
4. Data flows through tool call parameters and responses

## Agent format
\`\`\`json
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

## Tool types

### Builtin tools
\`\`\`json
"bash": {
  "type": "builtin",
  "name": "executeCommand"
}
\`\`\`

### MCP tools
\`\`\`json
"search": {
  "type": "mcp",
  "name": "firecrawl_search",
  "description": "Search the web",
  "mcpServerName": "firecrawl",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {"type": "string", "description": "Search query"}
    },
    "required": ["query"]
  }
}
\`\`\`

### Agent tools (for chaining agents)
\`\`\`json
"summariser": {
  "type": "agent",
  "name": "summariser_agent"
}
\`\`\`
- Use \`"type": "agent"\` to call other agents as tools
- The target agent will be invoked with the parameters you pass
- Results are returned as tool output
- This is how you build multi-agent workflows

## Complete Multi-Agent Workflow Example

**Podcast creation workflow** - This is all done through agents calling other agents:

**1. Task-specific agent** (does one thing):
\`\`\`json
{
  "name": "summariser_agent",
  "description": "Summarises an arxiv paper",
  "model": "gpt-4.1",
  "instructions": "Download and summarise an arxiv paper. Use curl to fetch the PDF. Output just the GIST in two lines. Don't ask for human input.",
  "tools": {
    "bash": {"type": "builtin", "name": "executeCommand"}
  }
}
\`\`\`

**2. Agent that delegates to other agents**:
\`\`\`json
{
  "name": "summarise-a-few",
  "description": "Summarises multiple arxiv papers",
  "model": "gpt-4.1",
  "instructions": "Pick 2 interesting papers and summarise each using the summariser tool. Pass the paper URL to the tool. Don't ask for human input.",
  "tools": {
    "summariser": {
      "type": "agent",
      "name": "summariser_agent"
    }
  }
}
\`\`\`

**3. Orchestrator agent** (coordinates the whole workflow):
\`\`\`json
{
  "name": "podcast_workflow",
  "description": "Create a podcast from arXiv papers",
  "model": "gpt-4.1",
  "instructions": "1. Fetch arXiv papers about agents using bash\n2. Pick papers and summarise them using summarise_papers\n3. Create a podcast transcript\n4. Generate audio using text_to_speech\n\nExecute these steps in sequence.",
  "tools": {
    "bash": {"type": "builtin", "name": "executeCommand"},
    "summarise_papers": {
      "type": "agent",
      "name": "summarise-a-few"
    },
    "text_to_speech": {
      "type": "mcp",
      "name": "text_to_speech",
      "mcpServerName": "elevenLabs",
      "description": "Generate audio",
      "inputSchema": { "type": "object", "properties": {...}}
    }
  }
}
\`\`\`

**To run this workflow**: \`rowboatx --agent podcast_workflow\`

## Naming and organization rules
- **All agents live in \`agents/*.json\`** - no other location
- Agent filenames must match the \`"name"\` field exactly
- When referencing an agent as a tool, use its \`"name"\` value
- Always keep filenames and \`"name"\` fields perfectly aligned
- Use relative paths (no \${BASE_DIR} prefixes) when giving examples to users

## Best practices for multi-agent design
1. **Single responsibility**: Each agent should do one specific thing well
2. **Clear delegation**: Agent instructions should explicitly say when to call other agents
3. **Autonomous operation**: Add "Don't ask for human input" for autonomous workflows
4. **Data passing**: Make it clear what data to extract and pass between agents
5. **Tool naming**: Use descriptive tool keys (e.g., "summariser", "fetch_data", "analyze")
6. **Orchestration**: Create a top-level agent that coordinates the workflow

## Capabilities checklist
1. Explore \`agents/\` directory to understand existing agents before editing
2. Update files carefully to maintain schema validity
3. When creating multi-agent workflows, create an orchestrator agent
4. Add other agents as tools with \`"type": "agent"\` for chaining
5. List and explore MCP servers/tools when users need new capabilities
6. Confirm work done and outline next steps once changes are complete
`;

export default skill;
