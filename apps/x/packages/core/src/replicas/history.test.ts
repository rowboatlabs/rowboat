import { describe, expect, it } from "vitest";
import { summarizeHistory, type HistoryEvent } from "./history.js";

// Shapes lifted from a real workspace on 2026-09-28 (a Claude Code chat
// answering "Summarize the last commit on main.").
const user = (text: string, ts: string): HistoryEvent => ({
    timestamp: ts,
    type: "claude-user",
    payload: { type: "user", message: { role: "user", content: [{ type: "text", text }] } },
});
const toolResult = (ts: string): HistoryEvent => ({
    timestamp: ts,
    type: "claude-user",
    payload: { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "…" }] } },
});
const assistant = (content: unknown[], ts: string): HistoryEvent => ({
    timestamp: ts,
    type: "claude-assistant",
    payload: { type: "assistant", message: { role: "assistant", content } },
});
const result = (text: string, ts: string): HistoryEvent => ({
    timestamp: ts,
    type: "claude-result",
    payload: { stop_reason: "end_turn", result: text, total_cost_usd: 0.19 },
});
const lifecycle = (state: string, ts: string): HistoryEvent => ({
    timestamp: ts,
    type: "claude-command_lifecycle",
    payload: { type: "command_lifecycle", state },
});
const idle = (ts: string): HistoryEvent => ({
    timestamp: ts,
    type: "claude-system",
    payload: { type: "system", subtype: "session_state_changed", state: "idle" },
});

describe("summarizeHistory", () => {
    it("reads a finished answer: result text, stop reason, tool count, and finished", () => {
        const summary = summarizeHistory([
            user("Summarize the last commit on main.", "t0"),
            lifecycle("started", "t1"),
            assistant([{ type: "tool_use", name: "Bash", input: {} }], "t2"),
            toolResult("t3"),
            assistant([{ type: "text", text: "Let me look at the substance of the diff." }], "t4"),
            assistant([{ type: "tool_use", name: "Bash", input: {} }], "t5"),
            toolResult("t6"),
            assistant([{ type: "thinking", thinking: "…" }, { type: "text", text: "The last commit on `main` is c38f69a." }], "t7"),
            result("The last commit on `main` is c38f69a.", "t8"),
            lifecycle("completed", "t9"),
            idle("t10"),
        ]);
        expect(summary).toEqual({
            lastAssistantText: "The last commit on `main` is c38f69a.",
            resultText: "The last commit on `main` is c38f69a.",
            finished: true,
            stopReason: "end_turn",
            prUrls: [],
            toolUses: 2,
            lastUserText: "Summarize the last commit on main.",
            lastTimestamp: "t10",
        });
    });

    it("a new user message resets the turn: an older answer is not reported as the current one", () => {
        const summary = summarizeHistory([
            user("first", "t0"),
            assistant([{ type: "text", text: "answer one" }], "t1"),
            result("answer one", "t2"),
            user("also bump the mobile timeout", "t3"),
            assistant([{ type: "tool_use", name: "Edit", input: {} }], "t4"),
        ]);
        expect(summary.finished).toBe(false);
        expect(summary.resultText).toBeNull();
        expect(summary.lastAssistantText).toBeNull();
        expect(summary.lastUserText).toBe("also bump the mobile timeout");
        expect(summary.toolUses).toBe(1);
    });

    it("finds PR links anywhere in the payloads and is provider-prefix agnostic", () => {
        const summary = summarizeHistory([
            { timestamp: "t0", type: "codex-user", payload: { message: { role: "user", content: "fix it" } } },
            { timestamp: "t1", type: "codex-assistant", payload: { message: { role: "assistant", content: [{ type: "text", text: "Opened https://github.com/rowboatlabs/rowboat/pull/1122" }] } } },
            { timestamp: "t2", type: "codex-result", payload: { result: "done", stop_reason: "end_turn" } },
        ]);
        expect(summary.prUrls).toEqual(["https://github.com/rowboatlabs/rowboat/pull/1122"]);
        expect(summary.finished).toBe(true);
        expect(summary.lastUserText).toBe("fix it");
    });
});
