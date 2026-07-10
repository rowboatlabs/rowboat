import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reduceTurn } from "@x/shared/dist/turns.js";
import { reduceSession } from "@x/shared/dist/sessions.js";
import { FSTurnRepo } from "../../runtime/turns/fs-repo.js";
import { FSSessionRepo } from "../../runtime/sessions/fs-repo.js";
import { migrateRuns } from "./migrate.js";

const fixturesDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "__fixtures__",
);

let tmp: string;
let runsDir: string;
let turnsRootDir: string;
let sessionsRootDir: string;
let archiveDir: string;
let logFile: string;

function deps() {
    return {
        runsDir,
        turnsRootDir,
        sessionsRootDir,
        archiveDir,
        logFile,
        now: () => "2026-07-02T00:00:00.000Z",
        logger: () => undefined,
    };
}

function copyFixture(name: string, targetName?: string): string {
    const dest = path.join(runsDir, targetName ?? name);
    fs.copyFileSync(path.join(fixturesDir, name), dest);
    return dest;
}

// Turn/session files nest under YYYY/MM/DD; find one by id anywhere in a tree.
function findFile(root: string, id: string): string | undefined {
    const want = `${id}.jsonl`;
    const walk = (dir: string): string | undefined => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return undefined;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const hit = walk(full);
                if (hit) return hit;
            } else if (entry.name === want) {
                return full;
            }
        }
        return undefined;
    };
    return walk(root);
}

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "runs-migration-"));
    runsDir = path.join(tmp, "runs");
    turnsRootDir = path.join(tmp, "storage", "turns");
    sessionsRootDir = path.join(tmp, "storage", "sessions");
    archiveDir = path.join(tmp, "runs-archive");
    logFile = path.join(tmp, "config", "runs-migration.json");
    fs.mkdirSync(runsDir, { recursive: true });
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("migrateRuns", () => {
    it("migrates a non-copilot run to a standalone turn keyed by the runId, and archives the source", () => {
        copyFixture("knowledge-single-turn.jsonl");
        const runId = "2026-07-02T15-26-22Z-0011690-000";

        const summary = migrateRuns(deps());

        expect(summary.scanned).toBe(1);
        expect(summary.migratedTurns).toBe(1);
        expect(summary.migratedSessions).toBe(0);
        expect(summary.failed).toHaveLength(0);
        // Turn file exists at the runId; no session written.
        expect(findFile(turnsRootDir, runId)).toBeDefined();
        expect(fs.existsSync(sessionsRootDir)).toBe(false);
        // Source archived out of the scan dir.
        expect(fs.existsSync(path.join(runsDir, "knowledge-single-turn.jsonl"))).toBe(
            false,
        );
        expect(
            fs.existsSync(path.join(archiveDir, "knowledge-single-turn.jsonl")),
        ).toBe(true);
    });

    it("migrates a copilot run to a session + turns", () => {
        copyFixture("copilot-multi-turn.jsonl");
        const runId = "2026-07-02T15-27-08Z-0011690-000";

        const summary = migrateRuns(deps());

        expect(summary.migratedSessions).toBe(1);
        expect(summary.migratedTurns).toBe(3);
        expect(findFile(sessionsRootDir, runId)).toBeDefined();
        expect(findFile(turnsRootDir, `${runId}-t000`)).toBeDefined();
        expect(findFile(turnsRootDir, `${runId}-t002`)).toBeDefined();
    });

    it("writes files the real FS repos can read back and reduce", async () => {
        copyFixture("copilot-multi-turn.jsonl");
        const runId = "2026-07-02T15-27-08Z-0011690-000";
        migrateRuns(deps());

        const turnRepo = new FSTurnRepo({ turnsRootDir });
        const sessionRepo = new FSSessionRepo({ sessionsRootDir });

        // The app's actual read path: repo.read (strict trailing-newline + id
        // checks) then reduce.
        const sessionEvents = await sessionRepo.read(runId);
        const sessionState = reduceSession(sessionEvents);
        expect(sessionState.turns).toHaveLength(3);

        const turnEvents = await turnRepo.read(`${runId}-t000`);
        const turnState = reduceTurn(turnEvents);
        expect(turnState.terminal?.type).toBe("turn_completed");
    });

    it("skips code_session runs and leaves them in place", () => {
        // Rewrite a fixture's useCase to code_session.
        const raw = fs
            .readFileSync(path.join(fixturesDir, "knowledge-single-turn.jsonl"), "utf-8")
            .split("\n")
            .filter((l) => l.trim());
        const start = JSON.parse(raw[0]);
        start.useCase = "code_session";
        raw[0] = JSON.stringify(start);
        fs.writeFileSync(path.join(runsDir, "code.jsonl"), raw.join("\n") + "\n");

        const summary = migrateRuns(deps());

        expect(summary.skipped).toBe(1);
        expect(summary.migratedTurns).toBe(0);
        // Left in place, not archived.
        expect(fs.existsSync(path.join(runsDir, "code.jsonl"))).toBe(true);
        expect(fs.existsSync(path.join(archiveDir, "code.jsonl"))).toBe(false);
    });

    it("leaves a malformed run in place and records the failure", () => {
        fs.writeFileSync(path.join(runsDir, "broken.jsonl"), "not json\n");

        const summary = migrateRuns(deps());

        expect(summary.failed).toHaveLength(1);
        expect(summary.failed[0].file).toBe("broken.jsonl");
        expect(fs.existsSync(path.join(runsDir, "broken.jsonl"))).toBe(true);
    });

    it("is idempotent — a second pass finds nothing left to migrate", () => {
        copyFixture("background-task.jsonl");

        const first = migrateRuns(deps());
        expect(first.migratedTurns).toBe(1);

        const second = migrateRuns(deps());
        expect(second.scanned).toBe(0);
        expect(second.migratedTurns).toBe(0);
    });

    it("writes a migration log with counts", () => {
        copyFixture("copilot-brew-deny.jsonl");
        migrateRuns(deps());

        expect(fs.existsSync(logFile)).toBe(true);
        const parsed = JSON.parse(fs.readFileSync(logFile, "utf-8"));
        expect(parsed.ranAt).toBe("2026-07-02T00:00:00.000Z");
        expect(parsed.migratedSessions).toBe(1);
    });

    it("does nothing gracefully when the runs dir is absent", () => {
        fs.rmSync(runsDir, { recursive: true, force: true });
        const summary = migrateRuns(deps());
        expect(summary.scanned).toBe(0);
    });
});
