import { describe, it, expect, beforeEach, vi } from "vitest";
import type { INotificationService, NotifyInput } from "@x/core/dist/application/notification/service.js";
import { MeetingDetector } from "./detector.js";
import type { MicProbe, MicUser } from "./types.js";
import { MeetingDetectService, buildPopup } from "./service.js";
import { Suppression, InMemorySuppressionStore } from "./suppression.js";
import type { BrowserMeetingMatch } from "./browser-match.js";
import type { CorrelatedEvent } from "./calendar-correlate.js";

class FakeProbe implements MicProbe {
    next: MicUser[] = [];
    async probe(): Promise<MicUser[]> { return this.next; }
}

class FakeNotifier implements INotificationService {
    sent: NotifyInput[] = [];
    isSupported(): boolean { return true; }
    notify(input: NotifyInput): void { this.sent.push(input); }
}

describe("buildPopup", () => {
    it("uses the calendar event summary when correlated", () => {
        const corr: CorrelatedEvent = {
            eventId: "abc123",
            summary: "Q2 Planning",
            startMs: 0, endMs: 0,
            attendees: [],
        };
        const popup = buildPopup("zoom", null, corr);
        expect(popup?.notify.message).toContain("Q2 Planning");
        expect(popup?.notify.link).toContain("eventId=abc123");
        expect(popup?.notify.link).toContain("take-meeting-notes");
    });

    it("falls back to ad-hoc copy when no calendar match", () => {
        const popup = buildPopup("zoom", null, null);
        expect(popup?.notify.title).toBe("You're in a meeting");
        expect(popup?.notify.link).toContain("title=");
        expect(popup?.notify.link).not.toContain("eventId=");
        // Default ad-hoc title (no precomputed counter) is "Meeting Notes - Zoom".
        expect(decodeURIComponent(popup!.notify.link.split("title=")[1])).toBe("Meeting Notes - Zoom");
    });

    it("uses the precomputed ad-hoc title when provided (counter case)", () => {
        const popup = buildPopup("zoom", null, null, "Meeting Notes - Zoom #2");
        expect(decodeURIComponent(popup!.notify.link.split("title=")[1])).toBe("Meeting Notes - Zoom #2");
    });

    it("uses browser match platform label when kind=browser", () => {
        const m: BrowserMeetingMatch = { platform: "google-meet", hint: "https://meet.google.com/abc" };
        const popup = buildPopup("browser", m, null);
        expect(popup?.notify.message).toContain("Google Meet");
    });

    it("returns null for unknown app without browser match (defensive)", () => {
        expect(buildPopup("unknown", null, null)).toBeNull();
    });
});

describe("MeetingDetectService end-to-end", () => {
    let probe: FakeProbe;
    let detector: MeetingDetector;
    let notifier: FakeNotifier;
    let suppression: Suppression;

    beforeEach(() => {
        probe = new FakeProbe();
        detector = new MeetingDetector(probe, 999_999);
        notifier = new FakeNotifier();
        suppression = new Suppression(new InMemorySuppressionStore());
    });

    it("fires notification when a zoom call is detected, with calendar context", async () => {
        const correlated: CorrelatedEvent = {
            eventId: "evt-1",
            summary: "Standup",
            startMs: 0, endMs: 0,
            attendees: [],
        };
        const service = new MeetingDetectService({
            detector,
            notifier,
            suppression,
            matchBrowser: async () => null,
            correlate: async () => correlated,
            toast: null,
        });
        await service.start();

        probe.next = [{ executable: "zoom.us", pid: 100 }];
        await detector.tick();
        await service.settle();

        expect(notifier.sent).toHaveLength(1);
        expect(notifier.sent[0].title).toBe("Take notes for this meeting?");
        expect(notifier.sent[0].message).toContain("Standup");
        expect(notifier.sent[0].link).toContain("eventId=evt-1");
    });

    it("does NOT fire for a browser if the foreground tab is not a meeting page", async () => {
        const service = new MeetingDetectService({
            detector,
            notifier,
            suppression,
            matchBrowser: async () => null, // browser foreground = not a meeting
            correlate: async () => null,
            toast: null,
        });
        await service.start();

        probe.next = [{ executable: "Google Chrome", pid: 200 }];
        await detector.tick();
        await service.settle();

        expect(notifier.sent).toHaveLength(0);
    });

    it("FIRES for a browser when the foreground tab IS a meeting page", async () => {
        const service = new MeetingDetectService({
            detector,
            notifier,
            suppression,
            matchBrowser: async () => ({ platform: "google-meet", hint: "https://meet.google.com/x" }),
            correlate: async () => null,
            toast: null,
        });
        await service.start();

        probe.next = [{ executable: "Google Chrome", pid: 200 }];
        await detector.tick();
        await service.settle();

        expect(notifier.sent).toHaveLength(1);
        expect(notifier.sent[0].message).toContain("Google Meet");
        expect(notifier.sent[0].link).toContain("title="); // ad-hoc, no eventId
    });

    it("does not re-fire on consecutive ticks for the same session", async () => {
        const service = new MeetingDetectService({
            detector,
            notifier,
            suppression,
            matchBrowser: async () => null,
            correlate: async () => null,
            toast: null,
        });
        await service.start();

        probe.next = [{ executable: "zoom.us", pid: 100 }];
        await detector.tick();
        await detector.tick();
        await detector.tick();
        await service.settle();

        expect(notifier.sent).toHaveLength(1);
    });

    it("uses the toast renderer when provided instead of the native notifier", async () => {
        const calls: Array<{ title: string; message: string; actionLink: string }> = [];
        const toast = {
            show(p: { title: string; message: string; actionLabel: string; actionLink: string }) {
                calls.push({ title: p.title, message: p.message, actionLink: p.actionLink });
            },
        };
        const service = new MeetingDetectService({
            detector,
            notifier,
            suppression,
            matchBrowser: async () => null,
            correlate: async () => null,
            toast,
        });
        await service.start();

        probe.next = [{ executable: "zoom.us", pid: 100 }];
        await detector.tick();
        await service.settle();

        expect(notifier.sent).toHaveLength(0);
        expect(calls).toHaveLength(1);
        expect(calls[0].title).toBe("You're in a meeting");
        expect(calls[0].actionLink).toContain("take-meeting-notes");
    });

    it("respects per-app mute", async () => {
        await suppression.init();
        await suppression.muteApp("Discord");

        const service = new MeetingDetectService({
            detector,
            notifier,
            suppression,
            matchBrowser: async () => null,
            correlate: async () => null,
            toast: null,
        });
        await service.start();

        probe.next = [{ executable: "Discord", pid: 300 }];
        await detector.tick();
        await service.settle();

        expect(notifier.sent).toHaveLength(0);
    });
});
