import test from "node:test";
import assert from "node:assert/strict";

import { handlePostChat } from "../app/api/v1/[projectId]/chat/route";

test("returns 400 for invalid request bodies", async () => {
    const response = await handlePostChat(
        new Request("http://localhost/api/v1/proj/chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ invalid: true }),
        }),
        { params: Promise.resolve({ projectId: "proj" }) },
        {
            createLogger: () => ({ log() {} }),
            resolveRunTurnController: () => ({
                execute: async () => {
                    throw new Error("should not be called");
                },
            } as any),
        },
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Invalid request" });
});

test("returns json for non-streaming responses", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const response = await handlePostChat(
        new Request("http://localhost/api/v1/proj/chat", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                Authorization: "Bearer test-key",
            },
            body: JSON.stringify({
                messages: [{ role: "user", content: "hello" }],
                stream: false,
            }),
        }),
        { params: Promise.resolve({ projectId: "proj-1" }) },
        {
            createLogger: () => ({ log() {} }),
            resolveRunTurnController: () => ({
                execute: async (input: any) => {
                    calls.push(input);
                    return {
                        conversationId: "conv-1",
                        turn: { output: [{ role: "assistant", content: "hi" }] },
                    };
                },
            } as any),
        },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        conversationId: "conv-1",
        turn: { output: [{ role: "assistant", content: "hi" }] },
    });
    assert.deepEqual(calls, [{
        caller: "api",
        apiKey: "test-key",
        projectId: "proj-1",
        input: {
            messages: [{ role: "user", content: "hello" }],
            mockTools: undefined,
        },
        conversationId: undefined,
        stream: false,
    }]);
});

test("returns SSE for streaming responses", async () => {
    async function* makeStream() {
        yield { type: "text-delta", delta: "hello" };
        yield { type: "done" };
    }

    const response = await handlePostChat(
        new Request("http://localhost/api/v1/proj/chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                messages: [{ role: "user", content: "stream please" }],
                stream: true,
            }),
        }),
        { params: Promise.resolve({ projectId: "proj-stream" }) },
        {
            createLogger: () => ({ log() {} }),
            resolveRunTurnController: () => ({
                execute: async () => ({
                    conversationId: "conv-stream",
                    stream: makeStream(),
                }),
            } as any),
        },
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "text/event-stream");
    const text = await response.text();
    assert.match(text, /event: message/);
    assert.match(text, /"delta":"hello"/);
});
