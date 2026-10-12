/**
 * MCP Eval Test Harness
 *
 * Mock-based evaluation suite for the builtin MCP tool domain.
 * Tests that the four builtin MCP tools (executeMcpTool, listMcpTools,
 * listMcpServers, addMcpServer) parse inputs, validate schemas, and
 * surface errors correctly — without requiring a live MCP server.
 *
 * These tests mock the real MCP client functions (executeTool, listTools,
 * listServers) and the config repo (IMcpConfigRepo) so the evaluation
 * harness is deterministic, fast, and CI-friendly.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mcpTools } from "./mcp.js";

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.mock factory calls are hoisted to top of file, so
// factory variables must also be hoisted via vi.hoisted().
// ---------------------------------------------------------------------------

const {
  mockExecuteTool,
  mockListTools,
  mockListServers,
  mockUpsert,
  mockResolve,
} = vi.hoisted(() => {
  const mockUpsert = vi.fn();
  return {
    mockExecuteTool: vi.fn(),
    mockListTools: vi.fn(),
    mockListServers: vi.fn(),
    mockUpsert,
    mockResolve: vi.fn().mockImplementation(<T>(name: string): T => {
      if (name === "mcpConfigRepo") {
        return {
          ensureConfig: vi.fn(),
          getConfig: vi.fn().mockResolvedValue({ mcpServers: {} }),
          upsert: mockUpsert,
          delete: vi.fn(),
        } as unknown as T;
      }
      throw new Error(`Unknown container key: ${name}`);
    }),
  };
});

vi.mock("../../../mcp/mcp.js", () => ({
  executeTool: mockExecuteTool,
  listServers: mockListServers,
  listTools: mockListTools,
}));

vi.mock("../../../di/container.js", () => ({
  default: { resolve: mockResolve },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ToolFn = (input: Record<string, unknown>) => Promise<unknown>;

function tool(name: keyof typeof mcpTools): ToolFn {
  const entry = mcpTools[name];
  if (!entry?.execute) {
    throw new Error(`No execute function for builtin tool '${name}'`);
  }
  return (input: Record<string, unknown>) => (entry.execute as (input: Record<string, unknown>) => Promise<unknown>)(input);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// executeMcpTool
// ===========================================================================

describe("executeMcpTool", () => {
  it("executes a tool on an MCP server and returns the result", async () => {
    mockExecuteTool.mockResolvedValue({ content: [{ type: "text", text: "Hello from MCP" }] });

    const result = await tool("executeMcpTool")({
      serverName: "my-server",
      toolName: "greet",
      arguments: { name: "World" },
    });

    expect(mockExecuteTool).toHaveBeenCalledWith("my-server", "greet", { name: "World" });
    expect(result).toMatchObject({
      success: true,
      serverName: "my-server",
      toolName: "greet",
    });
  });

  it("works with no arguments provided", async () => {
    mockExecuteTool.mockResolvedValue({ content: [] });

    const result = await tool("executeMcpTool")({
      serverName: "my-server",
      toolName: "ping",
    });

    expect(mockExecuteTool).toHaveBeenCalledWith("my-server", "ping", {});
    expect(result).toMatchObject({ success: true });
  });

  it("surfaces an error from the underlying MCP client", async () => {
    mockExecuteTool.mockRejectedValue(new Error("Connection refused"));

    const result = await tool("executeMcpTool")({
      serverName: "offline-server",
      toolName: "any",
      arguments: {},
    });

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("Connection refused"),
    });
  });

  it("provides a hint when execution fails", async () => {
    mockExecuteTool.mockRejectedValue(new Error("not found"));

    const result = await tool("executeMcpTool")({
      serverName: "x",
      toolName: "y",
    });

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("not found"),
      hint: expect.stringContaining("listMcpTools"),
    });
  });
});

// ===========================================================================
// listMcpTools
// ===========================================================================

describe("listMcpTools", () => {
  const sampleTools = [
    {
      name: "greet",
      description: "Greet someone",
      inputSchema: {
        type: "object" as const,
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
    {
      name: "ping",
      description: "Ping the server",
      inputSchema: { type: "object" as const, properties: {} },
    },
  ];

  it("lists tools from a server", async () => {
    mockListTools.mockResolvedValue({ tools: sampleTools });

    const result = await tool("listMcpTools")({ serverName: "my-server" });

    expect(mockListTools).toHaveBeenCalledWith("my-server", undefined);
    expect(result).toMatchObject({
      serverName: "my-server",
      count: 2,
      result: { tools: sampleTools },
    });
  });

  it("forwards pagination cursor when provided", async () => {
    mockListTools.mockResolvedValue({ tools: sampleTools.slice(0, 1), nextCursor: "cursor-abc" });

    const result = await tool("listMcpTools")({
      serverName: "my-server",
      cursor: "cursor-abc",
    });

    expect(mockListTools).toHaveBeenCalledWith("my-server", "cursor-abc");
    expect(result).toMatchObject({
      result: { nextCursor: "cursor-abc" },
    });
  });

  it("handles errors from the MCP client", async () => {
    mockListTools.mockRejectedValue(new Error("Server unreachable"));

    const result = await tool("listMcpTools")({ serverName: "dead" });

    expect(result).toMatchObject({
      error: expect.stringContaining("Server unreachable"),
    });
  });
});

// ===========================================================================
// listMcpServers
// ===========================================================================

describe("listMcpServers", () => {
  it("lists all registered MCP servers with their connection state", async () => {
    mockListServers.mockResolvedValue({
      mcpServers: {
        "server-a": {
          config: { command: "node", args: ["a.js"] },
          state: "connected",
          error: null,
        },
        "server-b": {
          config: { url: "http://localhost:8080" },
          state: "disconnected",
          error: null,
        },
      },
    });

    const result = await tool("listMcpServers")({});

    expect(result).toMatchObject({
      count: 2,
      result: {
        mcpServers: {
          "server-a": { state: "connected" },
          "server-b": { state: "disconnected" },
        },
      },
    });
  });

  it("returns count 0 when no servers are configured", async () => {
    mockListServers.mockResolvedValue({ mcpServers: {} });

    const result = await tool("listMcpServers")({});

    expect(result).toMatchObject({ count: 0 });
  });

  it("handles errors", async () => {
    mockListServers.mockRejectedValue(new Error("Config read failure"));

    const result = await tool("listMcpServers")({});

    expect(result).toMatchObject({
      error: expect.stringContaining("Config read failure"),
    });
  });
});

// ===========================================================================
// addMcpServer
// ===========================================================================

describe("addMcpServer", () => {
  const stdioConfig = {
    command: "node",
    args: ["server.js"],
    env: { KEY: "value" },
  };

  const httpConfig = {
    url: "http://localhost:8080/mcp",
    headers: { Authorization: "Bearer token" },
  };

  it("adds a valid stdio-based MCP server", async () => {
    const result = await tool("addMcpServer")({
      serverName: "my-server",
      config: stdioConfig,
    });

    expect(mockUpsert).toHaveBeenCalledWith("my-server", stdioConfig);
    expect(result).toMatchObject({ success: true, serverName: "my-server" });
  });

  it("adds a valid HTTP-based MCP server", async () => {
    const result = await tool("addMcpServer")({
      serverName: "http-server",
      config: httpConfig,
    });

    expect(mockUpsert).toHaveBeenCalledWith("http-server", httpConfig);
    expect(result).toMatchObject({ success: true });
  });

  it("rejects an invalid server config with validation errors", async () => {
    const result = await tool("addMcpServer")({
      serverName: "bad-server",
      config: { command: 42 }, // command should be a string, not number
    });

    // The invalid config should fail McpServerDefinition.safeParse
    expect(result).toMatchObject({
      success: false,
      message: expect.stringContaining("validation"),
      validationErrors: expect.arrayContaining([expect.any(String)]),
      providedDefinition: { command: 42 },
    });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("rejects a config that matches neither stdio nor http schema", async () => {
    const result = await tool("addMcpServer")({
      serverName: "weird",
      config: { something: "else" },
    });

    expect(result).toMatchObject({
      success: false,
      validationErrors: expect.any(Array),
    });
  });

  it("surfaces repo errors gracefully", async () => {
    mockUpsert.mockRejectedValue(new Error("Disk full"));

    const result = await tool("addMcpServer")({
      serverName: "failing",
      config: httpConfig,
    });

    expect(result).toMatchObject({
      error: expect.stringContaining("Disk full"),
    });
  });
});
