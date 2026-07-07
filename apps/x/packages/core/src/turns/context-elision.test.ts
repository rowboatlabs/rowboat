import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import type { TurnContext, TurnEvent } from "@x/shared/dist/turns.js";
import {
    DEFAULT_ELISION_POLICY,
    ElidingContextResolver,
    createContextResolver,
    elideHistoricImages,
    elideHistoricMiddlePaneContent,
    elideHistoricToolResults,
    loadElisionPolicy,
} from "./context-elision.js";
import { TurnRepoContextResolver } from "./context-resolver.js";
import { InMemoryTurnRepo } from "./in-memory-turn-repo.js";

type TEvent = z.infer<typeof TurnEvent>;

function user(text: string) {
    return { role: "user" as const, content: text };
}

function assistant(text: string) {
    return { role: "assistant" as const, content: text };
}

function toolMsg(content: string, toolName = "file-readText") {
    return {
        role: "tool" as const,
        content,
        toolCallId: "tc1",
        toolName,
    };
}

// A completed turn containing one tool round trip whose result has the given
// output, followed by a final text response.
function toolTurnLog(
    turnId: string,
    context: z.infer<typeof TurnContext>,
    toolOutput: string,
): TEvent[] {
    const ts = "2026-07-02T10:00:00Z";
    const echo = {
        toolId: "tool.echo",
        name: "echo",
        description: "Echo",
        inputSchema: {},
        execution: "sync" as const,
        requiresHuman: false,
    };
    const call = {
        role: "assistant" as const,
        content: [
            {
                type: "tool-call" as const,
                toolCallId: "tc1",
                toolName: "echo",
                arguments: {},
            },
        ],
    };
    return [
        {
            type: "turn_created",
            schemaVersion: 1,
            turnId,
            ts,
            sessionId: "sess-1",
            agent: {
                requested: { agentId: "copilot" },
                resolved: {
                    agentId: "copilot",
                    systemPrompt: "SYS",
                    model: { provider: "fake", model: "m" },
                    tools: [echo],
                },
            },
            context,
            input: user("do it"),
            config: {
                autoPermission: false,
                humanAvailable: true,
                maxModelCalls: 20,
            },
        },
        {
            type: "model_call_requested",
            turnId,
            ts,
            modelCallIndex: 0,
            request: {
                ...(Array.isArray(context) ? {} : { contextRef: context }),
                messages:
                    Array.isArray(context) && context.length > 0
                        ? ["context", "input"]
                        : ["input"],
                parameters: {},
            },
        },
        {
            type: "model_call_completed",
            turnId,
            ts,
            modelCallIndex: 0,
            message: call,
            finishReason: "tool-calls",
            usage: {},
        },
        {
            type: "tool_invocation_requested",
            turnId,
            ts,
            toolCallId: "tc1",
            toolId: "tool.echo",
            toolName: "echo",
            execution: "sync",
            input: {},
        },
        {
            type: "tool_result",
            turnId,
            ts,
            toolCallId: "tc1",
            toolName: "echo",
            source: "sync",
            result: { output: toolOutput, isError: false },
        },
        {
            type: "model_call_requested",
            turnId,
            ts,
            modelCallIndex: 1,
            request: {
                messages: ["assistant:0", "toolResult:tc1"],
                parameters: {},
            },
        },
        {
            type: "model_call_completed",
            turnId,
            ts,
            modelCallIndex: 1,
            message: assistant("done"),
            finishReason: "stop",
            usage: {},
        },
        {
            type: "turn_completed",
            turnId,
            ts,
            output: assistant("done"),
            finishReason: "stop",
            usage: {},
        },
    ];
}

function frame(source: "camera" | "screen") {
    return {
        type: "image" as const,
        data: "aGVsbG8=".repeat(50),
        mediaType: "image/jpeg",
        source,
        capturedAt: "2026-07-02T10:00:00Z",
    };
}

const T1 = "2026-07-02T10-00-00Z-0000001-000";

