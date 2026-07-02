import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import {
    TurnCorruptionError,
    TurnCreated,
    TurnEvent,
} from "@x/shared/dist/turns.js";
import { FSTurnRepo } from "./fs-repo.js";

const TURN_ID = "2026-07-02T10-00-00Z-0000001-000";

function created(turnId = TURN_ID): z.infer<typeof TurnCreated> {
    return {
        type: "turn_created",
        schemaVersion: 1,
        turnId,
        ts: "2026-07-02T10:00:00Z",
        sessionId: null,
        agent: {
            requested: { agentId: "copilot" },
            resolved: {
                agentId: "copilot",
                systemPrompt: "SYS",
                model: { provider: "fake", model: "m" },
                tools: [],
            },
        },
        context: [],
        input: { role: "user", content: "hello" },
        config: { autoPermission: false, humanAvailable: true, maxModelCalls: 20 },
    };
}

function requested(turnId = TURN_ID): z.infer<typeof TurnEvent> {
    return {
        type: "model_call_requested",
        turnId,
        ts: "2026-07-02T10:00:01Z",
        modelCallIndex: 0,
        request: {
            messages: ["input"],
            parameters: {},
        },
    };
}

function failed(turnId = TURN_ID): z.infer<typeof TurnEvent> {
    return {
        type: "model_call_failed",
        turnId,
        ts: "2026-07-02T10:00:02Z",
        modelCallIndex: 0,
        error: "boom",
    };
}

describe("FSTurnRepo", () => {
    let root: string;
    let repo: FSTurnRepo;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "turn-repo-"));
        repo = new FSTurnRepo({ turnsRootDir: root });
    });

    afterEach(async () => {
        await fs.rm(root, { recursive: true, force: true });
    });

    it("writes to a deterministic date-partitioned path", async () => {
        await repo.create(created());
        const file = path.join(root, "2026", "07", "02", `${TURN_ID}.jsonl`);
        const raw = await fs.readFile(file, "utf8");
        expect(raw.endsWith("\n")).toBe(true);
        expect(JSON.parse(raw.trim()).type).toBe("turn_created");
    });

    it("rejects malformed and path-like turn ids", async () => {
        for (const bad of [
            "../../../etc/passwd",
            "2026-07-02T10/evil",
            "2026-07-02T10-00-00Z-0000001-000.jsonl",
            "not-a-turn-id",
            "",
        ]) {
            await expect(repo.read(bad)).rejects.toThrowError(/invalid turn id/);
        }
    });

    it("create fails if the turn already exists", async () => {
        await repo.create(created());
        await expect(repo.create(created())).rejects.toThrowError();
    });

    it("appends preserve order and read validates every line", async () => {
        await repo.create(created());
        await repo.append(TURN_ID, [requested()]);
        await repo.append(TURN_ID, [failed()]);
        const events = await repo.read(TURN_ID);
        expect(events.map((e) => e.type)).toEqual([
            "turn_created",
            "model_call_requested",
            "model_call_failed",
        ]);
    });

    it("append validates events and turn id match before writing", async () => {
        await repo.create(created());
        await expect(
            repo.append(TURN_ID, [requested("2026-07-02T10-00-00Z-0000002-000")]),
        ).rejects.toThrowError(/does not match/);
        await expect(
            repo.append(TURN_ID, [{ type: "wat" } as unknown as z.infer<typeof TurnEvent>]),
        ).rejects.toThrowError();
        // Nothing was written by the failed appends.
        expect((await repo.read(TURN_ID)).length).toBe(1);
    });

    it("append never creates a missing turn file", async () => {
        await expect(repo.append(TURN_ID, [requested()])).rejects.toThrowError(
            /turn not found/,
        );
    });

    it("reading a missing turn reports not found", async () => {
        await expect(repo.read(TURN_ID)).rejects.toThrowError(/turn not found/);
    });

    async function writeRaw(content: string): Promise<void> {
        const file = path.join(root, "2026", "07", "02", `${TURN_ID}.jsonl`);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, content);
    }

    it("rejects an empty file as corrupt", async () => {
        await writeRaw("");
        await expect(repo.read(TURN_ID)).rejects.toThrowError(TurnCorruptionError);
    });

    it("rejects malformed first, middle, and final lines", async () => {
        const good = JSON.stringify(created());
        const req = JSON.stringify(requested());
        for (const content of [
            `not json\n${req}\n`,
            `${good}\nnot json\n${req}\n`,
            `${good}\n{"type":"wat"}\n`,
        ]) {
            await writeRaw(content);
            await expect(repo.read(TURN_ID)).rejects.toThrowError(
                TurnCorruptionError,
            );
        }
    });

    it("rejects a torn final line (no trailing newline)", async () => {
        const good = JSON.stringify(created());
        const torn = JSON.stringify(requested()).slice(0, 20);
        await writeRaw(`${good}\n${torn}`);
        await expect(repo.read(TURN_ID)).rejects.toThrowError(
            /does not end with a complete line/,
        );
    });

    it("rejects unsupported schema versions on read", async () => {
        const v2 = { ...created(), schemaVersion: 2 };
        await writeRaw(`${JSON.stringify(v2)}\n`);
        await expect(repo.read(TURN_ID)).rejects.toThrowError(TurnCorruptionError);
    });

    it("rejects events whose turnId does not match the file", async () => {
        const other = created("2026-07-02T10-00-00Z-0000002-000");
        await writeRaw(`${JSON.stringify(other)}\n`);
        await expect(repo.read(TURN_ID)).rejects.toThrowError(/does not match file/);
    });

    it("withLock serializes work per turn", async () => {
        const order: string[] = [];
        await Promise.all([
            repo.withLock(TURN_ID, async () => {
                order.push("a-start");
                await new Promise((r) => setTimeout(r, 20));
                order.push("a-end");
            }),
            repo.withLock(TURN_ID, async () => {
                order.push("b-start");
                order.push("b-end");
            }),
        ]);
        expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
    });

    it("withLock releases after failures", async () => {
        await expect(
            repo.withLock(TURN_ID, async () => {
                throw new Error("first fails");
            }),
        ).rejects.toThrowError("first fails");
        await expect(repo.withLock(TURN_ID, async () => "ok")).resolves.toBe("ok");
    });
});
