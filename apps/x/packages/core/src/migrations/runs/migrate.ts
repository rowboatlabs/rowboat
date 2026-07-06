import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { WorkDir } from "../../config/config.js";
import { RunEvent } from "@x/shared/dist/runs.js";
import { TurnEvent } from "@x/shared/dist/turns.js";
import { SessionEvent } from "@x/shared/dist/sessions.js";
import { convertRun } from "./convert.js";

// One-time migration that ports legacy `runs/<runId>.jsonl` logs into the new
// turn/session runtime at startup. Runs before the session index is built.
//
// Design (see convert.ts for the mapping):
//   - Successfully migrated runs are MOVED to `runs-archive/`. That move is the
//     idempotency guard — migrated files leave the scan directory, so a re-run
//     never re-processes them and no separate marker is needed.
//   - Any run that fails to convert is LEFT in `runs/` (still served by the
//     `runs:fetch` fallback the history views keep) and retried next launch.
//   - code_session runs are skipped and left in place — Code mode still uses
//     the old runtime, so those files must stay.
// Every step is defensive; a bad run (or the whole pass) never blocks boot.

const ID_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T[A-Za-z0-9-]+$/;

export interface MigrateRunsDeps {
    runsDir?: string;
    turnsRootDir?: string;
    sessionsRootDir?: string;
    archiveDir?: string;
    logFile?: string;
    now?: () => string;
    logger?: (message: string) => void;
}

export interface MigrationSummary {
    scanned: number;
    migratedSessions: number;
    migratedTurns: number;
    skipped: number;
    failed: Array<{ file: string; error: string }>;
}

function idPath(rootDir: string, id: string): string {
    const match = ID_PATTERN.exec(id);
    if (!match) throw new Error(`invalid id: ${id}`);
    const [, year, month, day] = match;
    return path.join(rootDir, year, month, day, `${id}.jsonl`);
}

// Mirrors the FS repos' serialization: revalidate each event, one JSON object
// per line, trailing newline. Overwrites any existing target so a re-run after
// a mid-migration crash converges cleanly (historical ids never collide with
// live turns, whose ids are minted from the current clock).
function writeJsonl<T>(
    rootDir: string,
    id: string,
    events: T[],
    schema: z.ZodType<T>,
): void {
    const file = idPath(rootDir, id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const payload =
        events.map((event) => JSON.stringify(schema.parse(event))).join("\n") +
        "\n";
    fs.writeFileSync(file, payload);
}

export function migrateRuns(deps: MigrateRunsDeps = {}): MigrationSummary {
    const runsDir = deps.runsDir ?? path.join(WorkDir, "runs");
    const turnsRootDir =
        deps.turnsRootDir ?? path.join(WorkDir, "storage", "turns");
    const sessionsRootDir =
        deps.sessionsRootDir ?? path.join(WorkDir, "storage", "sessions");
    const archiveDir = deps.archiveDir ?? path.join(WorkDir, "runs-archive");
    const logFile =
        deps.logFile ?? path.join(WorkDir, "config", "runs-migration.json");
    const log =
        deps.logger ?? ((message: string) => console.log(`[runs-migration] ${message}`));

    const summary: MigrationSummary = {
        scanned: 0,
        migratedSessions: 0,
        migratedTurns: 0,
        skipped: 0,
        failed: [],
    };

    let files: string[];
    try {
        files = fs
            .readdirSync(runsDir)
            .filter((name) => name.endsWith(".jsonl"))
            .sort();
    } catch {
        // No runs directory — nothing to migrate.
        return summary;
    }

    for (const file of files) {
        summary.scanned++;
        const source = path.join(runsDir, file);
        try {
            const raw = fs.readFileSync(source, "utf-8");
            const logEvents = raw
                .split("\n")
                .filter((line) => line.trim().length > 0)
                .map((line) => RunEvent.parse(JSON.parse(line)));

            const start = logEvents[0];
            if (!start || start.type !== "start") {
                throw new Error("run log does not begin with a start event");
            }
            if (start.useCase === "code_session") {
                // Code mode still uses the old runtime; leave the file in place.
                summary.skipped++;
                continue;
            }

            const result = convertRun(logEvents, start.runId);
            for (const turn of result.turns) {
                writeJsonl(turnsRootDir, turn.turnId, turn.events, TurnEvent);
            }
            if (result.session) {
                writeJsonl(
                    sessionsRootDir,
                    result.session.sessionId,
                    result.session.events,
                    SessionEvent,
                );
            }

            // Success — archive the original out of the scan directory.
            fs.mkdirSync(archiveDir, { recursive: true });
            fs.renameSync(source, path.join(archiveDir, file));

            if (result.isSession) summary.migratedSessions++;
            summary.migratedTurns += result.turns.length;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            summary.failed.push({ file, error: message });
            log(`failed to migrate ${file}: ${message}`);
        }
    }

    try {
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        fs.writeFileSync(
            logFile,
            JSON.stringify(
                { ranAt: deps.now?.() ?? new Date().toISOString(), ...summary },
                null,
                2,
            ),
        );
    } catch {
        // Observability only; never fatal.
    }

    log(
        `scanned ${summary.scanned}, sessions ${summary.migratedSessions}, ` +
            `turns ${summary.migratedTurns}, skipped ${summary.skipped}, ` +
            `failed ${summary.failed.length}`,
    );
    return summary;
}