describe("elideHistoricToolResults", () => {
    it("replaces tool results above the threshold with a placeholder", () => {
        const big = "x".repeat(101);
        const elided = elideHistoricToolResults([toolMsg(big)], 100);
        expect(elided).toHaveLength(1);
        expect(elided[0]).toMatchObject({
            role: "tool",
            toolCallId: "tc1",
            toolName: "file-readText",
        });
        expect(elided[0].content).toContain("elided");
        expect(elided[0].content).toContain("file-readText");
        expect(elided[0].content).toContain("101");
    });

    it("keeps a head preview ahead of the placeholder", () => {
        const content = `SKILL GUIDE${"y".repeat(5000)}`;
        const [elided] = elideHistoricToolResults([toolMsg(content)], 2500);
        // Starts with the first 400 chars verbatim, then the marker.
        expect(elided.content.startsWith(content.slice(0, 400))).toBe(true);
        expect(elided.content).toContain("Rest of tool result elided");
        expect(elided.content.length).toBeLessThan(700);
        // Preview never exceeds a tiny threshold.
        const [tiny] = elideHistoricToolResults([toolMsg(content)], 50);
        expect(tiny.content.startsWith(`${content.slice(0, 50)}\n[Rest`)).toBe(true);
    });

    it("keeps tool results at or below the threshold verbatim", () => {
        const exact = toolMsg("x".repeat(100));
        expect(elideHistoricToolResults([exact], 100)).toEqual([exact]);
    });

    it("leaves non-tool messages untouched", () => {
        const messages = [user("q".repeat(500)), assistant("a".repeat(500))];
        expect(elideHistoricToolResults(messages, 100)).toEqual(messages);
    });

    it("is idempotent at realistic thresholds (placeholder is well under them)", () => {
        const once = elideHistoricToolResults([toolMsg("x".repeat(5000))], 1000);
        expect(once[0].content.length).toBeLessThan(1000);
        expect(elideHistoricToolResults(once, 1000)).toEqual(once);
    });

    it("is deterministic for the same input", () => {
        const messages = [toolMsg("x".repeat(5000)), user("q"), assistant("a")];
        expect(elideHistoricToolResults(messages, 100)).toEqual(
            elideHistoricToolResults(messages, 100),
        );
    });
});

describe("elideHistoricImages", () => {
    it("replaces image parts with a labeled placeholder, keeping other parts", () => {
        const message = {
            role: "user" as const,
            content: [
                { type: "text" as const, text: "how do I look?" },
                frame("camera"),
                frame("camera"),
                frame("screen"),
            ],
        };
        const [elided] = elideHistoricImages([message]);
        if (typeof elided.content === "string" || elided.role !== "user") {
            throw new Error("expected user message with parts");
        }
        expect(elided.content.filter((p) => p.type === "image")).toHaveLength(0);
        expect(elided.content[0]).toEqual({ type: "text", text: "how do I look?" });
        const placeholder = elided.content[elided.content.length - 1];
        if (placeholder.type !== "text") throw new Error("expected text placeholder");
        expect(placeholder.text).toContain("2 webcam frames");
        expect(placeholder.text).toContain("1 screen-share frame");
    });

    it("leaves string-content and image-free user messages untouched", () => {
        const messages = [
            user("plain"),
            {
                role: "user" as const,
                content: [{ type: "text" as const, text: "no images" }],
            },
            assistant("a"),
        ];
        expect(elideHistoricImages(messages)).toEqual(messages);
    });
});

function noteMessage(content: string) {
    return {
        role: "user" as const,
        content: "make this punchier",
        userMessageContext: {
            currentDateTime: "Thursday, July 2, 2026 at 10:00 AM GMT",
            middlePane: {
                kind: "note" as const,
                path: "knowledge/Notes/Draft.md",
                content,
            },
        },
    };
}

describe("elideHistoricMiddlePaneContent", () => {
    it("replaces large note snapshots, keeping kind and path", () => {
        const [elided] = elideHistoricMiddlePaneContent([
            noteMessage("n".repeat(600)),
        ]);
        if (elided.role !== "user") throw new Error("expected user message");
        const middlePane = elided.userMessageContext?.middlePane;
        if (middlePane?.kind !== "note") throw new Error("expected note pane");
        expect(middlePane.path).toBe("knowledge/Notes/Draft.md");
        expect(middlePane.content).toContain("omitted from history");
        expect(middlePane.content).toContain("600");
        expect(elided.userMessageContext?.currentDateTime).toBeDefined();
        expect(elided.content).toBe("make this punchier");
    });

    it("keeps small notes and non-note panes untouched", () => {
        const small = noteMessage("short todo list");
        const browser = {
            role: "user" as const,
            content: "what is this page?",
            userMessageContext: {
                middlePane: {
                    kind: "browser" as const,
                    url: "https://example.com",
                    title: "Example",
                },
            },
        };
        const plain = user("no context at all");
        const messages = [small, browser, plain];
        expect(elideHistoricMiddlePaneContent(messages)).toEqual(messages);
    });
});

const POLICY_OFF = {
    toolResults: false,
    toolResultThresholdChars: 100,
    images: false,
    middlePaneContent: false,
};

