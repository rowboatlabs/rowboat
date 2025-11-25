export const skill = String.raw`
# Agent and Workflow Authoring

Load this skill whenever a user wants to inspect, create, or update agents inside the Rowboat workspace.

## Core Concepts

**IMPORTANT**: In the CLI, there are NO separate "workflow" files. Everything is an agent.

- **All definitions live in \`agents/<agent_name>/\`** with separate files for config, tools, and instructions
- Agents configure a model, instructions, and the tools they can use
- Tools can be: builtin (like \`executeCommand\`), MCP integrations, or **other agents**
- **"Workflows" are just agents that orchestrate other agents** by having them as tools

## How multi-agent workflows work

1. **Create an orchestrator agent** that has other agents in its \`tools\`
2. **Run the orchestrator**: \`rowboatx --agent orchestrator_name\`
3. The orchestrator calls other agents as tools when needed
4. Data flows through tool call parameters and responses

## Agent format
\`\`\`
agents/
  agent_name/
    config.json       # description + optional model/provider
    instructions.md   # agent instructions
    tools.json        # tool definitions
\`\`\`

**config.json**
\`\`\`json
{
  "description": "Description of the agent",
  "model": "gpt-5.1"
}
\`\`\`

**instructions.md**
\`\`\`md
Instructions for the agent
\`\`\`

**tools.json**
\`\`\`json
{
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
// agents/summariser_agent/config.json
{ "description": "Summarises an arxiv paper", "model": "gpt-5.1" }

// agents/summariser_agent/instructions.md
Download and summarise an arxiv paper. Use curl to fetch the PDF. Output just the GIST in two lines. Don't ask for human input.

// agents/summariser_agent/tools.json
{ "bash": { "type": "builtin", "name": "executeCommand" } }
\`\`\`

**2. Agent that delegates to other agents**:
\`\`\`json
// agents/summarise-a-few/config.json
{ "description": "Summarises multiple arxiv papers", "model": "gpt-5.1" }

// agents/summarise-a-few/instructions.md
Pick 2 interesting papers and summarise each using the summariser tool. Pass the paper URL to the tool. Don't ask for human input.

// agents/summarise-a-few/tools.json
{ "summariser": { "type": "agent", "name": "summariser_agent" } }
\`\`\`

**3. Orchestrator agent** (coordinates the whole workflow):
\`\`\`json
// agents/podcast_workflow/config.json
{ "description": "Create a podcast from arXiv papers", "model": "gpt-5.1" }

// agents/podcast_workflow/instructions.md
1. Fetch arXiv papers about agents using bash
2. Pick papers and summarise them using summarise_papers
3. Create a podcast transcript
4. Generate audio using text_to_speech

Execute these steps in sequence.

// agents/podcast_workflow/tools.json
{
  "bash": { "type": "builtin", "name": "executeCommand" },
  "summarise_papers": { "type": "agent", "name": "summarise-a-few" },
  "text_to_speech": {
    "type": "mcp",
    "name": "text_to_speech",
    "mcpServerName": "elevenLabs",
    "description": "Generate audio",
    "inputSchema": { "type": "object", "properties": { "...": "..." } }
  }
}
\`\`\`

**To run this workflow**: \`rowboatx --agent podcast_workflow\`

## Naming and organization rules
- **All agents live in \`agents/<agent_name>/\`** with \`config.json\`, \`instructions.md\`, and \`tools.json\`
- Directory name must match the agent name exactly
- When referencing an agent as a tool, use its directory/agent name
- Keep directory names aligned with any references inside tools.json
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
