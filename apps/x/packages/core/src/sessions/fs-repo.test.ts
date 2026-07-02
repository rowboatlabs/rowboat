import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import {
    SessionCorruptionError,
    type SessionCreated,
    type SessionEvent,
} from "@x/shared/dist/sessions.js";
import { FSSessionRepo } from "./fs-repo.js";

const S1 = "2026-07-02T09-00-00Z-0000001-000";
const S2 = "2026-07-03T09-00-00Z-0000002-000";

function created(sessionId = S1): z.infer<typeof SessionCreated> {
    return {
        type: "session_created",
        schemaVersion: 1,
        sessionId,
        ts: "2026-07-02T09:00:00Z",
        title: "T",
    };
}

function appended(sessionId = S1): z.infer<typeof SessionEvent> {
    return {
        type: "turn_appended",
        sessionId,
        ts: "2026-07-02T09:01:00Z",
        turnId: "turn-1",
        sessionSeq: 1,
        agentId: "copilot",
        model: { provider: "fake", model: "m" },
    };
}

describe("FSSessionRepo", () => {
    let root: string;
    let repo: FSSessionRepo;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "session-repo-"));
        repo = new FSSessionRepo({ sessionsRootDir: root });
    });

    afterEach(async () => {
        await fs.rm(root, { recursive: true, force: true });
    });

    it("creates date-partitioned files and round-trips events", async () => {
        await repo.create(created());
        await repo.append(S1, [appended()]);
        const file = path.join(root, "2026", "07", "02", `${S1}.jsonl`);
        await fs.access(file);
        const events = await repo.read(S1);
        expect(events.map((e) => e.type)).toEqual([
            "session_created",
            "turn_appended",
        ]);
    });

    it("rejects malformed and path-like session ids", async () => {
        for (const bad of ["../evil", "a/b", "nope", ""]) {
            await expect(repo.read(bad)).rejects.toThrowError(/invalid session id/);
        }
    });

    it("create fails if the session exists; append fails if it doesn't", async () => {
        await repo.create(created());
        await expect(repo.create(created())).rejects.toThrowError();
        await expect(repo.append(S2, [appended(S2)])).rejects.toThrowError(
            /session not found/,
        );
    });

    it("read rejects corrupt files whole", async () => {
        const file = path.join(root, "2026", "07", "02", `${S1}.jsonl`);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, `${JSON.stringify(created())}\nnot json\n`);
        await expect(repo.read(S1)).rejects.toThrowError(SessionCorruptionError);
        await fs.writeFile(file, `${JSON.stringify(created())}\n{"torn`);
        await expect(repo.read(S1)).rejects.toThrowError(
            /does not end with a complete line/,
        );
    });

    it("lists session ids across date partitions", async () => {
        await repo.create(created(S1));
        await repo.create(created(S2));
        expect(await repo.listSessionIds()).toEqual([S1, S2]);
    });

    it("listing an empty root returns no ids", async () => {
        const empty = new FSSessionRepo({
            sessionsRootDir: path.join(root, "missing"),
        });
        expect(await empty.listSessionIds()).toEqual([]);
    });

    it("delete removes the file only; deleting a missing session throws", async () => {
        await repo.create(created(S1));
        await repo.create(created(S2));
        await repo.delete(S1);
        expect(await repo.listSessionIds()).toEqual([S2]);
        await expect(repo.delete(S1)).rejects.toThrowError(/session not found/);
    });
});
