import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DEFAULT_RETENTION_SETTINGS } from "@x/shared/dist/retention.js";
import { SessionsImpl } from "./sessions.js";
import { FSSessionRepo } from "./fs-repo.js";
import { FSTurnRepo } from "../turns/fs-repo.js";
import { runRetentionSweep } from "./retention.js";

// Fixed clock: "today" for the sweep. Ids/timestamps below are relative to it.
const NOW = Date.parse("2026-08-07T12:00:00.000Z");

const MODEL = { provider: "openai", model: "gpt-fixture" };
const AGENT = { agentId: "copilot", systemPrompt: "SYS", model: MODEL, tools: [] };

const user = (text: string) => ({ role: "user", content: [{ type: "text", text }] });

const turnCreated = (turnId: string, sessionId: string | null, ts: string) => ({
    type: "turn_created",
    schemaVersion: 1,
    turnId,
    ts,
    sessionId,
    agent: { requested: { agentId: "copilot" }, resolved: AGENT },
    context: [],
    input: user("hi"),
    config: { autoPermission: false, humanAvailable: true, maxModelCalls: 20 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

describe("runRetentionSweep", () => {
    let root: string;
    let sessionRepo: FSSessionRepo;
    let turnRepo: FSTurnRepo;
    let sessions: SessionsImpl;

    const turnFile = (turnId: string) => {
        const [y, m, d] = turnId.split("-");
        return path.join(root, "turns", y, m, d.slice(0, 2), `${turnId}.jsonl`);
    };
    const exists = (p: string) => fs.access(p).then(() => true, () => false);

    const seedSession = async (sessionId: string, turnId: string, ts: string) => {
        await turnRepo.create(turnCreated(turnId, sessionId, ts));
        await sessionRepo.create({
            type: "session_created",
            schemaVersion: 1,
            sessionId,
            ts,
            title: "t",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        await sessionRepo.append(sessionId, [{
            type: "turn_appended",
            sessionId,
            ts,
            turnId,
            sessionSeq: 1,
            agentId: "copilot",
            model: MODEL,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any]);
    };

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "retention-test-"));
        sessionRepo = new FSSessionRepo({ sessionsRootDir: path.join(root, "sessions") });
        turnRepo = new FSTurnRepo({ turnsRootDir: path.join(root, "turns") });
        sessions = new SessionsImpl({
            sessionRepo,
            // Deletion-path adapter: getTurn/deleteTurn over the FS repo, the
            // same operations the real TurnRuntime delegates to it.
            turnRuntime: {
                getTurn: async (turnId: string) => ({ turnId, events: await turnRepo.read(turnId) }),
                deleteTurn: (turnId: string) => turnRepo.withLock(turnId, () => turnRepo.delete(turnId)),
                createTurn: async () => { throw new Error("unused"); },
                advanceTurn: () => { throw new Error("unused"); },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            idGenerator: { next: async () => { throw new Error("unused"); } } as any,
            clock: { now: () => new Date(NOW).toISOString() },
            sessionBus: { publish: () => {} },
        });
    });

    afterEach(async () => {
        await fs.rm(root, { recursive: true, force: true });
    });

    it("deletes stale chats and old unreferenced turns; keeps active chats and recent task turns", async () => {
        // Chat inactive for ~60 days → deleted (session + turn file).
        await seedSession(
            "2026-06-08T10-00-00Z-0000001-000",
            "2026-06-08T10-00-00Z-0000002-000",
            "2026-06-08T10:00:00.000Z",
        );
        // Chat with an OLD turn but recent activity → kept entirely: the old
        // turn is referenced, so the task-turn policy must not take it.
        await seedSession(
            "2026-06-08T10-00-00Z-0000003-000",
            "2026-06-08T10-00-00Z-0000004-000",
            "2026-06-08T10:00:00.000Z",
        );
        await sessionRepo.append("2026-06-08T10-00-00Z-0000003-000", [{
            type: "title_changed",
            sessionId: "2026-06-08T10-00-00Z-0000003-000",
            ts: "2026-08-05T10:00:00.000Z",
            title: "still in use",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any]);
        // Headless task turn older than 14 days → deleted.
        await turnRepo.create(turnCreated("2026-07-10T10-00-00Z-0000005-000", null, "2026-07-10T10:00:00.000Z"));
        // Headless task turn 5 days old → kept.
        await turnRepo.create(turnCreated("2026-08-02T10-00-00Z-0000006-000", null, "2026-08-02T10:00:00.000Z"));

        await sessions.initialize();
        const result = await runRetentionSweep({
            sessions,
            turnsRootDir: path.join(root, "turns"),
            settings: { ...DEFAULT_RETENTION_SETTINGS, noticeShown: true },
            now: NOW,
        });

        expect(result).toEqual({ deletedSessions: 1, deletedTurnFiles: 1 });
        // Stale chat gone, session file and turn file both.
        expect(await exists(turnFile("2026-06-08T10-00-00Z-0000002-000"))).toBe(false);
        expect(sessions.listSessions().map((s) => s.sessionId)).toEqual([
            "2026-06-08T10-00-00Z-0000003-000",
        ]);
        // Active chat's old turn survives; old headless turn gone; recent kept.
        expect(await exists(turnFile("2026-06-08T10-00-00Z-0000004-000"))).toBe(true);
        expect(await exists(turnFile("2026-07-10T10-00-00Z-0000005-000"))).toBe(false);
        expect(await exists(turnFile("2026-08-02T10-00-00Z-0000006-000"))).toBe(true);
    });

    it("chatDays null keeps all chats but still cleans old task turns", async () => {
        await seedSession(
            "2026-06-08T10-00-00Z-0000001-000",
            "2026-06-08T10-00-00Z-0000002-000",
            "2026-06-08T10:00:00.000Z",
        );
        await turnRepo.create(turnCreated("2026-07-10T10-00-00Z-0000005-000", null, "2026-07-10T10:00:00.000Z"));

        await sessions.initialize();
        const result = await runRetentionSweep({
            sessions,
            turnsRootDir: path.join(root, "turns"),
            settings: { ...DEFAULT_RETENTION_SETTINGS, chatDays: null, noticeShown: true },
            now: NOW,
        });

        expect(result).toEqual({ deletedSessions: 0, deletedTurnFiles: 1 });
        expect(sessions.listSessions()).toHaveLength(1);
        expect(await exists(turnFile("2026-06-08T10-00-00Z-0000002-000"))).toBe(true);
        expect(await exists(turnFile("2026-07-10T10-00-00Z-0000005-000"))).toBe(false);
    });

    it("does nothing when disabled", async () => {
        await seedSession(
            "2026-06-08T10-00-00Z-0000001-000",
            "2026-06-08T10-00-00Z-0000002-000",
            "2026-06-08T10:00:00.000Z",
        );
        await sessions.initialize();
        const result = await runRetentionSweep({
            sessions,
            turnsRootDir: path.join(root, "turns"),
            settings: { ...DEFAULT_RETENTION_SETTINGS, enabled: false, noticeShown: true },
            now: NOW,
        });
        expect(result).toEqual({ deletedSessions: 0, deletedTurnFiles: 0 });
        expect(sessions.listSessions()).toHaveLength(1);
        expect(await exists(turnFile("2026-06-08T10-00-00Z-0000002-000"))).toBe(true);
    });
});
