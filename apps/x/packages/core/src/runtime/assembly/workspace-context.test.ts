import { describe, expect, it } from "vitest";
import { loadWorkspaceContext } from "./workspace-context.js";

const loaders = {
    loadNotes: () => "# Agent Memory\n\nnotes",
    loadWorkDir: (key: string) => (key === "chat-1" ? "/Users/me/work" : null),
};

describe("loadWorkspaceContext", () => {
    it("loads notes and work dir for workspaceContext-trait agents", () => {
        expect(loadWorkspaceContext("copilot", "chat-1", loaders)).toEqual({
            agentNotesContext: "# Agent Memory\n\nnotes",
            userWorkDir: "/Users/me/work",
        });
        // rowboatx is the copilot alias.
        expect(loadWorkspaceContext("rowboatx", "chat-1", loaders).userWorkDir).toBe(
            "/Users/me/work",
        );
    });

    it("returns nulls for non-workspace agents even when the loaders would yield values", () => {
        // THE gate this module exists for: a caller cannot leak the user's
        // agent-memory into a background/knowledge agent's prompt by
        // forgetting a trait check — the check lives here.
        for (const agentId of ["background-task-agent", "note_creation", "some-user-agent"]) {
            expect(loadWorkspaceContext(agentId, "chat-1", loaders)).toEqual({
                agentNotesContext: null,
                userWorkDir: null,
            });
        }
        expect(loadWorkspaceContext(null, "chat-1", loaders).agentNotesContext).toBeNull();
        expect(loadWorkspaceContext(undefined, "chat-1", loaders).agentNotesContext).toBeNull();
    });

    it("skips the work-dir lookup without a key", () => {
        expect(loadWorkspaceContext("copilot", null, loaders)).toEqual({
            agentNotesContext: "# Agent Memory\n\nnotes",
            userWorkDir: null,
        });
    });
});
