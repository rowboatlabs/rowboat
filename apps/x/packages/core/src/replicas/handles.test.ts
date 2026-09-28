import { describe, expect, it } from "vitest";
import {
    extractWorkspaceIds,
    findPullRequestUrls,
    formatWorkspaceHandle,
    resolveWorkspaceRef,
    workspaceNameFor,
} from "./handles.js";

describe("formatWorkspaceHandle / extractWorkspaceIds", () => {
    it("round-trips the handle line with and without a URL", () => {
        const withUrl = formatWorkspaceHandle({ id: "rp_8f2k3j9d", url: "https://app.replicas.dev/w/rp_8f2k3j9d" });
        const withoutUrl = formatWorkspaceHandle({ id: "rp_8f2k3j9d", url: null });
        expect(withUrl).toBe("Replicas workspace `rp_8f2k3j9d` — https://app.replicas.dev/w/rp_8f2k3j9d");
        expect(withoutUrl).toBe("Replicas workspace `rp_8f2k3j9d`");
        expect(extractWorkspaceIds(withUrl)).toEqual(["rp_8f2k3j9d"]);
        expect(extractWorkspaceIds(withoutUrl)).toEqual(["rp_8f2k3j9d"]);
    });

    it("finds handles inside a thread transcript, first appearance first, deduped", () => {
        const thread = [
            "Arjun: @rowboat fix the login timeout on Replicas",
            "Arjun · via Replicas: Sent to Replicas. Replicas workspace `ws_login_timeout_1a2b` — https://app.replicas.dev/w/ws_login_timeout_1a2b",
            "Ramnique: @rowboat also bump the mobile timeout",
            "Ramnique · via Replicas: Steered Replicas workspace `ws_login_timeout_1a2b`.",
        ].join("\n");
        expect(extractWorkspaceIds(thread)).toEqual(["ws_login_timeout_1a2b"]);
    });

    it("reads a bare replicas.dev URL's last id-looking segment and ignores query strings", () => {
        expect(extractWorkspaceIds("see https://app.replicas.dev/replica/abc123def?tab=chat")).toEqual(["abc123def"]);
        expect(extractWorkspaceIds("see https://app.replicas.dev/org/acme/workspaces/01J9XYZABC/chats/7")).toEqual(["01J9XYZABC"]);
    });

    it("ignores prose that merely says replicas", () => {
        expect(extractWorkspaceIds("let's try replicas for this")).toEqual([]);
        expect(extractWorkspaceIds("Replicas workspace is booting")).toEqual([]);
    });
});

describe("resolveWorkspaceRef", () => {
    it("accepts an id, a handle line, or a URL", () => {
        expect(resolveWorkspaceRef("ws_abcdef")).toBe("ws_abcdef");
        expect(resolveWorkspaceRef("Replicas workspace `ws_abcdef`")).toBe("ws_abcdef");
        expect(resolveWorkspaceRef("https://app.replicas.dev/w/ws_abcdef")).toBe("ws_abcdef");
    });
    it("rejects things that are not ids", () => {
        expect(resolveWorkspaceRef("")).toBeNull();
        expect(resolveWorkspaceRef("the one from yesterday")).toBeNull();
    });
});

describe("findPullRequestUrls", () => {
    it("extracts GitHub and GitLab PR links from JSON-ish text, deduped, trailing punctuation stripped", () => {
        const text = '{"text":"Opened https://github.com/rowboatlabs/rowboat/pull/1120. Also https://github.com/rowboatlabs/rowboat/pull/1120"} and https://gitlab.com/acme/app/-/merge_requests/42';
        expect(findPullRequestUrls(text)).toEqual([
            "https://github.com/rowboatlabs/rowboat/pull/1120",
            "https://gitlab.com/acme/app/-/merge_requests/42",
        ]);
    });
    it("does not match issue or repo links", () => {
        expect(findPullRequestUrls("https://github.com/rowboatlabs/rowboat/issues/9 https://github.com/rowboatlabs/rowboat")).toEqual([]);
    });
});

describe("workspaceNameFor", () => {
    it("slugs the task, drops mention tokens and stopwords, and appends the salt", () => {
        expect(workspaceNameFor("[@rowboat](#rowboat) please fix the flaky auth test on Replicas", "zz99")).toBe("fix-flaky-auth-test-zz99");
    });
    it("never returns an empty base", () => {
        expect(workspaceNameFor("!!!", "ab12")).toBe("task-ab12");
    });
});
