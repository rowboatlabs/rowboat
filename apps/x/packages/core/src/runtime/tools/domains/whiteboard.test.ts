import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_WHITEBOARD_CONTENT } from "@x/shared/dist/spaces.js";
import { WHITEBOARD_TOOL_NAMES, whiteboardTools } from "./whiteboard.js";
import { parseWhiteboardSnapshot, serializeWhiteboardSnapshot, type WbElement } from "../../../spaces/whiteboard.js";

// The tools compose the org's agent face — read_asset, propose_change,
// list_spaces — through the same executeTool hop the projected spaces tools
// use. These tests stand in for the org with a scripted MCP server.

const ORG = { id: "org-1", name: "Rowboat", address: "rowboat.spaces.test" };
const SPACE = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const uploadBlob = vi.fn(async () => ({ hash: "b".repeat(64), size: 1, mime: "application/json" }));
vi.mock("../../../spaces/orgs.js", () => ({
    listOrgs: () => [ORG],
    orgForSpacesMcpServerName: () => null,
    spacesMcpServerNameFor: (id: string) => (id === ORG.id ? "spaces-rowboat" : null),
    getClient: () => ({ uploadBlob }),
}));

const executeTool = vi.fn();
vi.mock("../../../mcp/mcp.js", () => ({ executeTool: (...args: unknown[]) => executeTool(...args) }));

const getBlob = vi.fn();
vi.mock("../../../spaces/blob-cache.js", () => ({ getBlob: (...args: unknown[]) => getBlob(...args) }));

type Call = { tool: string; args: Record<string, unknown> };
const calls = (): Call[] => executeTool.mock.calls.map(([, tool, args]) => ({ tool: tool as string, args: args as Record<string, unknown> }));

const ok = (structuredContent: unknown) => ({ content: [], structuredContent });
const mcpError = (code: string, message: string) => ({
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ code, message, retryable: false }) }],
});

/** Script the org: a map of tool → handler, called in order. */
function org(handlers: Record<string, (args: Record<string, unknown>, nth: number) => unknown>) {
    const counts = new Map<string, number>();
    executeTool.mockImplementation(async (server: string, tool: string, args: Record<string, unknown>) => {
        expect(server).toBe("spaces-rowboat");
        const handler = handlers[tool];
        if (!handler) throw new Error(`unexpected tool call ${tool}`);
        const nth = counts.get(tool) ?? 0;
        counts.set(tool, nth + 1);
        return handler(args, nth);
    });
}

const boardWith = (elements: WbElement[]) => serializeWhiteboardSnapshot(elements);
const rect = (id: string, x: number, extra: Partial<WbElement> = {}): WbElement => ({
    id,
    type: "rectangle",
    x,
    y: 0,
    width: 100,
    height: 60,
    version: 3,
    versionNonce: 11,
    index: "a0",
    isDeleted: false,
    ...extra,
});

const read = whiteboardTools["whiteboard-read"]!;
const draw = whiteboardTools["whiteboard-draw"]!;

beforeEach(() => {
    executeTool.mockReset();
    getBlob.mockReset();
    uploadBlob.mockClear();
});

describe("catalog shape", () => {
    it("exposes exactly the two tools, read ungated and draw gated", () => {
        expect(WHITEBOARD_TOOL_NAMES).toEqual(["whiteboard-read", "whiteboard-draw"]);
        expect(read.permission).toBe("none");
        expect(draw.permission).toBe("prompt");
    });
});

