export const skill = String.raw`
# Builtin Tools Reference

Load this skill when creating or modifying agents that need access to Rowboat's builtin tools (shell execution, file operations, etc.).

## Available Builtin Tools

Agents can use builtin tools by declaring them in the \`"tools"\` object with \`"type": "builtin"\` and the appropriate \`"name"\`.

### executeCommand
**The most powerful and versatile builtin tool** - Execute any bash/shell command and get the output.

**Security note:** Commands are filtered through \`.rowboat/config/security.json\`. Populate this file with allowed command names (array or dictionary entries). Any command not present is blocked and returns exit code 126 so the agent knows it violated the policy.

**Agent tool declaration:**
\`\`\`json
"tools": {
  "bash": {
    "type": "builtin",
    "name": "executeCommand"
  }
}
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

**Example agent with executeCommand:**
\`\`\`json
{
  "name": "arxiv-feed-reader",
  "description": "A feed reader for the arXiv",
  "model": "gpt-5.1",
  "instructions": "Extract latest papers from the arXiv feed and summarize them. Use curl to fetch the RSS feed, then parse it with yq and jq:\n\ncurl -s https://rss.arxiv.org/rss/cs.AI | yq -p=xml -o=json | jq -r '.rss.channel.item[] | select(.title | test(\"agent\"; \"i\")) | \"\\(.title)\\n\\(.link)\\n\\(.description)\\n\"'\n\nThis will give you papers containing 'agent' in the title.",
  "tools": {
    "bash": {
      "type": "builtin",
      "name": "executeCommand"
    }
  }
}
\`\`\`

**Another example - System monitoring agent:**
\`\`\`json
{
  "name": "system-monitor",
  "description": "Monitor system resources and processes",
  "model": "gpt-5.1",
  "instructions": "Monitor system resources using bash commands. Use 'df -h' for disk usage, 'free -h' for memory, 'top -bn1' for processes, 'ps aux' for process list. Parse the output and report any issues.",
  "tools": {
    "bash": {
      "type": "builtin",
      "name": "executeCommand"
    }
  }
}
\`\`\`

**Another example - Git automation agent:**
\`\`\`json
{
  "name": "git-helper",
  "description": "Automate git operations",
  "model": "gpt-5.1",
  "instructions": "Help with git operations. Use commands like 'git status', 'git log --oneline -10', 'git diff', 'git branch -a' to inspect the repository. Can also run 'git add', 'git commit', 'git push' when instructed.",
  "tools": {
    "bash": {
      "type": "builtin",
      "name": "executeCommand"
    }
  }
}
\`\`\`

## Agent-to-Agent Calling

Agents can call other agents as tools to create complex multi-step workflows. This is the core mechanism for building multi-agent systems in the CLI.

**Tool declaration:**
\`\`\`json
"tools": {
  "summariser": {
    "type": "agent",
    "name": "summariser_agent"
  }
}
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

**Example - Agent that delegates to a summarizer:**
\`\`\`json
{
  "name": "paper_analyzer",
  "model": "gpt-5.1",
  "instructions": "Pick 2 interesting papers and summarise each using the summariser tool. Pass the paper URL to the summariser. Don't ask for human input.",
  "tools": {
    "summariser": {
      "type": "agent",
      "name": "summariser_agent"
    }
  }
}
\`\`\`

**Tips for agent chaining:**
- Make instructions explicit about when to call other agents
- Pass clear, structured data between agents
- Add "Don't ask for human input" for autonomous workflows
- Keep each agent focused on a single responsibility

## Additional Builtin Tools

While \`executeCommand\` is the most versatile, other builtin tools exist for specific Rowboat operations (file management, agent inspection, etc.). These are primarily used by the Rowboat copilot itself and are not typically needed in user agents. If you need file operations, consider using bash commands like \`cat\`, \`echo\`, \`tee\`, etc. through \`executeCommand\`.

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
- **Use agent tools (\`"type": "agent"\`)** when you need: Complex multi-step logic, task delegation, specialized processing that benefits from LLM reasoning

Many tasks can be accomplished with just \`executeCommand\` and common Unix tools - it's incredibly powerful!

## Key Insight: Multi-Agent Workflows

In the CLI, multi-agent workflows are built by:
1. Creating specialized agents for specific tasks (in \`agents/\` directory)
2. Creating an orchestrator agent that has other agents in its \`tools\`
3. Running the orchestrator with \`rowboatx --agent orchestrator_name\`

There are no separate "workflow" files - everything is an agent!
`;

export default skill;
