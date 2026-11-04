# Local code navigation with Sem

[Sem](https://github.com/Ataraxy-Labs/sem) is a local CLI and stdio MCP server
for entity search, callers, impact analysis, and code diffs. This optional setup
uses Rowboat's existing MCP client; it does not replace normal file tools.

Install Sem separately and check `sem --version` (tested with 0.27.0).
In **Settings → MCP Servers**, add this entry to your existing `mcpServers`
object, replacing both absolute paths with paths on the machine running Rowboat:

```json
{
  "mcpServers": {
    "sem": {
      "command": "/absolute/path/to/sem",
      "args": ["mcp"],
      "env": {
        "SEM_REPO": "/absolute/path/to/your/repository",
        "SEM_NO_NETWORK": "1",
        "SEM_NO_TELEMETRY": "1"
      }
    }
  }
}
```

Save without removing other servers. An absolute executable path avoids relying
on the desktop app's PATH. No Sem account or model API key is needed to run the
server; Rowboat's model configuration remains separate.

Ask Rowboat to list Sem's tools, then find a known function with `sem_find`.
For source and adjacent callers, request `sem_find` with `mode: "context"` and
`token_budget: 1200`. Only request context for symbols relevant to your task.

Only connect trusted checkouts. Sem may write index caches, and tools such as
`sem_check` can execute repository validation commands. Neither `SEM_REPO` nor
the offline flags form a filesystem sandbox. Apply your normal MCP permissions
and approvals; do not infer that all advertised tools are read-only.

To remove the integration, delete only the `sem` entry in settings and save.
This example does not establish compiler completeness or task-speed improvements.