describe("whiteboard-read", () => {
    it("reads the default board and returns the summary with ids and bounds", async () => {
        org({
            read_asset: (args) => {
                expect(args).toEqual({ spaceId: SPACE, path: "whiteboards/board.excalidraw" });
                return ok({
                    path: "whiteboards/board.excalidraw",
                    content: boardWith([rect("a", 0), rect("b", 300)]),
                    version: 7,
                    recentHistory: [{ reason: "whiteboard", committedAt: "2026-09-12T10:00:00.000Z" }],
                });
            },
        });
        const result = (await read.execute({ spaceId: SPACE })) as Record<string, unknown>;
        expect(result).toMatchObject({
            success: true,
            board: "whiteboards/board.excalidraw",
            name: "board",
            version: 7,
            empty: false,
            lastChange: { reason: "whiteboard", at: "2026-09-12T10:00:00.000Z" },
            counts: { shapes: 2, texts: 0, connectors: 0, other: 0 },
            bounds: { minX: 0, minY: 0, maxX: 400, maxY: 60 },
        });
        expect((result.shapes as unknown[]).map((s) => (s as { id: string }).id)).toEqual(["a", "b"]);
    });

    it("resolves a board by name and reads a blob-backed snapshot through the cache", async () => {
        getBlob.mockResolvedValue({ bytes: new TextEncoder().encode(boardWith([rect("big", 0)])), mime: "application/json" });
        org({
            read_asset: (args) => {
                expect(args.path).toBe("whiteboards/roadmap.excalidraw");
                return ok({ path: args.path, content: "", blob: { hash: "c".repeat(64), size: 10, mime: "application/json" }, version: 2, recentHistory: [] });
            },
        });
        const result = (await read.execute({ spaceId: SPACE, board: "roadmap" })) as Record<string, unknown>;
        expect(result.success).toBe(true);
        expect(getBlob).toHaveBeenCalledWith(ORG.id, SPACE, "c".repeat(64));
        expect((result.shapes as unknown[])).toHaveLength(1);
    });

    // A missing board is the normal state of a fresh space, not an error: an
    // error result here sent the model off reading skill sources and running
    // shell commands instead of drawing (dogfood, 2026-09-12).
    it("answers a fresh space with a successful 'does not exist yet, draw creates it'", async () => {
        org({
            read_asset: () => mcpError("not_found", "no such asset"),
            list_spaces: () => ok({ spaces: [{ id: SPACE, name: "Notes", kind: "direct", memberCount: 1, assets: [{ path: "README.md", version: 1, updatedAt: "" }] }] }),
        });
        const result = (await read.execute({ spaceId: SPACE })) as Record<string, unknown>;
        expect(result).toMatchObject({
            success: true,
            exists: false,
            empty: true,
            board: "whiteboards/board.excalidraw",
            name: "board",
            boards: [],
        });
        expect(result.error).toBeUndefined();
        expect(result.next).toMatch(/no boards yet.*whiteboard-draw creates "board" on the first draw/);
    });

    it("names the boards the space has when the one asked for does not exist", async () => {
        org({
            read_asset: () => mcpError("not_found", "no such asset"),
            list_spaces: () =>
                ok({
                    spaces: [
                        { id: "other", name: "Other", kind: "shared", memberCount: 1, assets: [{ path: "whiteboards/x.excalidraw", version: 1, updatedAt: "" }] },
                        {
                            id: SPACE,
                            name: "Design",
                            kind: "shared",
                            memberCount: 3,
                            assets: [
                                { path: "README.md", version: 4, updatedAt: "" },
                                { path: "whiteboards/roadmap.excalidraw", version: 9, updatedAt: "" },
                                { path: "whiteboards/board.excalidraw", version: 2, updatedAt: "" },
                            ],
                        },
                    ],
                }),
        });
        const result = (await read.execute({ spaceId: SPACE, board: "launch" })) as Record<string, unknown>;
        expect(result).toMatchObject({ success: true, exists: false, empty: true, name: "launch", board: "whiteboards/launch.excalidraw" });
        expect(result.next).toBe(
            'No board "launch" here yet; whiteboard-draw creates it on the first draw. To draw on an existing board instead, pass board: one of "roadmap", "board".',
        );
        expect(result.boards).toEqual([
            { path: "whiteboards/roadmap.excalidraw", name: "roadmap", version: 9 },
            { path: "whiteboards/board.excalidraw", name: "board", version: 2 },
        ]);
    });

    it("surfaces other org errors and non-board files plainly", async () => {
        org({ read_asset: () => mcpError("forbidden", "not a member") });
        expect(await read.execute({ spaceId: SPACE })).toEqual({ success: false, error: "not a member" });

        org({ read_asset: () => ok({ path: "whiteboards/board.excalidraw", content: "# a markdown file", version: 1, recentHistory: [] }) });
        const result = (await read.execute({ spaceId: SPACE })) as { success: boolean; error: string };
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not a whiteboard snapshot/);
    });
});

