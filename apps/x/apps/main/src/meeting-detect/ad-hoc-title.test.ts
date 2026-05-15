import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { buildAdHocTitle, shortPlatformLabel } from "./ad-hoc-title.js";

let tmpRoot: string;
const NOW = new Date(2026, 4, 15, 14, 0, 0); // 2026-05-15 14:00 local

beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rb-adhoc-title-"));
});

afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function writeNote(day: string, filename: string): Promise<void> {
    const dir = path.join(tmpRoot, day);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, filename), "stub", "utf-8");
}

describe("buildAdHocTitle", () => {
    it("returns the bare title for the first occurrence of the day", async () => {
        const title = await buildAdHocTitle({ platformLabel: "Zoom", now: NOW, root: tmpRoot });
        expect(title).toBe("Meeting Notes - Zoom");
    });

    it("appends #2 when one already exists", async () => {
        await writeNote("2026-05-15", "Meeting_Notes_-_Zoom.md");
        const title = await buildAdHocTitle({ platformLabel: "Zoom", now: NOW, root: tmpRoot });
        expect(title).toBe("Meeting Notes - Zoom #2");
    });

    it("increments past #2 (#3, #4, ...)", async () => {
        await writeNote("2026-05-15", "Meeting_Notes_-_Zoom.md");
        await writeNote("2026-05-15", "Meeting_Notes_-_Zoom_#2.md");
        await writeNote("2026-05-15", "Meeting_Notes_-_Zoom_#3.md");
        const title = await buildAdHocTitle({ platformLabel: "Zoom", now: NOW, root: tmpRoot });
        expect(title).toBe("Meeting Notes - Zoom #4");
    });

    it("doesn't cross-count platforms (Meet vs Zoom stay distinct)", async () => {
        await writeNote("2026-05-15", "Meeting_Notes_-_Zoom.md");
        const title = await buildAdHocTitle({ platformLabel: "Meet", now: NOW, root: tmpRoot });
        expect(title).toBe("Meeting Notes - Meet");
    });

    it("resets the counter on a different day", async () => {
        await writeNote("2026-05-14", "Meeting_Notes_-_Zoom.md");
        const title = await buildAdHocTitle({ platformLabel: "Zoom", now: NOW, root: tmpRoot });
        expect(title).toBe("Meeting Notes - Zoom");
    });

    it("ignores non-meeting notes in the same folder", async () => {
        await writeNote("2026-05-15", "standup.md");
        await writeNote("2026-05-15", "random_note.md");
        const title = await buildAdHocTitle({ platformLabel: "Zoom", now: NOW, root: tmpRoot });
        expect(title).toBe("Meeting Notes - Zoom");
    });

    it("matches slug-variant filenames (different separators)", async () => {
        // Whatever the renderer's slugifier does, normalize() should match.
        await writeNote("2026-05-15", "Meeting Notes - Zoom.md");
        await writeNote("2026-05-15", "Meeting-Notes--Zoom.md"); // hypothetical alt slug
        const title = await buildAdHocTitle({ platformLabel: "Zoom", now: NOW, root: tmpRoot });
        expect(title).toBe("Meeting Notes - Zoom #3");
    });
});

describe("shortPlatformLabel", () => {
    it("maps browser platforms to short labels", () => {
        expect(shortPlatformLabel({ browserPlatform: "google-meet", kind: "browser" })).toBe("Meet");
        expect(shortPlatformLabel({ browserPlatform: "zoom-web", kind: "browser" })).toBe("Zoom");
        expect(shortPlatformLabel({ browserPlatform: "teams-web", kind: "browser" })).toBe("Teams");
    });

    it("maps native kinds to short labels", () => {
        expect(shortPlatformLabel({ kind: "zoom" })).toBe("Zoom");
        expect(shortPlatformLabel({ kind: "teams" })).toBe("Teams");
        expect(shortPlatformLabel({ kind: "discord" })).toBe("Discord");
    });

    it("returns null for unmatched browser / unknown", () => {
        expect(shortPlatformLabel({ kind: "browser" })).toBeNull();
        expect(shortPlatformLabel({ kind: "unknown" })).toBeNull();
    });
});
