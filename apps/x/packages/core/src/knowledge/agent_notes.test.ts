import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ root: "", run: vi.fn() }));
vi.mock("../config/config.js", () => ({ WorkDir: fixture.root }));
vi.mock("../runtime/assembly/headless-app.js", () => ({ runWhenPossible: fixture.run }));
vi.mock("../models/defaults.js", () => ({ asRunModelOptions: () => ({}), getKgModel: async () => null }));
vi.mock("../config/user_config.js", () => ({ loadUserConfig: () => ({ email: "user@example.test" }) }));
vi.mock("./google-client-factory.js", () => ({ GoogleClientFactory: {} }));
vi.mock("./gmail-rate-limit.js", () => ({ gmailRateLimitCooldownMs: () => 0 }));
vi.mock("../services/service_logger.js", () => ({
    serviceLogger: {
        startRun: async () => ({ service: "agent_notes", runId: "test", startedAt: Date.now() }),
        log: async () => {},
    },
}));

afterEach(async () => {
    await fs.rm(fixture.root, { recursive: true, force: true });
});

it("leaves runs outside the prompt batch available for the next pass", async () => {
    fixture.root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-notes-"));
    const runs = path.join(fixture.root, "runs");
    await fs.mkdir(runs);
    for (let index = 1; index <= 6; index++) {
        const line = JSON.stringify({
            agentName: "copilot",
            type: "message",
            message: { role: "user", content: `conversation ${index}` },
        });
        await fs.writeFile(path.join(runs, `run-${index}.jsonl`), line);
    }
    const { processAgentNotes } = await import("./agent_notes.js");
    const { loadAgentNotesState } = await import("./agent_notes_state.js");
    await processAgentNotes();
    expect(fixture.run.mock.calls[0][0].message).not.toContain("conversation 1");
    expect(Object.keys(loadAgentNotesState().processedRuns)).toHaveLength(5);
    await processAgentNotes();
    expect(fixture.run.mock.calls[1][0].message).toContain("conversation 1");
    expect(Object.keys(loadAgentNotesState().processedRuns)).toHaveLength(6);
});
