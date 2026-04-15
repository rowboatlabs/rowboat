import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../dist/server.js";

test("message endpoint creates a message and returns its id", async () => {
  const calls = [];
  const app = createApp({
    createMessage: async (runId, message) => {
      calls.push({ runId, message });
      return "msg-123";
    },
    authorizePermission: async () => {},
    replyToHumanInputRequest: async () => {},
    stop: async () => {},
    subscribeToEvents: async () => () => {},
  });

  const response = await app.request("/runs/run-1/messages/new", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "hello" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { messageId: "msg-123" });
  assert.deepEqual(calls, [{ runId: "run-1", message: "hello" }]);
});

test("permission endpoint validates payload and calls dependency", async () => {
  const calls = [];
  const app = createApp({
    createMessage: async () => "unused",
    authorizePermission: async (runId, payload) => {
      calls.push({ runId, payload });
    },
    replyToHumanInputRequest: async () => {},
    stop: async () => {},
    subscribeToEvents: async () => () => {},
  });

  const response = await app.request("/runs/run-2/permissions/authorize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subflow: ["child"],
      toolCallId: "tool-1",
      response: "approve",
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.deepEqual(calls, [{
    runId: "run-2",
    payload: {
      subflow: ["child"],
      toolCallId: "tool-1",
      response: "approve",
    },
  }]);
});

test("invalid message payload returns a validation error", async () => {
  const app = createApp({
    createMessage: async () => "unused",
    authorizePermission: async () => {},
    replyToHumanInputRequest: async () => {},
    stop: async () => {},
    subscribeToEvents: async () => () => {},
  });

  const response = await app.request("/runs/run-1/messages/new", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 400);
});

test("openapi endpoint is exposed", async () => {
  const app = createApp({
    createMessage: async () => "unused",
    authorizePermission: async () => {},
    replyToHumanInputRequest: async () => {},
    stop: async () => {},
    subscribeToEvents: async () => () => {},
  });

  const response = await app.request("/openapi.json");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.info.title, "Hono");
  assert.ok(body.paths["/runs/{runId}/messages/new"]);
});

test("stream endpoint emits SSE payloads and unsubscribes on cancel", async () => {
  let listener;
  let unsubscribed = false;
  const app = createApp({
    createMessage: async () => "unused",
    authorizePermission: async () => {},
    replyToHumanInputRequest: async () => {},
    stop: async () => {},
    subscribeToEvents: async (fn) => {
      listener = fn;
      return () => {
        unsubscribed = true;
      };
    },
  });

  const response = await app.request("/stream");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");

  await listener({ type: "message", data: { hello: "world" } });

  const reader = response.body.getReader();
  const chunk = await reader.read();
  const text = new TextDecoder().decode(chunk.value);

  assert.match(text, /event: message/);
  assert.match(text, /"hello":"world"/);

  await reader.cancel();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(unsubscribed, true);
});
