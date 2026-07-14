// The builtin-tool catalog schema: every entry is {description, inputSchema,
// execute, permission, isAvailable?}. Shared typing for the domain modules
// and the merged catalog.
//
// Failure convention: builtins return an error envelope instead of throwing —
// `{ error: "…" }`, `{ success: false, error|message: "…" }`, or composio's
// `{ successful: false }`. The turns tool-registry bridge maps those to the
// durable result's isError flag, so don't put a top-level `error` string on
// a SUCCESS return.

import { z, ZodType } from "zod";

// Every builtin declares its permission policy; the declaration travels with
// the tool so a new tool cannot silently skip gating (the checker fails
// closed for anything undeclared or unknown). Policies:
//   "none"              — never requires permission (read-only or local,
//                         user-visible effects).
//   "prompt"            — always requires permission, generic request.
//   "command-allowlist" — executeCommand's blocklist/allowlist analysis.
//   "file-boundary"     — workspace-boundary + file-grant analysis.
//   "composio-execute"  — Composio action execution (toolkit/tool request).
//   "mcp-execute"       — MCP tool execution (server/tool request).
export const BuiltinToolPermission = z.enum([
    "none",
    "prompt",
    "command-allowlist",
    "file-boundary",
    "composio-execute",
    "mcp-execute",
]);

export const BuiltinToolsSchema = z.record(z.string(), z.object({
    description: z.string(),
	inputSchema: z.custom<ZodType>(),
    execute: z.function({
        input: z.any(), // (input, ctx?) => Promise<any>
        output: z.promise(z.any()),
    }),
    permission: BuiltinToolPermission,
    isAvailable: z.custom<() => Promise<boolean>>().optional(),
}));