describe("createContextResolver", () => {
    // The factory is the app's one sanctioned constructor (DI container and
    // inspect CLI). If this stops returning the eliding decorator, every
    // construction site silently regresses to full historic replay.
    it("wraps the repo resolver in the eliding decorator", () => {
        const resolver = createContextResolver({
            turnRepo: new InMemoryTurnRepo(),
        });
        expect(resolver).toBeInstanceOf(ElidingContextResolver);
    });

    it("applies the default policy through the decorated resolver", async () => {
        const repo = new InMemoryTurnRepo();
        repo.seed(toolTurnLog(T1, [], "x".repeat(5000)));
        // Pinned to the shipped defaults (not the machine's context.json) so
        // the test is hermetic while still exercising the full wiring.
        const resolved = await createContextResolver({
            turnRepo: repo,
            loadPolicy: () => DEFAULT_ELISION_POLICY,
        }).resolve({ previousTurnId: T1 });
        const tool = resolved.find((m) => m.role === "tool");
        expect(tool?.content).toContain("elided");
        expect(tool?.content.length).toBeLessThan(1000);
    });
});

describe("ElidingContextResolver", () => {
    function resolver(
        repo: InMemoryTurnRepo,
        policy: {
            toolResults: boolean;
            toolResultThresholdChars: number;
            images: boolean;
        },
    ) {
        return new ElidingContextResolver({
            inner: new TurnRepoContextResolver({ turnRepo: repo }),
            loadPolicy: () => policy,
        });
    }

    it("elides oversized tool results in the resolved prefix", async () => {
        const repo = new InMemoryTurnRepo();
        repo.seed(toolTurnLog(T1, [], "x".repeat(200)));
        const resolved = await resolver(repo, {
            ...POLICY_OFF,
            toolResults: true,
        }).resolve({ previousTurnId: T1 });
        const tool = resolved.find((m) => m.role === "tool");
        expect(tool?.content).toContain("elided");
        // The rest of the transcript is intact.
        expect(resolved.map((m) => m.role)).toEqual([
            "user",
            "assistant",
            "tool",
            "assistant",
        ]);
    });

    it("returns the prefix unchanged when the policy is disabled", async () => {
        const repo = new InMemoryTurnRepo();
        const output = "x".repeat(200);
        repo.seed(toolTurnLog(T1, [], output));
        const resolved = await resolver(repo, POLICY_OFF).resolve({
            previousTurnId: T1,
        });
        const tool = resolved.find((m) => m.role === "tool");
        expect(tool?.content).toBe(output);
    });

    it("keeps small tool results verbatim when enabled", async () => {
        const repo = new InMemoryTurnRepo();
        repo.seed(toolTurnLog(T1, [], "small"));
        const resolved = await resolver(repo, {
            ...POLICY_OFF,
            toolResults: true,
        }).resolve({ previousTurnId: T1 });
        const tool = resolved.find((m) => m.role === "tool");
        expect(tool?.content).toBe("small");
    });

    it("elides images in the resolved prefix when enabled", async () => {
        const repo = new InMemoryTurnRepo();
        const log = toolTurnLog(T1, [], "small").map((event) =>
            event.type === "turn_created"
                ? {
                      ...event,
                      input: {
                          role: "user" as const,
                          content: [
                              { type: "text" as const, text: "watch me" },
                              frame("camera"),
                          ],
                      },
                  }
                : event,
        );
        repo.seed(log);
        const resolved = await resolver(repo, {
            ...POLICY_OFF,
            images: true,
        }).resolve({ previousTurnId: T1 });
        const input = resolved[0];
        if (input.role !== "user" || typeof input.content === "string") {
            throw new Error("expected user message with parts");
        }
        expect(input.content.some((p) => p.type === "image")).toBe(false);
        expect(JSON.stringify(input.content)).toContain("1 webcam frame");
    });

    it("elides middle-pane note snapshots in the resolved prefix when enabled", async () => {
        const repo = new InMemoryTurnRepo();
        const log = toolTurnLog(T1, [], "small").map((event) =>
            event.type === "turn_created"
                ? { ...event, input: noteMessage("n".repeat(600)) }
                : event,
        );
        repo.seed(log);
        const resolved = await resolver(repo, {
            ...POLICY_OFF,
            middlePaneContent: true,
        }).resolve({ previousTurnId: T1 });
        const input = resolved[0];
        if (input.role !== "user") throw new Error("expected user message");
        const middlePane = input.userMessageContext?.middlePane;
        if (middlePane?.kind !== "note") throw new Error("expected note pane");
        expect(middlePane.content).toContain("omitted from history");
    });

    it("delegates resolveAgent to the inner resolver untouched", async () => {
        const repo = new InMemoryTurnRepo();
        const snapshot = {
            agentId: "copilot",
            systemPrompt: "SYS",
            model: { provider: "fake", model: "m" },
            tools: [],
        };
        const agent = await resolver(repo, POLICY_OFF).resolveAgent(snapshot);
        expect(agent).toEqual(snapshot);
    });

    it("elides across every turn of a multi-turn reference chain", async () => {
        const repo = new InMemoryTurnRepo();
        const T2 = "2026-07-02T11-00-00Z-0000002-000";
        repo.seed(toolTurnLog(T1, [], "a".repeat(200)));
        repo.seed(toolTurnLog(T2, { previousTurnId: T1 }, "b".repeat(200)));
        const resolved = await resolver(repo, {
            ...POLICY_OFF,
            toolResults: true,
        }).resolve({ previousTurnId: T2 });
        const tools = resolved.filter((m) => m.role === "tool");
        expect(tools).toHaveLength(2);
        for (const tool of tools) {
            expect(tool.content).toContain("elided");
        }
    });

    it("reloads the policy on every resolve (hot config)", async () => {
        const repo = new InMemoryTurnRepo();
        const output = "x".repeat(200);
        repo.seed(toolTurnLog(T1, [], output));
        let loads = 0;
        const eliding = new ElidingContextResolver({
            inner: new TurnRepoContextResolver({ turnRepo: repo }),
            loadPolicy: () => {
                loads += 1;
                return { ...POLICY_OFF, toolResults: loads > 1 };
            },
        });
        const first = await eliding.resolve({ previousTurnId: T1 });
        const second = await eliding.resolve({ previousTurnId: T1 });
        expect(loads).toBe(2);
        expect(first.find((m) => m.role === "tool")?.content).toBe(output);
        expect(second.find((m) => m.role === "tool")?.content).toContain("elided");
    });
});

