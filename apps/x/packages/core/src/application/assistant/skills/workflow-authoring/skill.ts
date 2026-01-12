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

## Agent File Schema

Agent files MUST conform to this exact schema. Invalid agents will fail to load.

### Complete Agent Schema
\`\`\`json
{
  "name": "string (REQUIRED, must match filename without .json)",
  "description": "string (REQUIRED, what this agent does)",
  "instructions": "string (REQUIRED, detailed instructions for the agent)",
  "model": "string (OPTIONAL, e.g., 'gpt-5.1', 'claude-sonnet-4-5')",
  "provider": "string (OPTIONAL, provider alias from models.json)",
  "tools": {
    "descriptive_key": {
      "type": "builtin | mcp | agent (REQUIRED)",
      "name": "string (REQUIRED)",
      // Additional fields depend on type - see below
    }
  }
}
\`\`\`

### Required Fields
- \`name\`: Agent identifier (must exactly match the filename without .json)
- \`description\`: Brief description of agent's purpose
- \`instructions\`: Detailed instructions for how the agent should behave

### Optional Fields
- \`model\`: Model to use (defaults to model config if not specified)
- \`provider\`: Provider alias from models.json (optional)
- \`tools\`: Object containing tool definitions (can be empty or omitted)

### Naming Rules
- Agent filename MUST match the \`name\` field exactly
- Example: If \`name\` is "summariser_agent", file must be "summariser_agent.json"
- Use lowercase with underscores for multi-word names
- No spaces or special characters in names

### Agent Format Example
\`\`\`json
{
  "name": "agent_name",
  "description": "Description of the agent",
  "model": "gpt-5.1",
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

## Tool Types & Schemas

Tools in agents must follow one of three types. Each has specific required fields.

### 1. Builtin Tools
Internal Rowboat tools (executeCommand, file operations, MCP queries, etc.)

**Schema:**
\`\`\`json
{
  "type": "builtin",
  "name": "tool_name"
}
\`\`\`

**Required fields:**
- \`type\`: Must be "builtin"
- \`name\`: Builtin tool name (e.g., "executeCommand", "readFile")

**Example:**
\`\`\`json
"bash": {
  "type": "builtin",
  "name": "executeCommand"
}
\`\`\`

**Available builtin tools:**
- \`executeCommand\` - Execute shell commands
- \`workspace-readFile\`, \`workspace-writeFile\`, \`workspace-remove\` - File operations
- \`workspace-readdir\`, \`workspace-exists\`, \`workspace-stat\` - Directory operations
- \`workspace-mkdir\`, \`workspace-rename\`, \`workspace-copy\` - File/directory management
- \`analyzeAgent\` - Analyze agent structure
- \`addMcpServer\`, \`listMcpServers\`, \`listMcpTools\` - MCP management
- \`loadSkill\` - Load skill guidance

### 2. MCP Tools
Tools from external MCP servers (APIs, databases, web scraping, etc.)

**Schema:**
\`\`\`json
{
  "type": "mcp",
  "name": "tool_name_from_server",
  "description": "What the tool does",
  "mcpServerName": "server_name_from_config",
  "inputSchema": {
    "type": "object",
    "properties": {
      "param": {"type": "string", "description": "Parameter description"}
    },
    "required": ["param"]
  }
}
\`\`\`

**Required fields:**
- \`type\`: Must be "mcp"
- \`name\`: Exact tool name from MCP server
- \`description\`: What the tool does (helps agent understand when to use it)
- \`mcpServerName\`: Server name from config/mcp.json
- \`inputSchema\`: Full JSON Schema object for tool parameters

**Example:**
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

**Important:**
- Use \`listMcpTools\` to get the exact inputSchema from the server
- Copy the schema exactly—don't modify property types or structure
- Only include \`"required"\` array if parameters are mandatory

### 3. Agent Tools (for chaining agents)
Reference other agents as tools to build multi-agent workflows

**Schema:**
\`\`\`json
{
  "type": "agent",
  "name": "target_agent_name"
}
\`\`\`

**Required fields:**
- \`type\`: Must be "agent"
- \`name\`: Name of the target agent (must exist in agents/ directory)

**Example:**
\`\`\`json
"summariser": {
  "type": "agent",
  "name": "summariser_agent"
}
\`\`\`

**How it works:**
- Use \`"type": "agent"\` to call other agents as tools
- The target agent will be invoked with the parameters you pass
- Results are returned as tool output
- This is how you build multi-agent workflows
- The referenced agent file must exist (e.g., agents/summariser_agent.json)

## Complete Multi-Agent Workflow Example

**Podcast creation workflow** - This is all done through agents calling other agents:

**1. Task-specific agent** (does one thing):
\`\`\`json
{
  "name": "summariser_agent",
  "description": "Summarises an arxiv paper",
  "model": "gpt-5.1",
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
  "model": "gpt-5.1",
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
  "model": "gpt-5.1",
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

## Validation & Best Practices

### CRITICAL: Schema Compliance
- Agent files MUST have \`name\`, \`description\`, and \`instructions\` fields
- Agent filename MUST exactly match the \`name\` field
- Tools MUST have valid \`type\` ("builtin", "mcp", or "agent")
- MCP tools MUST have all required fields: name, description, mcpServerName, inputSchema
- Agent tools MUST reference existing agent files
- Invalid agents will fail to load and prevent workflow execution

### File Creation/Update Process
1. When creating an agent, use \`workspace-writeFile\` with complete, valid JSON
2. When updating an agent, read it first with \`workspace-readFile\`, modify, then use \`workspace-writeFile\`
3. Validate JSON syntax before writing—malformed JSON breaks the agent
4. Test agent loading after creation/update by using \`analyzeAgent\`

### Common Validation Errors to Avoid

❌ **WRONG - Missing required fields:**
\`\`\`json
{
  "name": "my_agent"
  // Missing description and instructions
}
\`\`\`

❌ **WRONG - Filename mismatch:**
- File: agents/my_agent.json
- Content: {"name": "myagent", ...}

❌ **WRONG - Invalid tool type:**
\`\`\`json
"tool1": {
  "type": "custom",  // Invalid type
  "name": "something"
}
\`\`\`

❌ **WRONG - MCP tool missing required fields:**
\`\`\`json
"search": {
  "type": "mcp",
  "name": "firecrawl_search"
  // Missing: description, mcpServerName, inputSchema
}
\`\`\`

✅ **CORRECT - Minimal valid agent:**
\`\`\`json
{
  "name": "simple_agent",
  "description": "A simple agent",
  "instructions": "Do simple tasks"
}
\`\`\`

✅ **CORRECT - Complete MCP tool:**
\`\`\`json
"search": {
  "type": "mcp",
  "name": "firecrawl_search",
  "description": "Search the web",
  "mcpServerName": "firecrawl",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {"type": "string"}
    }
  }
}
\`\`\`

## Capabilities checklist
1. Explore \`agents/\` directory to understand existing agents before editing
2. Read existing agents with \`readFile\` before making changes
3. Validate all required fields are present before creating/updating agents
4. Ensure filename matches the \`name\` field exactly
5. Use \`analyzeAgent\` to verify agent structure after creation/update
6. When creating multi-agent workflows, create an orchestrator agent
7. Add other agents as tools with \`"type": "agent"\` for chaining
8. Use \`listMcpServers\` and \`listMcpTools\` when adding MCP integrations
9. Confirm work done and outline next steps once changes are complete
`;

export default skill;
