import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolAttachment } from "@x/shared/dist/agent.js";
import { ToolCallPart } from "@x/shared/dist/message.js";
import { WorkDir } from "../config/config.js";
import type { FileAccessGrant } from "../config/security.js";
import { getToolPermissionMetadata } from "./permission-metadata.js";

function call(toolName: string, args: Record<string, unknown>): z.infer<typeof ToolCallPart> {
    return { type: "tool-call", toolCallId: "tc1", toolName, arguments: args };
}
const builtin = (name: string): z.infer<typeof ToolAttachment> => ({ type: "builtin", name });

// `zzbinary` is not in any plausible allow-list, so executeCommand on it is
// always "blocked" → requires permission, unless the session explicitly allows
// it. This keeps the command-branch tests independent of the dev's config.
describe("getToolPermissionMetadata", () => {
    it("flags a blocked command and lists its command names", async () => {
        const meta = await getToolPermissionMetadata(
            call("executeCommand", { command: "zzbinary --flag" }),
            builtin("executeCommand"),
            new Set(),
            [],
        );
        expect(meta).toEqual({ kind: "command", commandNames: ["zzbinary"] });
    });

    it("short-circuits a command the session already allows", async () => {
        const meta = await getToolPermissionMetadata(
            call("executeCommand", { command: "zzbinary --flag" }),
            builtin("executeCommand"),
            new Set(["zzbinary"]),
            [],
        );
        expect(meta).toBeNull();
    });

    it("requires permission for a write outside the workspace", async () => {
        const dir = await mkdtemp(join(tmpdir(), "perm-meta-"));
        const target = join(dir, "out.txt");
        const meta = await getToolPermissionMetadata(
            call("file-writeText", { path: target }),
            builtin("file-writeText"),
            new Set(),
            [],
        );
        expect(meta).toMatchObject({ kind: "file", operation: "write" });
        expect((meta as { paths: string[] }).paths.length).toBe(1);
    });

    it("short-circuits when a session file grant covers the path", async () => {
        const dir = await mkdtemp(join(tmpdir(), "perm-meta-"));
        const target = join(dir, "out.txt");
        // Stored grants hold canonical paths (the gate compares against the
        // realpath'd target); on macOS /tmp resolves under /private.
        const grant: FileAccessGrant = { operation: "write", pathPrefix: await realpath(dir) };
        const meta = await getToolPermissionMetadata(
            call("file-writeText", { path: target }),
            builtin("file-writeText"),
            new Set(),
            [grant],
        );
        expect(meta).toBeNull();
    });

    it("requires no permission for a path inside the workspace", async () => {
        const inside = join(WorkDir, "knowledge");
        await writeFile(join(WorkDir, "knowledge", ".perm-meta-probe"), "x").catch(() => undefined);
        const meta = await getToolPermissionMetadata(
            call("file-readText", { path: inside }),
            builtin("file-readText"),
            new Set(),
            [],
        );
        expect(meta).toBeNull();
    });

    it("never requires permission for non-builtin (MCP) tools", async () => {
        const meta = await getToolPermissionMetadata(
            call("search", { q: "x" }),
            { type: "mcp", name: "search", description: "", inputSchema: {}, mcpServerName: "srv" },
            new Set(),
            [],
        );
        expect(meta).toBeNull();
    });
});
