import { describe, expect, it } from "vitest";
import type { ResolvedAgent } from "@x/shared/dist/turns.js";
import type { z } from "zod";
import { DispatchingAgentResolver } from "./agent-resolver-dispatch.js";
import type { InlineAgentResolver } from "./inline-agent-resolver.js";
import type { RealAgentResolver } from "./real-agent-resolver.js";

function stub(agentId: string) {
    return {
        resolve: async () =>
            ({
                agentId,
                systemPrompt: "s",
                model: { provider: "p", model: "m" },
                tools: [],
            }) satisfies z.infer<typeof ResolvedAgent>,
    };
}

describe("DispatchingAgentResolver", () => {
    it("routes by-id requests to the by-id resolver and inline to the inline resolver", async () => {
        const resolver = new DispatchingAgentResolver(
            stub("from-by-id") as unknown as RealAgentResolver,
            stub("from-inline") as unknown as InlineAgentResolver,
        );
        expect((await resolver.resolve({ agentId: "copilot" })).agentId).toBe(
            "from-by-id",
        );
        expect(
            (
                await resolver.resolve({
                    inline: { name: "x", instructions: "y" },
                })
            ).agentId,
        ).toBe("from-inline");
    });
});
