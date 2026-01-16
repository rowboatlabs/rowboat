export const skill = String.raw`
# Agent and Workflow Authoring

Load this skill whenever a user wants to inspect, create, or update agents inside the Rowboat workspace.

## Core Concepts

**IMPORTANT**: In the CLI, there are NO separate "workflow" files. Everything is an agent.

- **All definitions live in \`agents/*.md\`** - Markdown files with YAML frontmatter
- Agents configure a model, tools (in frontmatter), and instructions (in the body)
- Tools can be: builtin (like \`executeCommand\`), MCP integrations, or **other agents**
- **"Workflows" are just agents that orchestrate other agents** by having them as tools

## How multi-agent workflows work

1. **Create an orchestrator agent** that has other agents in its \`tools\`
2. **Run the orchestrator**: \`rowboatx --agent orchestrator_name\`
3. The orchestrator calls other agents as tools when needed
4. Data flows through tool call parameters and responses

## Agent File Format

Agent files are **Markdown files with YAML frontmatter**. The frontmatter contains configuration (model, tools), and the body contains the instructions.

### Basic Structure
\`\`\`markdown
---
model: gpt-5.1
tools:
  tool_key:
    type: builtin
    name: tool_name
---
# Instructions

Your detailed instructions go here in Markdown format.
\`\`\`

### Frontmatter Fields
- \`model\`: (OPTIONAL) Model to use (e.g., 'gpt-5.1', 'claude-sonnet-4-5')
- \`provider\`: (OPTIONAL) Provider alias from models.json
- \`tools\`: (OPTIONAL) Object containing tool definitions

### Instructions (Body)
The Markdown body after the frontmatter contains the agent's instructions. Use standard Markdown formatting.

### Naming Rules
- Agent filename determines the agent name (without .md extension)
- Example: \`summariser_agent.md\` creates an agent named "summariser_agent"
- Use lowercase with underscores for multi-word names
- No spaces or special characters in names

### Agent Format Example
\`\`\`markdown
---
model: gpt-5.1
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
      required:
        - query
---
# Web Search Agent

You are a web search agent. When asked a question:

1. Use the search tool to find relevant information
2. Summarize the results clearly
3. Cite your sources

Be concise and accurate.
\`\`\`

## Tool Types & Schemas

Tools in agents must follow one of three types. Each has specific required fields.

### 1. Builtin Tools
Internal Rowboat tools (executeCommand, file operations, MCP queries, etc.)

**YAML Schema:**
\`\`\`yaml
tool_key:
  type: builtin
  name: tool_name
\`\`\`

**Required fields:**
- \`type\`: Must be "builtin"
- \`name\`: Builtin tool name (e.g., "executeCommand", "workspace-readFile")

**Example:**
\`\`\`yaml
bash:
  type: builtin
  name: executeCommand
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

**YAML Schema:**
\`\`\`yaml
tool_key:
  type: mcp
  name: tool_name_from_server
  description: What the tool does
  mcpServerName: server_name_from_config
  inputSchema:
    type: object
    properties:
      param:
        type: string
        description: Parameter description
    required:
      - param
\`\`\`

**Required fields:**
- \`type\`: Must be "mcp"
- \`name\`: Exact tool name from MCP server
- \`description\`: What the tool does (helps agent understand when to use it)
- \`mcpServerName\`: Server name from config/mcp.json
- \`inputSchema\`: Full JSON Schema object for tool parameters

**Example:**
\`\`\`yaml
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
    required:
      - query
\`\`\`

**Important:**
- Use \`listMcpTools\` to get the exact inputSchema from the server
- Copy the schema exactly—don't modify property types or structure
- Only include \`required\` array if parameters are mandatory

### 3. Agent Tools (for chaining agents)
Reference other agents as tools to build multi-agent workflows

**YAML Schema:**
\`\`\`yaml
tool_key:
  type: agent
  name: target_agent_name
\`\`\`

**Required fields:**
- \`type\`: Must be "agent"
- \`name\`: Name of the target agent (must exist in agents/ directory)

**Example:**
\`\`\`yaml
summariser:
  type: agent
  name: summariser_agent
\`\`\`

**How it works:**
- Use \`type: agent\` to call other agents as tools
- The target agent will be invoked with the parameters you pass
- Results are returned as tool output
- This is how you build multi-agent workflows
- The referenced agent file must exist (e.g., \`agents/summariser_agent.md\`)

## Complete Multi-Agent Workflow Example

**Podcast creation workflow** - This is all done through agents calling other agents:

**1. Task-specific agent** (\`agents/summariser_agent.md\`):
\`\`\`markdown
---
model: gpt-5.1
tools:
  bash:
    type: builtin
    name: executeCommand
---
# Summariser Agent

Download and summarise an arxiv paper. Use curl to fetch the PDF.
Output just the GIST in two lines. Don't ask for human input.
\`\`\`

**2. Agent that delegates to other agents** (\`agents/summarise-a-few.md\`):
\`\`\`markdown
---
model: gpt-5.1
tools:
  summariser:
    type: agent
    name: summariser_agent
---
# Summarise Multiple Papers

Pick 2 interesting papers and summarise each using the summariser tool.
Pass the paper URL to the tool. Don't ask for human input.
\`\`\`

**3. Orchestrator agent** (\`agents/podcast_workflow.md\`):
\`\`\`markdown
---
model: gpt-5.1
tools:
  bash:
    type: builtin
    name: executeCommand
  summarise_papers:
    type: agent
    name: summarise-a-few
  text_to_speech:
    type: mcp
    name: text_to_speech
    mcpServerName: elevenLabs
    description: Generate audio from text
    inputSchema:
      type: object
      properties:
        text:
          type: string
          description: Text to convert to speech
---
# Podcast Workflow

Create a podcast from arXiv papers:

1. Fetch arXiv papers about agents using bash
2. Pick papers and summarise them using summarise_papers
3. Create a podcast transcript
4. Generate audio using text_to_speech

Execute these steps in sequence.
\`\`\`

**To run this workflow**: \`rowboatx --agent podcast_workflow\`

## Naming and organization rules
- **All agents live in \`agents/*.md\`** - Markdown files with YAML frontmatter
- Agent filename (without .md) becomes the agent name
- When referencing an agent as a tool, use its filename without extension
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
- Agent files MUST be valid Markdown with YAML frontmatter
- Agent filename (without .md) becomes the agent name
- Tools in frontmatter MUST have valid \`type\` ("builtin", "mcp", or "agent")
- MCP tools MUST have all required fields: name, description, mcpServerName, inputSchema
- Agent tools MUST reference existing agent files
- Invalid agents will fail to load and prevent workflow execution

### File Creation/Update Process
1. When creating an agent, use \`workspace-writeFile\` with valid Markdown + YAML frontmatter
2. When updating an agent, read it first with \`workspace-readFile\`, modify, then use \`workspace-writeFile\`
3. Validate YAML syntax in frontmatter before writing—malformed YAML breaks the agent
4. **Quote strings containing colons** (e.g., \`description: "Default: 8"\` not \`description: Default: 8\`)
5. Test agent loading after creation/update by using \`analyzeAgent\`

### Common Validation Errors to Avoid

❌ **WRONG - Missing frontmatter delimiters:**
\`\`\`markdown
model: gpt-5.1
# My Agent
Instructions here
\`\`\`

❌ **WRONG - Invalid YAML indentation:**
\`\`\`markdown
---
tools:
bash:
  type: builtin
---
\`\`\`
(bash should be indented under tools)

❌ **WRONG - Invalid tool type:**
\`\`\`yaml
tools:
  tool1:
    type: custom
    name: something
\`\`\`
(type must be builtin, mcp, or agent)

❌ **WRONG - Unquoted strings containing colons:**
\`\`\`yaml
tools:
  search:
    description: Number of results (default: 8)
\`\`\`
(Strings with colons must be quoted: \`description: "Number of results (default: 8)"\`)

❌ **WRONG - MCP tool missing required fields:**
\`\`\`yaml
tools:
  search:
    type: mcp
    name: firecrawl_search
\`\`\`
(Missing: description, mcpServerName, inputSchema)

✅ **CORRECT - Minimal valid agent** (\`agents/simple_agent.md\`):
\`\`\`markdown
---
model: gpt-5.1
---
# Simple Agent

Do simple tasks as instructed.
\`\`\`

✅ **CORRECT - Agent with MCP tool** (\`agents/search_agent.md\`):
\`\`\`markdown
---
model: gpt-5.1
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
---
# Search Agent

Use the search tool to find information on the web.
\`\`\`

## Capabilities checklist
1. Explore \`agents/\` directory to understand existing agents before editing
2. Read existing agents with \`workspace-readFile\` before making changes
3. Validate YAML frontmatter syntax before creating/updating agents
4. Use \`analyzeAgent\` to verify agent structure after creation/update
5. When creating multi-agent workflows, create an orchestrator agent
6. Add other agents as tools with \`type: agent\` for chaining
7. Use \`listMcpServers\` and \`listMcpTools\` when adding MCP integrations
8. Confirm work done and outline next steps once changes are complete
`;

export default skill;
