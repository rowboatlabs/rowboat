import test from "node:test";
import assert from "node:assert/strict";

import { shouldUseGatewayForModelTest } from "./models.js";

test("signed-in ollama model tests bypass the gateway", () => {
    assert.equal(shouldUseGatewayForModelTest("ollama", true), false);
});

test("signed-in openai-compatible model tests bypass the gateway", () => {
    assert.equal(shouldUseGatewayForModelTest("openai-compatible", true), false);
});

test("signed-in hosted model tests still use the gateway", () => {
    assert.equal(shouldUseGatewayForModelTest("openai", true), true);
});

test("signed-out hosted model tests do not use the gateway", () => {
    assert.equal(shouldUseGatewayForModelTest("openai", false), false);
});