describe("elision policy idempotency and determinism", () => {
    // Placeholders must never themselves be elided on a second pass, and the
    // transforms must be pure — both are what keeps replayed prefixes
    // byte-stable for provider prefix caching.
    it("elideHistoricImages is idempotent and deterministic", () => {
        const messages = [
            {
                role: "user" as const,
                content: [
                    { type: "text" as const, text: "watch" },
                    frame("camera"),
                    frame("screen"),
                ],
            },
        ];
        const once = elideHistoricImages(messages);
        expect(elideHistoricImages(once)).toEqual(once);
        expect(elideHistoricImages(messages)).toEqual(once);
    });

    it("elideHistoricMiddlePaneContent is idempotent and deterministic", () => {
        const messages = [noteMessage("n".repeat(600))];
        const once = elideHistoricMiddlePaneContent(messages);
        expect(elideHistoricMiddlePaneContent(once)).toEqual(once);
        expect(elideHistoricMiddlePaneContent(messages)).toEqual(once);
    });

    it("keeps notes at the floor verbatim and elides just above it", () => {
        const atFloor = noteMessage("n".repeat(500));
        expect(elideHistoricMiddlePaneContent([atFloor])).toEqual([atFloor]);
        const [above] = elideHistoricMiddlePaneContent([
            noteMessage("n".repeat(501)),
        ]);
        if (above.role !== "user") throw new Error("expected user message");
        expect(above.userMessageContext?.middlePane?.kind === "note"
            ? above.userMessageContext.middlePane.content
            : "").toContain("omitted from history");
    });
});

describe("loadElisionPolicy", () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "elision-config-"));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    function write(content: string): string {
        const p = path.join(dir, "context.json");
        fs.writeFileSync(p, content);
        return p;
    }

    it("returns defaults when the file is missing", () => {
        expect(loadElisionPolicy(path.join(dir, "nope.json"))).toEqual(
            DEFAULT_ELISION_POLICY,
        );
    });

    it("applies a full config", () => {
        const p = write(
            JSON.stringify({
                elideHistoricToolResults: false,
                elideHistoricToolResultsThresholdChars: 42,
                elideHistoricImages: false,
                elideHistoricMiddlePaneContent: false,
            }),
        );
        expect(loadElisionPolicy(p)).toEqual({
            toolResults: false,
            toolResultThresholdChars: 42,
            images: false,
            middlePaneContent: false,
        });
    });

    it("merges a partial config with defaults", () => {
        const p = write(JSON.stringify({ elideHistoricToolResultsThresholdChars: 42 }));
        expect(loadElisionPolicy(p)).toEqual({
            ...DEFAULT_ELISION_POLICY,
            toolResultThresholdChars: 42,
        });
    });

    it("falls back to defaults on unparseable JSON", () => {
        expect(loadElisionPolicy(write("{nope"))).toEqual(DEFAULT_ELISION_POLICY);
    });

    it("discards the whole file when any key is malformed (all-or-nothing)", () => {
        const p = write(
            JSON.stringify({
                elideHistoricToolResults: false,
                elideHistoricToolResultsThresholdChars: "not-a-number",
            }),
        );
        expect(loadElisionPolicy(p)).toEqual(DEFAULT_ELISION_POLICY);
    });
});