describe("whiteboard-draw", () => {
    it("creates the board on first draw: base version 0, single-line snapshot, the reason as given", async () => {
        let stored: string | undefined;
        org({
            read_asset: () => mcpError("not_found", "no such asset"),
            propose_change: (args) => {
                stored = args.newContent as string;
                expect(args).toMatchObject({ spaceId: SPACE, path: "whiteboards/board.excalidraw", baseVersion: 0, reason: "sketched the flow" });
                expect(args.blob).toBeUndefined();
                return ok({ outcome: "applied", version: 1, changeSet: {} });
            },
        });
        const result = (await draw.execute({
            spaceId: SPACE,
            reason: "sketched the flow",
            ops: [
                { op: "add", id: "start", shape: "rectangle", text: "Start", x: 0, y: 0 },
                { op: "add", id: "end", shape: "ellipse", text: "End", rightOf: "start" },
                { op: "connect", from: "start", to: "end", label: "go" },
            ],
        })) as Record<string, unknown>;
        expect(result).toMatchObject({
            success: true,
            created: true,
            board: "whiteboards/board.excalidraw",
            version: 1,
            updated: [],
            deleted: [],
            counts: { shapes: 2, texts: 0, connectors: 1, other: 0 },
        });
        expect(result.added).toEqual([
            { id: "start", type: "rectangle", text: "Start" },
            { id: "end", type: "ellipse", text: "End" },
            { id: expect.any(String), type: "arrow", text: "go" },
        ]);
        expect(stored).toBeDefined();
        expect(stored!.includes("\n")).toBe(false);
        const elements = parseWhiteboardSnapshot(stored!)!;
        // shape + label, shape + label, arrow + label
        expect(elements).toHaveLength(6);
        expect(elements.every((e) => typeof e.index === "string" && e.version === 1 || e.version === 2)).toBe(true);
    });

    it("draws onto an existing board without touching what is there", async () => {
        const existing = [rect("theirs", 0, { version: 9, versionNonce: 42, index: "a3", customData: { keep: true } })];
        let stored: WbElement[] = [];
        org({
            read_asset: () => ok({ path: "whiteboards/board.excalidraw", content: boardWith(existing), version: 4, recentHistory: [] }),
            propose_change: (args) => {
                expect(args.baseVersion).toBe(4);
                stored = parseWhiteboardSnapshot(args.newContent as string)!;
                return ok({ outcome: "applied", version: 5, changeSet: {} });
            },
        });
        const result = (await draw.execute({ spaceId: SPACE, reason: "added a step", ops: [{ op: "add", id: "mine", shape: "rectangle", text: "Mine", rightOf: "theirs" }] })) as Record<string, unknown>;
        expect(result).toMatchObject({ success: true, created: false, version: 5 });
        expect(stored.find((e) => e.id === "theirs")).toEqual(existing[0]);
        expect(stored.find((e) => e.id === "mine")).toMatchObject({ x: 180, index: "a4" });
    });

    it("re-applies the same ops over the current scene after a conflict, then succeeds", async () => {
        const proposals: Array<Record<string, unknown>> = [];
        const theirs = rect("theirs", 500, { index: "a0" });
        org({
            read_asset: () => ok({ path: "whiteboards/board.excalidraw", content: EMPTY_WHITEBOARD_CONTENT, version: 1, recentHistory: [] }),
            propose_change: (args, nth) => {
                proposals.push(args);
                if (nth === 0) {
                    return ok({ outcome: "conflict", currentVersion: 2, currentContent: boardWith([theirs]), regions: [], recentHistory: [] });
                }
                return ok({ outcome: "applied", version: 3, changeSet: {} });
            },
        });
        const result = (await draw.execute({ spaceId: SPACE, reason: "r", ops: [{ op: "add", id: "mine", shape: "text", text: "hi", x: 0, y: 0 }] })) as Record<string, unknown>;
        expect(result).toMatchObject({ success: true, version: 3, counts: { shapes: 1, texts: 1 } });
        expect(proposals).toHaveLength(2);
        expect(proposals[0]!.baseVersion).toBe(1);
        expect(proposals[1]!.baseVersion).toBe(2);
        const second = parseWhiteboardSnapshot(proposals[1]!.newContent as string)!;
        expect(second.map((e) => e.id).sort()).toEqual(["mine", "theirs"]);
        // Placed after their z-order key, not ours from the first attempt.
        expect(second.find((e) => e.id === "mine")!.index).toBe("a1");
    });

    it("gives up after repeated conflicts without writing", async () => {
        org({
            read_asset: () => ok({ path: "whiteboards/board.excalidraw", content: EMPTY_WHITEBOARD_CONTENT, version: 1, recentHistory: [] }),
            propose_change: (_args, nth) => ok({ outcome: "conflict", currentVersion: 10 + nth, currentContent: EMPTY_WHITEBOARD_CONTENT, regions: [], recentHistory: [] }),
        });
        const result = (await draw.execute({ spaceId: SPACE, reason: "r", ops: [{ op: "add", shape: "text", text: "hi" }] })) as { success: boolean; error: string };
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/kept changing/);
        expect(calls().filter((c) => c.tool === "propose_change")).toHaveLength(3);
    });

    it("writes nothing when an op is invalid, and says which", async () => {
        org({
            read_asset: () => ok({ path: "whiteboards/board.excalidraw", content: boardWith([rect("a", 0)]), version: 1, recentHistory: [] }),
            propose_change: () => {
                throw new Error("must not propose");
            },
        });
        const result = (await draw.execute({ spaceId: SPACE, reason: "r", ops: [{ op: "connect", from: "a", to: "zzz" }] })) as { success: boolean; error: string };
        expect(result.success).toBe(false);
        expect(result.error).toContain('no element "zzz"');
        expect(calls().some((c) => c.tool === "propose_change")).toBe(false);
    });

    it("reports a merged outcome from what the org actually stored", async () => {
        const merged = boardWith([rect("a", 0), rect("b", 300)]);
        org({
            read_asset: () => ok({ path: "whiteboards/board.excalidraw", content: boardWith([rect("a", 0)]), version: 1, recentHistory: [] }),
            propose_change: () => ok({ outcome: "merged", version: 2, mergedContent: merged, changeSet: {} }),
        });
        const result = (await draw.execute({ spaceId: SPACE, reason: "r", ops: [{ op: "add", shape: "text", text: "hi" }] })) as Record<string, unknown>;
        expect(result).toMatchObject({ success: true, version: 2, counts: { shapes: 2, texts: 0 } });
    });

    it("falls back to a blob version for a snapshot past the text cap", async () => {
        org({
            read_asset: () => ok({ path: "whiteboards/board.excalidraw", content: EMPTY_WHITEBOARD_CONTENT, version: 1, recentHistory: [] }),
            propose_change: (args) => {
                expect(args.newContent).toBeUndefined();
                expect(args.blob).toBe("b".repeat(64));
                return ok({ outcome: "applied", version: 2, changeSet: {} });
            },
        });
        // 1,000 free-text elements of ~1KB each comfortably exceed 900KB.
        const ops = Array.from({ length: 1000 }, (_, i) => ({ op: "add" as const, shape: "text" as const, text: `${i} ${"x".repeat(950)}`, x: 0, y: i * 40 }));
        const result = (await draw.execute({ spaceId: SPACE, reason: "r", ops })) as Record<string, unknown>;
        expect(result.success).toBe(true);
        expect(uploadBlob).toHaveBeenCalledTimes(1);
        const [spaceId, bytes, meta] = uploadBlob.mock.calls[0] as unknown as [string, Uint8Array, { declaredMime: string }];
        expect(spaceId).toBe(SPACE);
        expect(bytes.byteLength).toBeGreaterThan(900_000);
        expect(meta).toEqual({ declaredMime: "application/json" });
    });

    it("draws on a named board", async () => {
        org({
            read_asset: (args) => {
                expect(args.path).toBe("whiteboards/launch.excalidraw");
                return mcpError("not_found", "");
            },
            propose_change: (args) => {
                expect(args.path).toBe("whiteboards/launch.excalidraw");
                return ok({ outcome: "applied", version: 1, changeSet: {} });
            },
        });
        const result = (await draw.execute({ spaceId: SPACE, board: "launch", reason: "r", ops: [{ op: "add", shape: "text", text: "hi" }] })) as Record<string, unknown>;
        expect(result).toMatchObject({ success: true, name: "launch", created: true });
    });
});
