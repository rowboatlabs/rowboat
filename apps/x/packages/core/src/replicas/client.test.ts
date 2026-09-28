import { describe, expect, it } from "vitest";
import { chatIdFor, environmentRepositories, normalizeEnvironment, normalizeWorkspace, unwrapList } from "./client.js";

// The Replicas docs publish endpoint names, not response schemas, so the
// readers accept every plausible shape. These pin the shapes we accept.

describe("unwrapList", () => {
    it("accepts a bare array or any of the known wrapper keys", () => {
        expect(unwrapList([{ id: "a" }, "junk", { id: "b" }])).toEqual([{ id: "a" }, { id: "b" }]);
        expect(unwrapList({ data: [{ id: "a" }] })).toEqual([{ id: "a" }]);
        expect(unwrapList({ environments: [{ id: "a" }] }, ["environments"])).toEqual([{ id: "a" }]);
        expect(unwrapList({ nope: [{ id: "a" }] })).toEqual([]);
        expect(unwrapList("string")).toEqual([]);
    });
});

describe("normalizeEnvironment / environmentRepositories", () => {
    it("reads repo names from strings, objects, arrays, and a repository set", () => {
        expect(environmentRepositories({ repository: "rowboatlabs/rowboat" })).toEqual(["rowboatlabs/rowboat"]);
        expect(environmentRepositories({ repository: { full_name: "rowboatlabs/rowboat", name: "rowboat" } })).toEqual(["rowboatlabs/rowboat"]);
        expect(environmentRepositories({ repositories: [{ name: "a" }, "b", { slug: "c" }] })).toEqual(["a", "b", "c"]);
        expect(environmentRepositories({ repository_set: { repositories: [{ full_name: "x/y" }] } })).toEqual(["x/y"]);
        expect(environmentRepositories({})).toEqual([]);
    });

    it("falls back to the first repo, then the id, for a nameless environment", () => {
        expect(normalizeEnvironment({ id: "env_1", repository: "x/y" })).toEqual({ id: "env_1", name: "x/y", repositories: ["x/y"] });
        expect(normalizeEnvironment({ environment_id: "env_2" })).toEqual({ id: "env_2", name: "env_2", repositories: [] });
        expect(normalizeEnvironment({ name: "no id" })).toBeNull();
    });
});

describe("normalizeWorkspace", () => {
    it("reads a flat resource and a wrapped one, with status/url/chat aliases", () => {
        expect(normalizeWorkspace({ id: "ws_1", status: "starting", url: "https://app.replicas.dev/w/ws_1", chat_id: "c1" })).toMatchObject({
            id: "ws_1",
            status: "starting",
            url: "https://app.replicas.dev/w/ws_1",
            chatId: "c1",
        });
        expect(normalizeWorkspace({ replica: { replica_id: "ws_2", state: "awake", app_url: "https://x", chat: { id: "c2" } } })).toMatchObject({
            id: "ws_2",
            status: "awake",
            url: "https://x",
            chatId: "c2",
        });
        expect(normalizeWorkspace({ data: { id: "ws_3" } })?.id).toBe("ws_3");
        expect(normalizeWorkspace({ message: "no id here" })).toBeNull();
        expect(normalizeWorkspace(null)).toBeNull();
    });

    it("reads the live shape: per-harness chats with processing, repositories, and branch diffs", () => {
        // Captured 2026-09-28 from GET /v1/replica/{id}.
        const live = {
            replica: {
                id: "a63727a4-5ec9-4fdd-bd3e-b3bafc0c2f26",
                name: "summarize-last-commit-main-gxu8",
                status: "active",
                source: "api",
                repositories: [{ id: "r1", name: "rowboatlabs/rowboat", url: "https://github.com/rowboatlabs/rowboat.git" }],
                chats: [
                    { id: "chat-claude", provider: "claude", title: "Claude Code", processing: true },
                    { id: "chat-codex", provider: "codex", title: "Codex", processing: false },
                ],
                repository_statuses: [{ repository: "rowboat", branch: "main", default_branch: "main", git_diff: { added: 12, removed: 3 } }],
            },
        };
        const ws = normalizeWorkspace(live)!;
        expect(ws.status).toBe("active");
        expect(ws.url).toBeNull();
        expect(ws.processing).toBe(true);
        expect(ws.chats.map((c) => c.provider)).toEqual(["claude", "codex"]);
        expect(ws.repositories).toEqual(["rowboatlabs/rowboat"]);
        expect(ws.branches).toEqual([{ repository: "rowboat", branch: "main", added: 12, removed: 3 }]);
        expect(chatIdFor(ws, "codex")).toBe("chat-codex");
        expect(chatIdFor(ws, "claude")).toBe("chat-claude");
        expect(chatIdFor(ws, "cursor")).toBe("chat-claude"); // first chat when no provider match
    });
});
