export const skill = String.raw`
# Builtin Tools Reference

Load this skill when creating or modifying agents that need access to Rowboat's builtin tools (shell execution, file operations, etc.).

## Available Builtin Tools

Agents can use builtin tools by declaring them in the YAML frontmatter \`tools\` section with \`type: builtin\` and the appropriate \`name\`.

### executeCommand
**The most powerful and versatile builtin tool** - Execute any bash/shell command and get the output.

**Security note:** Commands are filtered through \`.rowboat/config/security.json\`. Populate this file with allowed command names (array or dictionary entries). Any command not present is blocked and returns exit code 126 so the agent knows it violated the policy.

**Agent tool declaration (YAML frontmatter):**
\`\`\`yaml
tools:
  bash:
    type: builtin
    name: executeCommand
\`\`\`

**What it can do:**
- Run package managers (npm, pip, apt, brew, cargo, go get, etc.)
- Git operations (clone, commit, push, pull, status, diff, log, etc.)
- System operations (ps, top, df, du, find, grep, kill, etc.)
- Build and compilation (make, cargo build, go build, npm run build, etc.)
- Network operations (curl, wget, ping, ssh, netstat, etc.)
- Text processing (awk, sed, grep, jq, yq, cut, sort, uniq, etc.)
- Database operations (psql, mysql, mongo, redis-cli, etc.)
- Container operations (docker, kubectl, podman, etc.)
- Testing and debugging (pytest, jest, cargo test, etc.)
- File operations (cat, head, tail, wc, diff, patch, etc.)
- Any CLI tool or script execution

**Agent instruction examples:**
- "Use the bash tool to run git commands for version control operations"
- "Execute curl commands using the bash tool to fetch data from APIs"
- "Use bash to run 'npm install' and 'npm test' commands"
- "Run Python scripts using the bash tool with 'python script.py'"
- "Use bash to execute 'docker ps' and inspect container status"
- "Run database queries using 'psql' or 'mysql' commands via bash"
- "Use bash to execute system monitoring commands like 'top' or 'ps aux'"

**Pro tips for agent instructions:**
- Commands can be chained with && for sequential execution
- Use pipes (|) to combine Unix tools (e.g., "cat file.txt | grep pattern | wc -l")
- Redirect output with > or >> when needed
- Full bash shell features are available (variables, loops, conditionals, etc.)
- Tools like jq, yq, awk, sed can parse and transform data

**Example agent with executeCommand** (\`agents/arxiv-feed-reader.md\`):
\`\`\`markdown
---
model: gpt-5.1
tools:
  bash:
    type: builtin
    name: executeCommand
---
# arXiv Feed Reader

Extract latest papers from the arXiv feed and summarize them.

Use curl to fetch the RSS feed, then parse it with yq and jq:

\\\`\\\`\\\`bash
curl -s https://rss.arxiv.org/rss/cs.AI | yq -p=xml -o=json | jq -r '.rss.channel.item[] | select(.title | test("agent"; "i")) | "\\(.title)\\n\\(.link)\\n\\(.description)\\n"'
\\\`\\\`\\\`

This will give you papers containing 'agent' in the title.
\`\`\`

**Another example - System monitoring agent** (\`agents/system-monitor.md\`):
\`\`\`markdown
---
model: gpt-5.1
tools:
  bash:
    type: builtin
    name: executeCommand
---
# System Monitor

Monitor system resources using bash commands:
- Use 'df -h' for disk usage
- Use 'free -h' for memory
- Use 'top -bn1' for processes
- Use 'ps aux' for process list

Parse the output and report any issues.
\`\`\`

**Another example - Git automation agent** (\`agents/git-helper.md\`):
\`\`\`markdown
---
model: gpt-5.1
tools:
  bash:
    type: builtin
    name: executeCommand
---
# Git Helper

Help with git operations. Use commands like:
- 'git status' - Check working tree status
- 'git log --oneline -10' - View recent commits
- 'git diff' - See changes
- 'git branch -a' - List branches

Can also run 'git add', 'git commit', 'git push' when instructed.
\`\`\`

## Agent-to-Agent Calling

Agents can call other agents as tools to create complex multi-step workflows. This is the core mechanism for building multi-agent systems in the CLI.

**Tool declaration (YAML frontmatter):**
\`\`\`yaml
tools:
  summariser:
    type: agent
    name: summariser_agent
\`\`\`

**When to use:**
- Breaking complex tasks into specialized sub-agents
- Creating reusable agent components
- Orchestrating multi-step workflows
- Delegating specialized tasks (e.g., summarization, data processing, audio generation)

**How it works:**
- The agent calls the tool like any other tool
- The target agent receives the input and processes it
- Results are returned as tool output
- The calling agent can then continue processing or delegate further

**Example - Agent that delegates to a summarizer** (\`agents/paper_analyzer.md\`):
\`\`\`markdown
---
model: gpt-5.1
tools:
  summariser:
    type: agent
    name: summariser_agent
---
# Paper Analyzer

Pick 2 interesting papers and summarise each using the summariser tool.
Pass the paper URL to the summariser. Don't ask for human input.
\`\`\`

**Tips for agent chaining:**
- Make instructions explicit about when to call other agents
- Pass clear, structured data between agents
- Add "Don't ask for human input" for autonomous workflows
- Keep each agent focused on a single responsibility

## Additional Builtin Tools

While \`executeCommand\` is the most versatile, other builtin tools exist for specific Rowboat operations (file management, agent inspection, etc.). These are primarily used by the Rowboat copilot itself and are not typically needed in user agents. If you need file operations, consider using bash commands like \`cat\`, \`echo\`, \`tee\`, etc. through \`executeCommand\`.

### Copilot-Specific Builtin Tools

The Rowboat copilot has access to special builtin tools that regular agents don't typically use. These tools help the copilot assist users with workspace management and MCP integration:

#### File & Directory Operations
- \`workspace-readdir\` - List directory contents (supports recursive exploration)
- \`workspace-readFile\` - Read file contents
- \`workspace-writeFile\` - Create or update file contents
- \`workspace-edit\` - Make precise edits by replacing specific text (safer than full rewrites)
- \`workspace-remove\` - Remove files or directories
- \`workspace-exists\` - Check if a file or directory exists
- \`workspace-stat\` - Get file/directory statistics
- \`workspace-mkdir\` - Create directories
- \`workspace-rename\` - Rename or move files/directories
- \`workspace-copy\` - Copy files
- \`workspace-getRoot\` - Get workspace root directory path
- \`workspace-glob\` - Find files matching a glob pattern (e.g., "**/*.ts", "agents/*.md")
- \`workspace-grep\` - Search file contents using regex, returns matching files and lines

#### Agent Operations
- \`analyzeAgent\` - Read and analyze an agent file structure
- \`loadSkill\` - Load a Rowboat skill definition into context

#### MCP Operations
- \`addMcpServer\` - Add or update an MCP server configuration (with validation)
- \`listMcpServers\` - List all available MCP servers
- \`listMcpTools\` - List all available tools from a specific MCP server
- \`executeMcpTool\` - **Execute a specific MCP tool on behalf of the user**

#### Using executeMcpTool as Copilot

The \`executeMcpTool\` builtin allows the copilot to directly execute MCP tools without creating an agent. Load the "mcp-integration" skill for complete guidance on discovering and executing MCP tools, including workflows, schema matching, and examples.

**When to use executeMcpTool vs creating an agent:**
- Use \`executeMcpTool\` for immediate, one-time tasks
- Create an agent when the user needs repeated use or autonomous operation
- Create an agent for complex multi-step workflows involving multiple tools

## Best Practices

1. **Give agents clear examples** in their instructions showing exact bash commands to run
2. **Explain output parsing** - show how to use jq, yq, grep, awk to extract data
3. **Chain commands efficiently** - use && for sequences, | for pipes
4. **Handle errors** - remind agents to check exit codes and stderr
5. **Be specific** - provide example commands rather than generic descriptions
6. **Security** - remind agents to validate inputs and avoid dangerous operations

## When to Use Builtin Tools vs MCP Tools vs Agent Tools

- **Use builtin executeCommand** when you need: CLI tools, system operations, data processing, git operations, any shell command
- **Use MCP tools** when you need: Web scraping (firecrawl), text-to-speech (elevenlabs), specialized APIs, external service integrations
- **Use agent tools (\`type: agent\`)** when you need: Complex multi-step logic, task delegation, specialized processing that benefits from LLM reasoning

Many tasks can be accomplished with just \`executeCommand\` and common Unix tools - it's incredibly powerful!

## Key Insight: Multi-Agent Workflows

In the CLI, multi-agent workflows are built by:
1. Creating specialized agents as Markdown files in the \`agents/\` directory
2. Creating an orchestrator agent that has other agents in its \`tools\` (YAML frontmatter)
3. Running the orchestrator with \`rowboatx --agent orchestrator_name\`

There are no separate "workflow" files - everything is an agent defined in Markdown!
`;

export default skill;
