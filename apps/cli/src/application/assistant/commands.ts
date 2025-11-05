import { z } from "zod";
import {
  listWorkflows,
  getWorkflow,
  upsertWorkflow,
  deleteWorkflow,
} from "./workflows/service.js";
import {
  listAgents,
  getAgent,
  upsertAgent,
  deleteAgent,
} from "./agents/service.js";
import {
  readMcpConfig,
  writeMcpConfig,
} from "./mcp/service.js";
import { Agent } from "../entities/agent.js";
import { Workflow } from "../entities/workflow.js";

export const ChatCommand = z.object({
  action: z.enum([
    "help",
    "general_chat",
    "list_workflows",
    "get_workflow",
    "describe_workflows",
    "create_workflow",
    "update_workflow",
    "delete_workflow",
    "list_agents",
    "get_agent",
    "create_agent",
    "update_agent",
    "delete_agent",
    "list_mcp_servers",
    "add_mcp_server",
    "remove_mcp_server",
    "run_workflow",
    "unknown",
  ]),
  id: z.string().optional(),
  query: z.string().optional(),
  updates: Workflow.partial().optional(),
  server: z
    .object({
      name: z.string(),
      url: z.string(),
    })
    .optional(),
  name: z.string().optional(),
  clarification: z.string().optional(),
  ids: z.array(z.string()).optional(),
  scope: z.enum(["all"]).optional(),
});

export type ChatCommandT = z.infer<typeof ChatCommand>;

export type CommandStatus = "ok" | "error";

export interface CommandOutcome {
  status: CommandStatus;
  headline: string;
  details?: string;
  list?: string[];
  data?: unknown;
}

function asCommandOutcome(
  outcome: Omit<CommandOutcome, "status"> & { status?: CommandStatus }
): CommandOutcome {
  return {
    status: outcome.status ?? "ok",
    headline: outcome.headline,
    details: outcome.details,
    list: outcome.list,
    data: outcome.data,
  };
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[a.length][b.length];
}

function resolveWorkflowId(
  input: string,
  existing: string[]
): { id?: string; suggestion?: string } {
  const exact = existing.find((candidate) => candidate === input);
  if (exact) return { id: exact };

  const normalizedInput = normalizeKey(input);
  const normalizedMap = new Map<string, string>();
  for (const candidate of existing) {
    const key = normalizeKey(candidate);
    if (!normalizedMap.has(key)) normalizedMap.set(key, candidate);
  }
  const normalizedMatch = normalizedMap.get(normalizedInput);
  if (normalizedMatch) return { id: normalizedMatch };

  const ranked = existing
    .map((candidate) => ({
      id: candidate,
      distance: levenshtein(normalizeKey(candidate), normalizedInput),
    }))
    .sort((a, b) => a.distance - b.distance);

  const best = ranked[0];
  if (best && best.distance <= 2) {
    return { id: best.id };
  }

  return { suggestion: best?.id };
}

