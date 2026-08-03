import { afterEach, describe, expect, it, vi } from "vitest";
import { withUseCase } from "../analytics/use_case.js";

vi.mock("../auth/tokens.js", () => ({
    getAccessToken: async () => "access-token",
}));

import { authedFetch } from "./gateway.js";

describe("Rowboat gateway request attribution", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("sends the complete turn-scoped analytics context", async () => {
        const fetchMock = vi.fn(
            async (
                input: Parameters<typeof fetch>[0],
                init?: Parameters<typeof fetch>[1],
            ) => {
                void input;
                void init;
                return new Response(null, { status: 200 });
            },
        );
        vi.stubGlobal("fetch", fetchMock);

        await withUseCase(
            {
                useCase: "background_task_agent",
                subUseCase: "cron",
                agentName: "background-task-agent",
            },
            () => authedFetch("https://api.example.test/v1/llm/chat/completions"),
        );

        const [, init] = fetchMock.mock.calls[0];
        const headers = new Headers(init?.headers);
        expect(Object.fromEntries(headers.entries())).toMatchObject({
            authorization: "Bearer access-token",
            "x-rowboat-use-case": "background_task_agent",
            "x-rowboat-sub-use-case": "cron",
            "x-rowboat-agent-name": "background-task-agent",
        });
    });
});
