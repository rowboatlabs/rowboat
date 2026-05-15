import { describe, it, expect, beforeEach, vi } from "vitest";
import { MeetingDetector, type MeetingActiveEvent, type MeetingClearedEvent } from "./detector.js";
import type { MicProbe, MicUser } from "./types.js";

class FakeProbe implements MicProbe {
    private next: MicUser[] = [];
    setNext(users: MicUser[]): void { this.next = users; }
    async probe(): Promise<MicUser[]> { return this.next; }
}

function collect(detector: MeetingDetector) {
    const active: MeetingActiveEvent[] = [];
    const cleared: MeetingClearedEvent[] = [];
    detector.on("meeting-active", (e) => active.push(e));
    detector.on("meeting-cleared", (e) => cleared.push(e));
    return { active, cleared };
}

describe("MeetingDetector", () => {
    let probe: FakeProbe;
    let detector: MeetingDetector;

    beforeEach(() => {
        probe = new FakeProbe();
        // tickMs is irrelevant — we drive ticks manually.
        detector = new MeetingDetector(probe, 999_999);
    });

    it("emits meeting-active once when a Zoom-like exe appears", async () => {
        const { active } = collect(detector);

        probe.setNext([{ executable: "C:\\Program Files\\Zoom\\bin\\Zoom.exe" }]);
        await detector.tick();

        expect(active).toHaveLength(1);
        expect(active[0].kind).toBe("zoom");
        expect(active[0].executable).toContain("Zoom.exe");
    });

    it("does not re-emit while the same exe keeps appearing", async () => {
        const { active } = collect(detector);
        const user = { executable: "/Applications/zoom.us.app/Contents/MacOS/zoom.us", pid: 4711 };

        probe.setNext([user]);
        await detector.tick();
        await detector.tick();
        await detector.tick();

        expect(active).toHaveLength(1);
    });

    it("emits meeting-cleared when the exe disappears", async () => {
        const { active, cleared } = collect(detector);
        const user = { executable: "zoom.us", pid: 4711 };

        probe.setNext([user]);
        await detector.tick();

        probe.setNext([]);
        await detector.tick();

        expect(active).toHaveLength(1);
        expect(cleared).toHaveLength(1);
        expect(cleared[0].sessionKey).toBe(active[0].sessionKey);
    });

    it("ignores unknown executables (Voice Memos, OBS, etc.)", async () => {
        const { active, cleared } = collect(detector);

        probe.setNext([{ executable: "Voice Memos", pid: 999 }]);
        await detector.tick();

        probe.setNext([]);
        await detector.tick();

        expect(active).toHaveLength(0);
        expect(cleared).toHaveLength(0);
    });

    it("classifies a browser as kind=browser (for downstream tab-title check)", async () => {
        const { active } = collect(detector);

        probe.setNext([{ executable: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", pid: 5050 }]);
        await detector.tick();

        expect(active).toHaveLength(1);
        expect(active[0].kind).toBe("browser");
    });

    it("treats a relaunched app (new pid) as a new session on macOS", async () => {
        const { active, cleared } = collect(detector);

        probe.setNext([{ executable: "zoom.us", pid: 100 }]);
        await detector.tick();

        probe.setNext([]); // app closed
        await detector.tick();

        probe.setNext([{ executable: "zoom.us", pid: 200 }]); // re-opened
        await detector.tick();

        expect(active).toHaveLength(2);
        expect(cleared).toHaveLength(1);
        expect(active[0].sessionKey).not.toBe(active[1].sessionKey);
    });

    it("handles multiple concurrent meeting apps independently", async () => {
        const { active, cleared } = collect(detector);

        probe.setNext([
            { executable: "zoom.us", pid: 100 },
            { executable: "Microsoft Teams", pid: 200 },
        ]);
        await detector.tick();

        probe.setNext([{ executable: "Microsoft Teams", pid: 200 }]);
        await detector.tick();

        expect(active).toHaveLength(2);
        expect(active.map((e) => e.kind).sort()).toEqual(["teams", "zoom"]);
        expect(cleared).toHaveLength(1);
        expect(cleared[0].sessionKey).toContain("zoom.us");
    });

    it("recovers without crashing when the probe throws", async () => {
        const flaky: MicProbe = { probe: vi.fn().mockRejectedValueOnce(new Error("boom")) };
        const d = new MeetingDetector(flaky, 999_999);
        // tick() awaits probe.probe() so a rejection bubbles — start() catches it. Verify start() doesn't throw.
        d.start();
        await new Promise((r) => setTimeout(r, 10));
        d.stop();
        expect(flaky.probe).toHaveBeenCalled();
    });
});