export async function executeCommand(cmd: ChatCommandT): Promise<CommandOutcome> {
  switch (cmd.action) {
    case "help":
      return asCommandOutcome({
        headline: "Try asking for workflows, agents, or MCP servers.",
        list: [
          "list workflows",
          "show workflow example_workflow",
          "show all workflows in detail",
          "create workflow demo that calls function get_date",
          "list agents",
          "add mcp server staging at http://localhost:8800",
        ],
      });
    case "list_workflows": {
      const items = listWorkflows();
      return asCommandOutcome({
        headline:
          items.length === 0
            ? "No workflows saved yet."
            : `Found ${items.length} workflow${items.length === 1 ? "" : "s"}.`,
        list: items,
        data: { items },
      });
    }
    case "get_workflow": {
      if (!cmd.id) {
        return asCommandOutcome({
          status: "error",
          headline: "Workflow id required.",
          details: "Provide the workflow name you want to inspect.",
        });
      }
      const allWorkflows = listWorkflows();
      const { id: resolvedId, suggestion } = resolveWorkflowId(cmd.id, allWorkflows);
      if (!resolvedId) {
        return asCommandOutcome({
          status: "error",
          headline: `Workflow "${cmd.id}" was not found.`,
          details: suggestion ? `Did you mean "${suggestion}"?` : undefined,
        });
      }
      const workflow = getWorkflow(resolvedId);
      if (!workflow) {
        return asCommandOutcome({
          status: "error",
          headline: `Workflow "${resolvedId}" could not be loaded.`,
        });
      }
      return asCommandOutcome({
        headline: `Loaded workflow "${resolvedId}".`,
        details: workflow.description || "No description set.",
        data: workflow,
        list: workflow.steps.map((step, index) => `${index + 1}. ${step.type} → ${step.id}`),
      });
    }
    case "describe_workflows": {
      const allWorkflows = listWorkflows();
      const explicitIds = cmd.ids?.map((value) => value.trim()).filter((value) => value.length > 0) ?? [];
      const targetIds =
        explicitIds.length > 0 ? Array.from(new Set(explicitIds)) : cmd.scope === "all" ? [...allWorkflows] : [];

      if (targetIds.length === 0) {
        return asCommandOutcome({
          status: "error",
          headline: "No workflows specified.",
          details:
            explicitIds.length === 0 && cmd.scope !== "all"
              ? "Provide workflow ids or set scope to \"all\"."
              : "No workflows found to describe.",
        });
      }

      const described: Array<{ id: string; workflow: z.infer<typeof Workflow> }> = [];
      const missing: string[] = [];
      const suggestions: string[] = [];
      const seen = new Set<string>();

      if (explicitIds.length === 0 && cmd.scope === "all") {
        for (const id of allWorkflows) {
          const workflow = getWorkflow(id);
          if (workflow && !seen.has(id)) {
            seen.add(id);
            described.push({ id, workflow });
          }
        }
      } else {
        for (const requestedId of targetIds) {
          const { id: resolvedId, suggestion } = resolveWorkflowId(requestedId, allWorkflows);
          if (!resolvedId) {
            missing.push(requestedId);
            if (suggestion) suggestions.push(`${requestedId} → ${suggestion}`);
            continue;
          }
          if (seen.has(resolvedId)) continue;
          seen.add(resolvedId);
          const workflow = getWorkflow(resolvedId);
          if (workflow) {
            described.push({ id: resolvedId, workflow });
          } else {
            missing.push(requestedId);
          }
        }
      }

      if (described.length === 0) {
        return asCommandOutcome({
          status: "error",
          headline: "No workflows found.",
          details: `Checked: ${targetIds.join(", ")}`,
        });
      }

      const list = described.map(({ workflow }) => {
        const description = workflow.description ? workflow.description : "No description set.";
        const steps = workflow.steps.map((step, index) => `${index + 1}. ${step.type} → ${step.id}`).join("; ");
        return `${workflow.name}: ${description} Steps: ${steps || "None"}.`;
      });

      const details =
        missing.length > 0
          ? `Missing workflows: ${missing.join(", ")}.${suggestions.length > 0 ? ` Closest matches: ${suggestions.join(", ")}.` : ""}`
          : suggestions.length > 0
            ? `Closest matches: ${suggestions.join(", ")}.`
            : undefined;

      return asCommandOutcome({
        headline: `Showing ${described.length} workflow${described.length === 1 ? "" : "s"}.`,
        details,
        list,
        data: {
          workflows: described.map(({ workflow }) => workflow),
          missing,
        },
      });
    }
    case "general_chat":
      if (!cmd.query) {
        return asCommandOutcome({
          status: "error",
          headline: "Need the question to answer.",
          details: "Repeat your request so I can help.",
        });
      }
      return asCommandOutcome({
        headline: "General assistance requested.",
        details: cmd.query,
        data: { query: cmd.query },
      });
    case "create_workflow": {
      if (!cmd.id) {
        return asCommandOutcome({
          status: "error",
          headline: "Workflow id required.",
          details: "Name the workflow you want to create.",
        });
      }
      const created = upsertWorkflow(cmd.id, { ...(cmd.updates ?? {}) });
      return asCommandOutcome({
        headline: `Workflow "${cmd.id}" saved.`,
        data: created,
      });
    }
    case "update_workflow": {
      if (!cmd.id) {
        return asCommandOutcome({
          status: "error",
          headline: "Workflow id required.",
          details: "Name the workflow you want to update.",
        });
      }
      const updated = upsertWorkflow(cmd.id, { ...(cmd.updates ?? {}) });
      return asCommandOutcome({
        headline: `Workflow "${cmd.id}" updated.`,
        data: updated,
      });
    }
    case "delete_workflow": {
      if (!cmd.id) {
        return asCommandOutcome({
          status: "error",
          headline: "Workflow id required.",
          details: "Name the workflow you want to delete.",
        });
      }
      const deleted = deleteWorkflow(cmd.id);
      return asCommandOutcome({
        headline: deleted
          ? `Workflow "${cmd.id}" deleted.`
          : `Workflow "${cmd.id}" did not exist.`,
        data: { deleted },
      });
    }
    case "list_agents": {
      const items = listAgents();
      return asCommandOutcome({
        headline:
          items.length === 0
            ? "No agents saved yet."
            : `Found ${items.length} agent${items.length === 1 ? "" : "s"}.`,
        list: items,
        data: { items },
      });
    }
    case "get_agent": {
      if (!cmd.id) {
        return asCommandOutcome({
          status: "error",
          headline: "Agent id required.",
          details: "Provide the agent name you want to inspect.",
        });
      }
      const agent = getAgent(cmd.id);
      if (!agent) {
        return asCommandOutcome({
          status: "error",
          headline: `Agent "${cmd.id}" was not found.`,
        });
      }
      return asCommandOutcome({
        headline: `Loaded agent "${cmd.id}".`,
        details: agent.description || "No description set.",
        data: agent,
      });
    }
    case "create_agent": {
      if (!cmd.id) {
        return asCommandOutcome({
          status: "error",
          headline: "Agent id required.",
          details: "Name the agent you want to create.",
        });
      }
      const created = upsertAgent(cmd.id, { ...(cmd.updates ?? {}) });
      return asCommandOutcome({
        headline: `Agent "${cmd.id}" saved.`,
        data: created,
      });
    }
    case "update_agent": {
      if (!cmd.id) {
        return asCommandOutcome({
          status: "error",
          headline: "Agent id required.",
          details: "Name the agent you want to update.",
        });
      }
      const updated = upsertAgent(cmd.id, { ...(cmd.updates ?? {}) });
      return asCommandOutcome({
        headline: `Agent "${cmd.id}" updated.`,
        data: updated,
      });
    }
    case "delete_agent": {
      if (!cmd.id) {
        return asCommandOutcome({
          status: "error",
          headline: "Agent id required.",
          details: "Name the agent you want to delete.",
        });
      }
      const deleted = deleteAgent(cmd.id);
      return asCommandOutcome({
        headline: deleted
          ? `Agent "${cmd.id}" deleted.`
          : `Agent "${cmd.id}" did not exist.`,
        data: { deleted },
      });
    }
    case "list_mcp_servers": {
      const config = readMcpConfig();
      const servers = config.mcpServers;
      return asCommandOutcome({
        headline:
          servers.length === 0
            ? "No MCP servers configured."
            : `Found ${servers.length} MCP server${servers.length === 1 ? "" : "s"}.`,
        list: servers.map((server) => `${server.name} → ${server.url}`),
        data: servers,
      });
    }
    case "add_mcp_server": {
      const serverConfig = cmd.server;
      if (!serverConfig) {
        return asCommandOutcome({
          status: "error",
          headline: "Server details required.",
          details: "Provide a name and url for the MCP server.",
        });
      }
      const config = readMcpConfig();
      const withoutExisting = config.mcpServers.filter(
        (server) => server.name !== serverConfig.name
      );
      const updated = {
        mcpServers: [...withoutExisting, { ...serverConfig }],
      };
      writeMcpConfig(updated);
      return asCommandOutcome({
        headline: `MCP server "${serverConfig.name}" saved.`,
        data: updated.mcpServers,
      });
    }
    case "remove_mcp_server": {
      const name = cmd.name;
      if (!name) {
        return asCommandOutcome({
          status: "error",
          headline: "Server name required.",
          details: "Tell me which MCP server to remove.",
        });
      }
      const config = readMcpConfig();
      const remaining = config.mcpServers.filter(
        (server) => server.name !== name
      );
      const removed = remaining.length !== config.mcpServers.length;
      writeMcpConfig({ mcpServers: remaining });
      return asCommandOutcome({
        headline: removed
          ? `MCP server "${name}" removed.`
          : `MCP server "${name}" was not registered.`,
        data: remaining,
      });
    }
    case "run_workflow": {
      if (!cmd.id) {
        return asCommandOutcome({
          status: "error",
          headline: "Workflow id required.",
          details: "Name the workflow you want to run.",
        });
      }
      const workflow = getWorkflow(cmd.id);
      if (!workflow) {
        return asCommandOutcome({
          status: "error",
          headline: `Workflow "${cmd.id}" was not found.`,
        });
      }
      if (workflow.steps.length === 0) {
        return asCommandOutcome({
          headline: `Workflow "${cmd.id}" is empty.`,
          details: "Add function or agent steps before running.",
          data: workflow,
        });
      }
      return asCommandOutcome({
        headline: `Workflow "${cmd.id}" is ready.`,
        details:
          "Running from the copilot will be available once the runtime bridge is connected.",
        list: workflow.steps.map((step, index) => `${index + 1}. ${step.type} → ${step.id}`),
        data: workflow,
      });
    }
    case "unknown":
      return asCommandOutcome({
        status: "error",
        headline: "I need more detail before taking action.",
        details: cmd.clarification ?? "Try rephrasing or be more specific about the workflow, agent, or MCP server.",
      });
  }
}
