// Pure reader for GET /v1/replica/{id}/history (2026-09-28, shapes captured
// from a live workspace). Events are the harness's own transcript with a
// provider prefix on the type: `claude-user`, `claude-assistant`,
// `claude-result`, `claude-command_lifecycle`, `claude-system`, `context-usage`
// (a Codex workspace would say `codex-…`). The live SSE stream carries only
// deltas, so the final answer, the stop reason, and "did it finish" all come
// from here.

import { findPullRequestUrls } from "./handles.js";

export interface HistoryEvent {
    timestamp: string;
    type: string;
    payload: unknown;
}

export interface HistorySummary {
    /** The last assistant text after the last user message (the answer, or the plan). */
    lastAssistantText: string | null;
    /** The harness's own final result text, when it emitted one. */
    resultText: string | null;
    /** A result / lifecycle-completed / idle marker arrived after the last user message. */
    finished: boolean;
    stopReason: string | null;
    prUrls: string[];
    toolUses: number;
    lastUserText: string | null;
    lastTimestamp: string | null;
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

function textBlocks(content: unknown): { text: string; toolUses: number; hasToolResult: boolean } {
    if (typeof content === "string") return { text: content, toolUses: 0, hasToolResult: false };
    if (!Array.isArray(content)) return { text: "", toolUses: 0, hasToolResult: false };
    const texts: string[] = [];
    let toolUses = 0;
    let hasToolResult = false;
    for (const block of content) {
        if (!isRecord(block)) continue;
        if (block.type === "text" && typeof block.text === "string") texts.push(block.text);
        else if (block.type === "tool_use") toolUses += 1;
        else if (block.type === "tool_result") hasToolResult = true;
    }
    return { text: texts.join("\n").trim(), toolUses, hasToolResult };
}

export function summarizeHistory(events: HistoryEvent[]): HistorySummary {
    const summary: HistorySummary = {
        lastAssistantText: null,
        resultText: null,
        finished: false,
        stopReason: null,
        prUrls: [],
        toolUses: 0,
        lastUserText: null,
        lastTimestamp: null,
    };
    for (const event of events) {
        summary.lastTimestamp = event.timestamp ?? summary.lastTimestamp;
        for (const url of findPullRequestUrls(JSON.stringify(event.payload ?? ""))) {
            if (!summary.prUrls.includes(url)) summary.prUrls.push(url);
        }
        const payload = isRecord(event.payload) ? event.payload : {};
        const message = isRecord(payload.message) ? payload.message : null;
        const kind = event.type.replace(/^[a-z0-9]+-/i, ""); // strip the provider prefix

        if (kind === "user") {
            const blocks = textBlocks(message?.content);
            // A tool_result rides a user-role event too; only a typed message resets the turn.
            if (blocks.hasToolResult && !blocks.text) continue;
            summary.lastUserText = blocks.text || summary.lastUserText;
            summary.lastAssistantText = null;
            summary.resultText = null;
            summary.finished = false;
            summary.stopReason = null;
            summary.toolUses = 0;
        } else if (kind === "assistant") {
            const blocks = textBlocks(message?.content);
            summary.toolUses += blocks.toolUses;
            if (blocks.text) summary.lastAssistantText = blocks.text;
        } else if (kind === "result") {
            if (typeof payload.result === "string" && payload.result.trim()) summary.resultText = payload.result;
            if (typeof payload.stop_reason === "string") summary.stopReason = payload.stop_reason;
            summary.finished = true;
        } else if (kind === "command_lifecycle") {
            if (payload.state === "completed") summary.finished = true;
        } else if (kind === "system") {
            if (payload.subtype === "session_state_changed" && payload.state === "idle" && summary.lastUserText) summary.finished = true;
        }
    }
    return summary;
}
