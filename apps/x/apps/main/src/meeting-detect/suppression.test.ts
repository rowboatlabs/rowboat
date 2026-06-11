import { describe, it, expect, beforeEach } from "vitest";
import { Suppression, InMemorySuppressionStore } from "./suppression.js";

describe("Suppression", () => {
    let store: InMemorySuppressionStore;
    let suppression: Suppression;

    beforeEach(async () => {
        store = new InMemorySuppressionStore();
        suppression = new Suppression(store);
        await suppression.init();
    });

    it("allows the first popup for a fresh session", () => {
        expect(suppression.shouldNotify("zoom.us#100", "zoom.us")).toBe(true);
    });

    it("blocks re-popup for the same session once marked notified", async () => {
        await suppression.markNotified("zoom.us#100", "zoom.us");
        expect(suppression.shouldNotify("zoom.us#100", "zoom.us")).toBe(false);
    });

    it("blocks a different session for the same exe within the notify cooldown", async () => {
        // A flaky mic assertion clears the session and re-detects under a new key;
        // the per-app cooldown must suppress the duplicate popup (issue #562 follow-up).
        const t0 = new Date();
        await suppression.markNotified("zoom.us#100", "zoom.us", t0);
        const soon = new Date(t0.getTime() + 30 * 1000); // 30s later — within the 90s cooldown
        expect(suppression.shouldNotify("zoom.us#101", "zoom.us", soon)).toBe(false);
    });

    it("allows the same exe again once the notify cooldown has elapsed", async () => {
        const t0 = new Date();
        await suppression.markNotified("zoom.us#100", "zoom.us", t0);
        const after = new Date(t0.getTime() + 100 * 1000); // 100s — past the 90s cooldown
        // Cooldown GC drops stale entries on reload, mirroring the dismiss-cooldown test.
        const reloaded = new Suppression(store);
        await reloaded.init();
        expect(reloaded.shouldNotify("zoom.us#101", "zoom.us", after)).toBe(true);
    });

    it("keeps the cooldown across clearSession (the flicker case)", async () => {
        const t0 = new Date();
        await suppression.markNotified("Google Chrome#664", "Google Chrome", t0);
        // Mic assertion blinks out → detector clears the session.
        await suppression.clearSession("Google Chrome#664");
        // Same session re-detected moments later must NOT re-popup.
        const soon = new Date(t0.getTime() + 30 * 1000);
        expect(suppression.shouldNotify("Google Chrome#664", "Google Chrome", soon)).toBe(false);
    });

    it("respects the dismiss cooldown window", async () => {
        // Anchor at "now" — gc() filters by wall-clock age, so a hard-coded
        // past date would be dropped on persist and the cooldown wouldn't apply.
        const t0 = new Date();
        await suppression.markDismissed("/Applications/zoom.us.app/Contents/MacOS/zoom.us", t0);

        const within = new Date(t0.getTime() + 10 * 60 * 1000); // 10 min later
        expect(suppression.shouldNotify("zoom.us#200", "zoom.us", within)).toBe(false);

        const after = new Date(t0.getTime() + 31 * 60 * 1000); // 31 min later — past 30-min cooldown
        // Cooldown GC drops entries past the window — re-load to apply GC.
        const reloaded = new Suppression(store);
        await reloaded.init();
        expect(reloaded.shouldNotify("zoom.us#200", "zoom.us", after)).toBe(true);
    });

    it("permanently mutes an app", async () => {
        await suppression.muteApp("/Applications/Discord.app/Contents/MacOS/Discord");
        expect(suppression.shouldNotify("Discord#9", "Discord")).toBe(false);
        // And after reload, still muted.
        const reloaded = new Suppression(store);
        await reloaded.init();
        expect(reloaded.shouldNotify("Discord#10", "Discord")).toBe(false);
    });

    it("persists state through save/load", async () => {
        await suppression.markNotified("zoom.us#100", "zoom.us");
        await suppression.muteApp("Discord");

        const snap = store.snapshot();
        expect(snap.notifiedSessions["zoom.us#100"]).toBeDefined();
        expect(snap.mutedApps).toContain("discord");

        const reloaded = new Suppression(store);
        await reloaded.init();
        expect(reloaded.shouldNotify("zoom.us#100", "zoom.us")).toBe(false);
        expect(reloaded.isMuted("Discord")).toBe(true);
    });

    it("dismiss key normalizes path differences (Win path vs basename)", async () => {
        const winPath = "C:\\Program Files\\Zoom\\bin\\Zoom.exe";
        const macPath = "/Applications/Zoom.app/Contents/MacOS/zoom.us";

        // Mute via mac-style path, expect it to apply when the detector reports the Windows-style path
        // only if the basename matches. zoom.exe vs zoom.us differ, so they should NOT cross-match
        // — verifying the dismiss key is the bare exe name and we don't over-match.
        await suppression.muteApp(winPath);
        expect(suppression.isMuted(winPath)).toBe(true);
        expect(suppression.isMuted(macPath)).toBe(false);
    });
});
