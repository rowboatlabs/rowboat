export const skill = String.raw`
# Background Agents

Load this skill whenever a user wants to inspect, create, edit, or schedule background agents inside the Rowboat workspace.

## Core Concepts

**IMPORTANT**: In the CLI, there are NO separate "workflow" files. Everything is an agent.

- **All definitions live in ` + "`agents/*.md`" + `** - Markdown files with YAML frontmatter
- Agents configure a model, tools (in frontmatter), and instructions (in the body)
- Tools can be: builtin (like ` + "`executeCommand`" + `), MCP integrations, or **other agents**
- **"Workflows" are just agents that orchestrate other agents** by having them as tools
- **Background agents run on schedules** defined in ` + "`~/.rowboat/config/agent-schedule.json`" + `

## How multi-agent workflows work

1. **Create an orchestrator agent** that has other agents in its ` + "`tools`" + `
2. **Schedule the orchestrator** in agent-schedule.json (see Scheduling section below)
3. The orchestrator calls other agents as tools when needed
4. Data flows through tool call parameters and responses

## Scheduling Background Agents

Background agents run automatically based on schedules defined in ` + "`~/.rowboat/config/agent-schedule.json`" + `.

### Schedule Configuration File

` + "```json" + `
{
  "agents": {
    "agent_name": {
      "schedule": { ... },
      "enabled": true
    }
  }
}
` + "```" + `

### Schedule Types

**IMPORTANT: All times are in local time** (the timezone of the machine running Rowboat).

**1. Cron Schedule** - Runs at exact times defined by cron expression
` + "```json" + `
{
  "schedule": {
    "type": "cron",
    "expression": "0 8 * * *"
  },
  "enabled": true
}
` + "```" + `

Common cron expressions:
- ` + "`*/5 * * * *`" + ` - Every 5 minutes
- ` + "`0 8 * * *`" + ` - Every day at 8am
- ` + "`0 9 * * 1`" + ` - Every Monday at 9am
- ` + "`0 0 1 * *`" + ` - First day of every month at midnight

**2. Window Schedule** - Runs once during a time window
` + "```json" + `
{
  "schedule": {
    "type": "window",
    "cron": "0 0 * * *",
    "startTime": "08:00",
    "endTime": "10:00"
  },
  "enabled": true
}
` + "```" + `

The agent will run once at a random time within the window. Use this when you want flexibility (e.g., "sometime in the morning" rather than "exactly at 8am").

**3. Once Schedule** - Runs exactly once at a specific time
` + "```json" + `
{
  "schedule": {
    "type": "once",
    "runAt": "2024-02-05T10:30:00"
  },
  "enabled": true
}
` + "```" + `

Use this for one-time tasks like migrations or setup scripts. The ` + "`runAt`" + ` is in local time (no Z suffix).

### Starting Message

You can specify a ` + "`startingMessage`" + ` that gets sent to the agent when it starts. If not provided, defaults to ` + "`\"go\"`" + `.

` + "```json" + `
{
  "schedule": { "type": "cron", "expression": "0 8 * * *" },
  "enabled": true,
  "startingMessage": "Please summarize my emails from the last 24 hours"
}
` + "```" + `

### Description

You can add a ` + "`description`" + ` field to describe what the agent does. This is displayed in the UI.

` + "```json" + `
{
  "schedule": { "type": "cron", "expression": "0 8 * * *" },
  "enabled": true,
  "description": "Summarizes emails and calendar events every morning"
}
` + "```" + `

### Complete Schedule Example

` + "```json" + `
{
  "agents": {
    "daily_digest": {
      "schedule": {
        "type": "cron",
        "expression": "0 8 * * *"
      },
      "enabled": true,
      "description": "Daily email and calendar summary",
      "startingMessage": "Summarize my emails and calendar for today"
    },
    "morning_briefing": {
      "schedule": {
        "type": "window",
        "cron": "0 0 * * *",
        "startTime": "07:00",
        "endTime": "09:00"
      },
      "enabled": true,
      "description": "Morning news and updates briefing"
    },
    "one_time_setup": {
      "schedule": {
        "type": "once",
        "runAt": "2024-12-01T12:00:00"
      },
      "enabled": true,
      "description": "One-time data migration task"
    }
  }
}
` + "```" + `

### Schedule State (Read-Only)

**IMPORTANT: Do NOT modify ` + "`agent-schedule-state.json`" + `** - it is managed automatically by the background runner.

The runner automatically tracks execution state in ` + "`~/.rowboat/config/agent-schedule-state.json`" + `:
- ` + "`status`" + `: scheduled, running, finished, failed, triggered (for once-schedules)
- ` + "`lastRunAt`" + `: When the agent last ran
- ` + "`nextRunAt`" + `: When the agent will run next
- ` + "`lastError`" + `: Error message if the last run failed
- ` + "`runCount`" + `: Total number of runs

When you add an agent to ` + "`agent-schedule.json`" + `, the runner will automatically create and manage its state entry. You only need to edit ` + "`agent-schedule.json`" + `.

## Agent File Format

Agent files are **Markdown files with YAML frontmatter**. The frontmatter contains configuration (model, tools), and the body contains the instructions.

### Basic Structure
` + "```markdown" + `
---
model: gpt-5.1
tools:
  tool_key:
    type: builtin
    name: tool_name
---
# Instructions

Your detailed instructions go here in Markdown format.
` + "```" + `

### Frontmatter Fields
- ` + "`model`" + `: (OPTIONAL) Model to use (e.g., 'gpt-5.1', 'claude-sonnet-4-5')
- ` + "`provider`" + `: (OPTIONAL) Provider alias from models.json
- ` + "`tools`" + `: (OPTIONAL) Object containing tool definitions

### Instructions (Body)
The Markdown body after the frontmatter contains the agent's instructions. Use standard Markdown formatting.

### Naming Rules
- Agent filename determines the agent name (without .md extension)
- Example: ` + "`summariser_agent.md`" + ` creates an agent named "summariser_agent"
- Use lowercase with underscores for multi-word names
- No spaces or special characters in names
- **The agent name in agent-schedule.json must match the filename** (without .md)

### Agent Format Example
` + "```markdown" + `
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
` + "```" + `

## Tool Types & Schemas

Tools in agents must follow one of three types. Each has specific required fields.

### 1. Builtin Tools
Internal Rowboat tools (executeCommand, file operations, MCP queries, etc.)

**YAML Schema:**
` + "```yaml" + `
tool_key:
  type: builtin
  name: tool_name
` + "```" + `

**Required fields:**
- ` + "`type`" + `: Must be "builtin"
- ` + "`name`" + `: Builtin tool name (e.g., "executeCommand", "workspace-readFile")

**Example:**
` + "```yaml" + `
bash:
  type: builtin
  name: executeCommand
` + "```" + `

**Available builtin tools:**
- ` + "`executeCommand`" + ` - Execute shell commands
- ` + "`workspace-readFile`" + `, ` + "`workspace-writeFile`" + `, ` + "`workspace-remove`" + ` - File operations
- ` + "`workspace-readdir`" + `, ` + "`workspace-exists`" + `, ` + "`workspace-stat`" + ` - Directory operations
- ` + "`workspace-mkdir`" + `, ` + "`workspace-rename`" + `, ` + "`workspace-copy`" + ` - File/directory management
- ` + "`analyzeAgent`" + ` - Analyze agent structure
- ` + "`addMcpServer`" + `, ` + "`listMcpServers`" + `, ` + "`listMcpTools`" + ` - MCP management
- ` + "`loadSkill`" + ` - Load skill guidance

### 2. MCP Tools
Tools from external MCP servers (APIs, databases, web scraping, etc.)

**YAML Schema:**
` + "```yaml" + `
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
` + "```" + `

**Required fields:**
- ` + "`type`" + `: Must be "mcp"
- ` + "`name`" + `: Exact tool name from MCP server
- ` + "`description`" + `: What the tool does (helps agent understand when to use it)
- ` + "`mcpServerName`" + `: Server name from config/mcp.json
- ` + "`inputSchema`" + `: Full JSON Schema object for tool parameters

**Example:**
` + "```yaml" + `
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
` + "```" + `

**Important:**
- Use ` + "`listMcpTools`" + ` to get the exact inputSchema from the server
- Copy the schema exactly—don't modify property types or structure
- Only include ` + "`required`" + ` array if parameters are mandatory

### 3. Agent Tools (for chaining agents)
Reference other agents as tools to build multi-agent workflows

**YAML Schema:**
` + "```yaml" + `
tool_key:
  type: agent
  name: target_agent_name
` + "```" + `

**Required fields:**
- ` + "`type`" + `: Must be "agent"
- ` + "`name`" + `: Name of the target agent (must exist in agents/ directory)

**Example:**
` + "```yaml" + `
summariser:
  type: agent
  name: summariser_agent
` + "```" + `

**How it works:**
- Use ` + "`type: agent`" + ` to call other agents as tools
- The target agent will be invoked with the parameters you pass
- Results are returned as tool output
- This is how you build multi-agent workflows
- The referenced agent file must exist (e.g., ` + "`agents/summariser_agent.md`" + `)

## Complete Multi-Agent Workflow Example

**Email digest workflow** - This is all done through agents calling other agents:

**1. Task-specific agent** (` + "`agents/email_reader.md`" + `):
` + "```markdown" + `
---
model: gpt-5.1
tools:
  read_file:
    type: builtin
    name: workspace-readFile
  list_dir:
    type: builtin
    name: workspace-readdir
---
# Email Reader Agent

Read emails from the gmail_sync folder and extract key information.
Look for unread or recent emails and summarize the sender, subject, and key points.
Don't ask for human input.
` + "```" + `

**2. Agent that delegates to other agents** (` + "`agents/daily_summary.md`" + `):
` + "```markdown" + `
---
model: gpt-5.1
tools:
  email_reader:
    type: agent
    name: email_reader
  write_file:
    type: builtin
    name: workspace-writeFile
---
# Daily Summary Agent

1. Use the email_reader tool to get email summaries
2. Create a consolidated daily digest
3. Save the digest to ~/Desktop/daily_digest.md

Don't ask for human input.
` + "```" + `

Note: The output path (` + "`~/Desktop/daily_digest.md`" + `) is hardcoded in the instructions. When creating agents that output files, always ask the user where they want files saved and include the full path in the agent instructions.

**3. Orchestrator agent** (` + "`agents/morning_briefing.md`" + `):
` + "```markdown" + `
---
model: gpt-5.1
tools:
  daily_summary:
    type: agent
    name: daily_summary
  search:
    type: mcp
    name: search
    mcpServerName: exa
    description: Search the web for news
    inputSchema:
      type: object
      properties:
        query:
          type: string
          description: Search query
---
# Morning Briefing Workflow

Create a morning briefing:

1. Get email digest using daily_summary
2. Search for relevant news using the search tool
3. Compile a comprehensive morning briefing

Execute these steps in sequence. Don't ask for human input.
` + "```" + `

**4. Schedule the workflow** in ` + "`~/.rowboat/config/agent-schedule.json`" + `:
` + "```json" + `
{
  "agents": {
    "morning_briefing": {
      "schedule": {
        "type": "cron",
        "expression": "0 7 * * *"
      },
      "enabled": true,
      "startingMessage": "Create my morning briefing for today"
    }
  }
}
` + "```" + `

This schedules the morning briefing workflow to run every day at 7am local time.

## Naming and organization rules
- **All agents live in ` + "`agents/*.md`" + `** - Markdown files with YAML frontmatter
- Agent filename (without .md) becomes the agent name
- When referencing an agent as a tool, use its filename without extension
- When scheduling an agent, use its filename without extension in agent-schedule.json
- Use relative paths (no \${BASE_DIR} prefixes) when giving examples to users

## Best practices for background agents
1. **Single responsibility**: Each agent should do one specific thing well
2. **Clear delegation**: Agent instructions should explicitly say when to call other agents
3. **Autonomous operation**: Add "Don't ask for human input" for background agents
4. **Data passing**: Make it clear what data to extract and pass between agents
5. **Tool naming**: Use descriptive tool keys (e.g., "summariser", "fetch_data", "analyze")
6. **Orchestration**: Create a top-level agent that coordinates the workflow
7. **Scheduling**: Use appropriate schedule types - cron for recurring, window for flexible timing, once for one-time tasks
8. **Error handling**: Background agents should handle errors gracefully since there's no human to intervene
9. **Avoid executeCommand**: Do NOT attach ` + "`executeCommand`" + ` to background agents as it poses security risks when running unattended. Instead, use the specific builtin tools needed (` + "`workspace-readFile`" + `, ` + "`workspace-writeFile`" + `, etc.) or MCP tools for external integrations
10. **File output paths**: When creating an agent that outputs files, ASK the user where the file should be stored (default to Desktop: ` + "`~/Desktop`" + `). Then hardcode the full output path in the agent's instructions so it knows exactly where to write files. Example instruction: "Save the output to /Users/username/Desktop/daily_report.md"

## Validation & Best Practices

### CRITICAL: Schema Compliance
- Agent files MUST be valid Markdown with YAML frontmatter
- Agent filename (without .md) becomes the agent name
- Tools in frontmatter MUST have valid ` + "`type`" + ` ("builtin", "mcp", or "agent")
- MCP tools MUST have all required fields: name, description, mcpServerName, inputSchema
- Agent tools MUST reference existing agent files
- Invalid agents will fail to load and prevent workflow execution

### File Creation/Update Process
1. When creating an agent, use ` + "`workspace-writeFile`" + ` with valid Markdown + YAML frontmatter
2. When updating an agent, read it first with ` + "`workspace-readFile`" + `, modify, then use ` + "`workspace-writeFile`" + `
3. Validate YAML syntax in frontmatter before writing—malformed YAML breaks the agent
4. **Quote strings containing colons** (e.g., ` + "`description: \"Default: 8\"`" + ` not ` + "`description: Default: 8`" + `)
5. Test agent loading after creation/update by using ` + "`analyzeAgent`" + `

### Common Validation Errors to Avoid

❌ **WRONG - Missing frontmatter delimiters:**
` + "```markdown" + `
model: gpt-5.1
# My Agent
Instructions here
` + "```" + `

❌ **WRONG - Invalid YAML indentation:**
` + "```markdown" + `
---
tools:
bash:
  type: builtin
---
` + "```" + `
(bash should be indented under tools)

❌ **WRONG - Invalid tool type:**
` + "```yaml" + `
tools:
  tool1:
    type: custom
    name: something
` + "```" + `
(type must be builtin, mcp, or agent)

❌ **WRONG - Unquoted strings containing colons:**
` + "```yaml" + `
tools:
  search:
    description: Number of results (default: 8)
` + "```" + `
(Strings with colons must be quoted: ` + "`description: \"Number of results (default: 8)\"`" + `)

❌ **WRONG - MCP tool missing required fields:**
` + "```yaml" + `
tools:
  search:
    type: mcp
    name: firecrawl_search
` + "```" + `
(Missing: description, mcpServerName, inputSchema)

✅ **CORRECT - Minimal valid agent** (` + "`agents/simple_agent.md`" + `):
` + "```markdown" + `
---
model: gpt-5.1
---
# Simple Agent

Do simple tasks as instructed.
` + "```" + `

✅ **CORRECT - Agent with MCP tool** (` + "`agents/search_agent.md`" + `):
` + "```markdown" + `
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
` + "```" + `

## Capabilities checklist
1. Explore ` + "`agents/`" + ` directory to understand existing agents before editing
2. Read existing agents with ` + "`workspace-readFile`" + ` before making changes
3. Validate YAML frontmatter syntax before creating/updating agents
4. Use ` + "`analyzeAgent`" + ` to verify agent structure after creation/update
5. When creating multi-agent workflows, create an orchestrator agent
6. Add other agents as tools with ` + "`type: agent`" + ` for chaining
7. Use ` + "`listMcpServers`" + ` and ` + "`listMcpTools`" + ` when adding MCP integrations
8. Configure schedules in ` + "`~/.rowboat/config/agent-schedule.json`" + ` (ONLY edit this file, NOT the state file)
9. Confirm work done and outline next steps once changes are complete
`;

export default skill;
