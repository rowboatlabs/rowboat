import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { correlateFromDir } from "./calendar-correlate.js";

let tmpDir: string;

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rb-meeting-detect-"));
});

afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeEvent(name: string, body: unknown): Promise<void> {
    await fs.writeFile(path.join(tmpDir, `${name}.json`), JSON.stringify(body), "utf-8");
}

function evt(opts: {
    id: string;
    summary: string;
    startMinutes: number; // minutes from `anchor`
    endMinutes: number;
    cancelled?: boolean;
    declined?: boolean;
    hangoutLink?: string;
}): unknown {
    const anchor = new Date("2026-05-15T10:00:00Z").getTime();
    return {
        id: opts.id,
        summary: opts.summary,
        status: opts.cancelled ? "cancelled" : "confirmed",
        start: { dateTime: new Date(anchor + opts.startMinutes * 60_000).toISOString() },
        end: { dateTime: new Date(anchor + opts.endMinutes * 60_000).toISOString() },
        attendees: [
            { self: true, responseStatus: opts.declined ? "declined" : "accepted" },
            { email: "alice@example.com", displayName: "Alice" },
        ],
        hangoutLink: opts.hangoutLink,
    };
}

describe("correlateFromDir", () => {
    const NOW = new Date("2026-05-15T10:30:00Z");

    it("returns null when the directory does not exist", async () => {
        const result = await correlateFromDir(path.join(tmpDir, "does-not-exist"), NOW);
        expect(result).toBeNull();
    });

    it("returns null when no events overlap", async () => {
        await writeEvent("e1", evt({ id: "e1", summary: "Morning", startMinutes: -120, endMinutes: -60 }));
        const result = await correlateFromDir(tmpDir, NOW);
        expect(result).toBeNull();
    });

    it("matches an event in progress", async () => {
        await writeEvent("e1", evt({
            id: "e1",
            summary: "Q2 Planning",
            startMinutes: 25, // 10:25, NOW=10:30 → in progress
            endMinutes: 55,
            hangoutLink: "https://meet.google.com/abc",
        }));
        const result = await correlateFromDir(tmpDir, NOW);
        expect(result?.eventId).toBe("e1");
        expect(result?.summary).toBe("Q2 Planning");
        expect(result?.meetingUrl).toBe("https://meet.google.com/abc");
        expect(result?.attendees).toHaveLength(1); // self filtered
        expect(result?.attendees[0].email).toBe("alice@example.com");
    });

    it("matches an event starting within pre-roll", async () => {
        await writeEvent("e1", evt({
            id: "e1",
            summary: "Upcoming",
            startMinutes: 31, // NOW=10:30, event at 10:31 → 1 min away, within 2-min pre-roll
            endMinutes: 60,
        }));
        const result = await correlateFromDir(tmpDir, NOW);
        expect(result?.eventId).toBe("e1");
    });

    it("ignores cancelled events", async () => {
        await writeEvent("e1", evt({ id: "e1", summary: "Dead", startMinutes: 25, endMinutes: 55, cancelled: true }));
        const result = await correlateFromDir(tmpDir, NOW);
        expect(result).toBeNull();
    });

    it("ignores events the user declined", async () => {
        await writeEvent("e1", evt({ id: "e1", summary: "Nope", startMinutes: 25, endMinutes: 55, declined: true }));
        const result = await correlateFromDir(tmpDir, NOW);
        expect(result).toBeNull();
    });

    it("picks the closest event when multiple overlap", async () => {
        await writeEvent("far", evt({ id: "far", summary: "Far", startMinutes: -10, endMinutes: 35 }));
        await writeEvent("near", evt({ id: "near", summary: "Near", startMinutes: 29, endMinutes: 59 }));
        const result = await correlateFromDir(tmpDir, NOW);
        expect(result?.eventId).toBe("near");
    });

    it("ignores sync_state.json", async () => {
        await writeEvent("sync_state", { lastSync: "whatever" });
        await writeEvent("e1", evt({ id: "e1", summary: "Real", startMinutes: 25, endMinutes: 55 }));
        const result = await correlateFromDir(tmpDir, NOW);
        expect(result?.eventId).toBe("e1");
    });
});
