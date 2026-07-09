import { describe, expect, it } from "vitest";
import {
    agentFromRaw,
    builtinAgentIds,
    hasWorkspaceContext,
    loadAgent,
} from "./registry.js";

describe("agent registry", () => {
    it("knows every historical builtin id, including the rowboatx alias", () => {
        expect(builtinAgentIds().sort()).toEqual(
            [
                "copilot",
                "rowboatx",
                "live-note-agent",
                "background-task-agent",
                "note_creation",
                "note_curation",
                "labeling_agent",
                "note_tagging_agent",
                "inline_task_agent",
                "agent_notes_agent",
            ].sort(),
        );
    });

    it("grants workspace context to the copilot ids only", () => {
        expect(hasWorkspaceContext("copilot")).toBe(true);
        expect(hasWorkspaceContext("rowboatx")).toBe(true);
        expect(hasWorkspaceContext("background-task-agent")).toBe(false);
        expect(hasWorkspaceContext("note_creation")).toBe(false);
        expect(hasWorkspaceContext("some-user-agent")).toBe(false);
        expect(hasWorkspaceContext(null)).toBe(false);
        expect(hasWorkspaceContext(undefined)).toBe(false);
    });

    it("loads the prompt-file knowledge agents with frontmatter config applied", async () => {
        // These ship as raw strings with YAML frontmatter; the shared loader
        // replaces five copy-pasted parsing blocks, so pin its behavior on
        // the real bundled prompts.
        for (const id of [
            "note_creation",
            "note_curation",
            "labeling_agent",
            "note_tagging_agent",
            "inline_task_agent",
            "agent_notes_agent",
        ]) {
            const agent = await loadAgent(id);
            expect(agent.name).toBe(id);
            expect(agent.instructions.length).toBeGreaterThan(0);
            // Frontmatter must be consumed, not left in the instructions.
            expect(agent.instructions.startsWith("---")).toBe(false);
        }
    });

    it("agentFromRaw parses frontmatter into agent config and strips it", () => {
        const raw = [
            "---",
            "tools:",
            "  file-readText:",
            "    type: builtin",
            "    name: file-readText",
            "---",
            "Do the thing.",
        ].join("\n");
        const agent = agentFromRaw("tester", raw);
        expect(agent.name).toBe("tester");
        expect(agent.instructions).toBe("Do the thing.");
        expect(agent.tools).toEqual({
            "file-readText": { type: "builtin", name: "file-readText" },
        });
    });

    it("agentFromRaw passes frontmatter-less prompts through verbatim", () => {
        const agent = agentFromRaw("plain", "Just instructions.");
        expect(agent.instructions).toBe("Just instructions.");
        expect(agent.tools).toBeUndefined();
    });
});
