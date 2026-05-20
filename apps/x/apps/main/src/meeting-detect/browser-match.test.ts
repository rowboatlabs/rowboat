import { describe, it, expect } from "vitest";
import { matchTitleOrUrl } from "./browser-match.js";

describe("matchTitleOrUrl", () => {
    it("matches Google Meet by URL", () => {
        const m = matchTitleOrUrl("Meet — Standup", "https://meet.google.com/abc-defg-hij");
        expect(m?.platform).toBe("google-meet");
    });

    it("matches Google Meet by window title alone (Windows/Mac no-URL case)", () => {
        const m = matchTitleOrUrl("Meet - Daily Standup - Google Chrome", undefined);
        expect(m?.platform).toBe("google-meet");
    });

    it("matches Meet with em-dash variant (locale-dependent title)", () => {
        const m = matchTitleOrUrl("Meet — Daily Standup", undefined);
        expect(m?.platform).toBe("google-meet");
    });

    it("matches Zoom web client", () => {
        const m = matchTitleOrUrl("Zoom Meeting", "https://us02web.zoom.us/j/123456789");
        expect(m?.platform).toBe("zoom-web");
    });

    it("matches Teams web", () => {
        const m = matchTitleOrUrl("Meeting | Microsoft Teams", "https://teams.microsoft.com/_#/calendarv2");
        expect(m?.platform).toBe("teams-web");
    });

    it("ignores random YouTube tab", () => {
        const m = matchTitleOrUrl("Mock Interview - YouTube", "https://www.youtube.com/watch?v=abc");
        expect(m).toBeNull();
    });

    it("returns null for empty input", () => {
        expect(matchTitleOrUrl(undefined, undefined)).toBeNull();
        expect(matchTitleOrUrl("", "")).toBeNull();
    });

    it("is case-insensitive", () => {
        const m = matchTitleOrUrl("ZOOM MEETING", "https://ZOOM.US/J/999");
        expect(m?.platform).toBe("zoom-web");
    });
});
