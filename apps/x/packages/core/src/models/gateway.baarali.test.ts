import { afterEach, describe, expect, it, vi } from "vitest";

// BAARALI(03/10/2026): the control plane's catalog carries each model's place
// in the picker (`baarali`); the instance hands it on to the apps.

vi.mock("../auth/tokens.js", () => ({
    getAccessToken: async () => "access-token",
}));
vi.mock("./models-dev.js", () => ({
    annotateReasoningFlags: async <T>(models: T[]) => models,
}));

import { listGatewayModels } from "./gateway.js";

describe("listGatewayModels, Baarali", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("keeps a well-formed picker entry and drops a malformed one", async () => {
        const meta = { vendor: "anthropic", vendorName: "Anthropic", vendorRank: 0, strength: "Puissant", recommended: false, unlock: "Pro max" };
        vi.stubGlobal("fetch", vi.fn(async () => Response.json({
            data: [
                { id: "anthropic/opus", name: "Claude Opus", baarali: meta },
                { id: "openai/gpt-6", baarali: { vendor: 42 } },
                { id: "deepseek/flash" },
            ],
        })));
        const { providers } = await listGatewayModels();
        expect(providers[0].models).toEqual([
            { id: "anthropic/opus", name: "Claude Opus", baarali: meta },
            { id: "openai/gpt-6" },
            { id: "deepseek/flash" },
        ]);
    });
});
